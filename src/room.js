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
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
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
    result: null,
    startedAt: serverTimestamp(),
    endedAt: null,
    swapChoice: null,
  };
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
export async function startPlaying(code) {
  await updateDoc(doc(dbFs, ROOMS, code), { phase: 'playing' });
}

// ゲストが質問、または質問権を消費しての途中回答を送信する。
export async function submitPending(code, type, text, turnsUsed) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    pending: { type, text, n: turnsUsed + 1 },
  });
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
    const nextPhase = turnsUsed >= (data.maxTurns || MAX_TURNS) ? 'final_guess' : 'playing';
    tx.update(ref, { log, pending: null, turnsUsed, phase: nextPhase });
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
      const nextPhase = turnsUsed >= (data.maxTurns || MAX_TURNS) ? 'final_guess' : 'playing';
      tx.update(ref, { log, pending: null, turnsUsed, phase: nextPhase });
    }
  });
}

// 質問権を使い切ったあとの、強制の最終回答。
export async function submitFinalGuess(code, text) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    pending: { type: 'final_guess', text, n: null },
  });
}

export async function judgeFinalGuess(code, pendingEntry, correct, topic) {
  await updateDoc(doc(dbFs, ROOMS, code), {
    pending: null,
    finalGuessText: pendingEntry.text,
    phase: 'ended',
    result: correct ? 'correct' : 'incorrect',
    topic,
    endedAt: serverTimestamp(),
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
