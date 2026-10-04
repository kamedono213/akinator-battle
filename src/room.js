// Firestoreとのやり取りをこのファイルにまとめる(ピックノートのsrc/cloud.jsと
// 同じ考え方: Firebase Web SDKをCDNからES moduleとしてそのままimportし、
// バンドラなしの静的サイトのまま動かす)。ログインは使わないため
// firebase-authは読み込まない。
import { firebaseConfig } from './firebase-config.js';

const SDK_VERSION = '10.14.1';
const CDN_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

const [{ initializeApp }, firestoreSdk] = await Promise.all([
  import(`${CDN_BASE}/firebase-app.js`),
  import(`${CDN_BASE}/firebase-firestore.js`),
]);

const {
  initializeFirestore,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  arrayUnion,
} = firestoreSdk;

const app = initializeApp(firebaseConfig);
const dbFs = initializeFirestore(app, {});

const ROOMS = 'rooms';
const MAX_TURNS = 10;

// この端末を一意に識別するためだけのランダムID(ログイン不要の代わりに、
// 「自分がこの部屋のホストかゲストか」をあとから判定するために使う)。
function getClientId() {
  const key = 'akinator-battle:clientId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

function randomCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function freshRoundFields() {
  return {
    phase: 'host_setting_topic',
    turnsUsed: 0,
    maxTurns: MAX_TURNS,
    log: [],
    pending: null,
    finalGuessText: null,
    topic: null,
    genreHint: null,
    result: null,
    extensionChoice: null,
    endRequest: null,
    chat: [],
    startedAt: serverTimestamp(),
    endedAt: null,
  };
}

// バトル中にチャットできる自由会話欄。質問ログ(log)とは別枠で、ラウンドが
// 変わる(startNextRound)たびにリセットされる。
export async function sendChatMessage(code, from, text) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    chat: arrayUnion({ from, text, ts: Date.now() }),
  });
}

// 4桁コードの衝突を避けるため、空いているコードが見つかるまで作成を試みる。
export async function createRoom() {
  const hostId = getClientId();
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode();
    const ref = doc(dbFs, ROOMS, code);
    const created = await runTransaction(dbFs, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return false;
      tx.set(ref, {
        code,
        createdAt: serverTimestamp(),
        hostId,
        guestId: null,
        ...freshRoundFields(),
        phase: 'waiting_guest',
      });
      return true;
    });
    if (created) return { code, hostId };
  }
  throw new Error('部屋コードの発行に失敗しました。もう一度お試しください。');
}

export async function joinRoom(code) {
  const guestId = getClientId();
  const ref = doc(dbFs, ROOMS, code);
  const result = await runTransaction(dbFs, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('その部屋コードは見つかりませんでした。');
    const data = snap.data();
    if (data.hostId === guestId) return data; // 自分が作った部屋への再入室
    if (data.guestId && data.guestId !== guestId) throw new Error('その部屋はすでに満員です。');
    tx.update(ref, { guestId, phase: 'host_setting_topic' });
    return { ...data, guestId, phase: 'host_setting_topic' };
  });
  return { code, ...result };
}

export function subscribeToRoom(code, callback) {
  const ref = doc(dbFs, ROOMS, code);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    callback({ code, ...snap.data() });
  }, (error) => {
    console.error('[room] subscribe error', error);
  });
}

export async function getRoomOnce(code) {
  const snap = await getDoc(doc(dbFs, ROOMS, code));
  return snap.exists() ? { code, ...snap.data() } : null;
}

// ホストがお題の入力を終えて対戦を開始する。お題そのものはFirestoreに書かず
// (ゲストに覗き見られないよう)ホストの端末だけで保持し、最後の正誤判定の
// タイミングで初めてtopicフィールドに書き込んで公開する。
// ジャンルヒントは「教える」を選んだ場合のみここで一緒に公開する(お題本体とは
// 違い、公開しても一発でバレる情報ではないため、開始と同時に渡して問題ない)。
export async function startPlaying(code, genreHint) {
  await updateDoc(doc(dbFs, ROOMS, code), { phase: 'playing', genreHint: genreHint || null });
}

// ゲストが質問、または質問権を消費しての途中回答を送信する。
export async function submitPending(code, type, text, turnsUsed) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    pending: { type, text, n: turnsUsed + 1 },
  });
}

function nextPhaseAfterTurn(data, turnsUsed) {
  // maxTurnsがnull(∞延長中)の場合は上限なし。それ以外は上限に達したら最終回答へ。
  if (data.maxTurns == null) return 'playing';
  return turnsUsed >= data.maxTurns ? 'final_guess' : 'playing';
}

// ホストが質問に5択で回答する。ログに積み、質問権を1つ消費する。
// 残り回数が尽きたら、次は強制的に最終回答フェーズへ。
export async function answerQuestion(code, pendingEntry, answer) {
  const ref = doc(dbFs, ROOMS, code);
  await runTransaction(dbFs, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const turnsUsed = (data.turnsUsed || 0) + 1;
    const log = [...(data.log || []), { ...pendingEntry, answer }];
    tx.update(ref, { log, pending: null, turnsUsed, phase: nextPhaseAfterTurn(data, turnsUsed) });
  });
}

// ホストが「途中回答(質問権を消費した早押し)」を正誤判定する。
// 正解ならその場でゲーム終了、不正解なら質問権だけ消費して対戦続行。
export async function judgeEarlyGuess(code, pendingEntry, correct, topicIfEnding) {
  const ref = doc(dbFs, ROOMS, code);
  await runTransaction(dbFs, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const turnsUsed = (data.turnsUsed || 0) + 1;
    const log = [...(data.log || []), { ...pendingEntry, correct }];
    if (correct) {
      tx.update(ref, {
        log, pending: null, turnsUsed,
        phase: 'ended', result: 'correct', topic: topicIfEnding, endedAt: serverTimestamp(),
      });
    } else {
      tx.update(ref, { log, pending: null, turnsUsed, phase: nextPhaseAfterTurn(data, turnsUsed) });
    }
  });
}

// 質問権を使い切ったあとの、強制の最終回答。
export async function submitFinalGuess(code, text) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    pending: { type: 'final_guess', text, n: null },
  });
}

// 最終回答の正誤判定。正解ならそのまま終了。不正解の場合はまだ終わらせず、
// 「追加の質問権をもらうか、諦めるか」を子に選んでもらうフェーズへ進む
// (お題はまだ公開しない。諦めるを選んだ時に初めて公開する)。
export async function judgeFinalGuess(code, pendingEntry, correct, topic) {
  const ref = doc(dbFs, ROOMS, code);
  await runTransaction(dbFs, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const log = [...(data.log || []), { ...pendingEntry, correct }];
    if (correct) {
      tx.update(ref, {
        log, pending: null, finalGuessText: pendingEntry.text,
        phase: 'ended', result: 'correct', topic, endedAt: serverTimestamp(),
      });
    } else {
      tx.update(ref, {
        log, pending: null, finalGuessText: pendingEntry.text, phase: 'extension_offer',
      });
    }
  });
}

// 子が延長オファーに応答する。choiceは 1〜10 の数値 / 'infinite' / 'give_up'。
// 数値・無限の場合はそのままゲーム再開(お題はまだ秘密のまま)。
// 諦める場合は、お題を知っているホスト側が後からfinalizeGiveUp()で確定させる
// 必要があるため、ここでは意思表示だけ書き込む。
export async function submitExtensionChoice(code, choice) {
  if (choice === 'give_up') {
    await updateDoc(doc(dbFs, ROOMS, code), { extensionChoice: 'give_up' });
    return;
  }
  const maxTurns = choice === 'infinite' ? null : Number(choice);
  await updateDoc(doc(dbFs, ROOMS, code), {
    extensionChoice: null, turnsUsed: 0, maxTurns, phase: 'playing',
  });
}

// ホストだけが呼べる: 子が「諦める」を選んだのを受けて、お題を公開して終了する。
export async function finalizeGiveUp(code, topic) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    extensionChoice: null, phase: 'ended', result: 'incorrect', topic, endedAt: serverTimestamp(),
  });
}

// 途中終了(どちらかが「終了」を押し、もう一方が承認する)。
export async function requestEndGame(code, by) {
  await updateDoc(doc(dbFs, ROOMS, code), { endRequest: { by, approved: false } });
}

export async function cancelEndRequest(code) {
  await updateDoc(doc(dbFs, ROOMS, code), { endRequest: null });
}

// 承認した本人がホストなら、お題を知っているのでその場で確定させる。
// 承認した本人がゲストの場合は、お題を知らないためapprovedフラグだけ立てて
// ホスト側のfinalizeAbortedByHost()に確定を任せる。
export async function approveEndGame(code, respondentRole, topicIfHost) {
  if (respondentRole === 'host') {
    await updateDoc(doc(dbFs, ROOMS, code), {
      endRequest: null, phase: 'ended', result: 'aborted', topic: topicIfHost, endedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(doc(dbFs, ROOMS, code), { 'endRequest.approved': true });
  }
}

// ホストだけが呼べる: ゲストが途中終了を承認したのを受けて、お題を公開して終了する。
export async function finalizeAbortedByHost(code, topic) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    endRequest: null, phase: 'ended', result: 'aborted', topic, endedAt: serverTimestamp(),
  });
}

// ホストが対局後に親交代するかどうかを決める。部屋コードは使い回す。
export async function startNextRound(code, swapHost) {
  const ref = doc(dbFs, ROOMS, code);
  await runTransaction(dbFs, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const nextHostId = swapHost ? data.guestId : data.hostId;
    const nextGuestId = swapHost ? data.hostId : data.guestId;
    tx.update(ref, {
      hostId: nextHostId,
      guestId: nextGuestId,
      ...freshRoundFields(),
    });
  });
}

export { getClientId, MAX_TURNS };
