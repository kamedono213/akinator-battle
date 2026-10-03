import {
  createRoom, joinRoom, subscribeToRoom, startPlaying,
  submitPending, answerQuestion, judgeEarlyGuess,
  submitFinalGuess, judgeFinalGuess, startNextRound,
  getClientId, MAX_TURNS,
} from './room.js';
import { listGames, getGame, putGame, deleteGame } from './db.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const bottomTabbar = $('bottomTabbar');

const ANSWER_OPTIONS = ['はい', 'いいえ', 'どちらでもない', '部分的にはい', '部分的にいいえ'];
const ANSWER_CLASS = {
  'はい': 'ans-yes', 'いいえ': 'ans-no', 'どちらでもない': 'ans-maybe',
  '部分的にはい': 'ans-partial-yes', '部分的にいいえ': 'ans-partial-no',
};

const state = {
  tab: 'battle',
  code: null,
  room: null,
  unsubscribe: null,
  topicLocal: '', // ホストだけが保持する、このラウンドのお題(Firestoreには最後まで書かない)
  dataGames: [],
  expandedGameId: null,
  savedEndedKey: null, // 同じ終了を二重に履歴保存しないためのガード
};

function myRole(room) {
  const cid = getClientId();
  if (!room) return null;
  if (room.hostId === cid) return 'host';
  if (room.guestId === cid) return 'guest';
  return null;
}

function saveActiveRoom(code) {
  try { localStorage.setItem('akinator-battle:activeRoom', JSON.stringify({ code })); } catch (_) {}
}
function loadActiveRoom() {
  try { return JSON.parse(localStorage.getItem('akinator-battle:activeRoom') || 'null'); } catch (_) { return null; }
}
function clearActiveRoom() {
  try { localStorage.removeItem('akinator-battle:activeRoom'); } catch (_) {}
}
function saveLocalTopic(code, topic) {
  try { localStorage.setItem(`akinator-battle:topic:${code}`, topic); } catch (_) {}
}
function loadLocalTopic(code) {
  try { return localStorage.getItem(`akinator-battle:topic:${code}`) || ''; } catch (_) { return ''; }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 2200);
}

// ------------------------------------------------------------------
// 画面の切り替え
// ------------------------------------------------------------------

function render() {
  if (state.tab === 'data') renderDataTab();
  else renderBattleTab();
  for (const btn of bottomTabbar.querySelectorAll('button')) {
    btn.classList.toggle('is-active', btn.dataset.tab === state.tab);
  }
}

function switchTab(tab) {
  state.tab = tab;
  render();
}

function renderBattleTab() {
  const room = state.room;
  if (!room) return renderHomeScreen();
  switch (room.phase) {
    case 'waiting_guest': return renderWaitingGuest(room);
    case 'host_setting_topic': return renderSettingTopic(room);
    case 'playing':
    case 'final_guess': return renderPlaying(room);
    case 'ended': return renderEnded(room);
    default: return renderHomeScreen();
  }
}

function renderHomeScreen() {
  app.innerHTML = `
    <section class="home-view">
      <div class="hero-card">
        <h1>アキネーターバトル</h1>
        <p>2人であそぶ、お題あてバトル。親がお題を決め、子が質問して当てます。</p>
      </div>
      <div class="action-card">
        <button id="createRoomBtn" class="primary-btn" type="button">部屋を作る(親になる)</button>
      </div>
      <div class="action-card">
        <label class="field-label">4桁の部屋コードで参加</label>
        <div class="join-row">
          <input id="joinCodeInput" inputmode="numeric" maxlength="4" placeholder="0000">
          <button id="joinRoomBtn" class="secondary-btn" type="button">参加する</button>
        </div>
      </div>
    </section>`;
  $('createRoomBtn').addEventListener('click', handleCreateRoom);
  $('joinRoomBtn').addEventListener('click', handleJoinRoom);
  $('joinCodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleJoinRoom(); });
}

async function handleCreateRoom() {
  const btn = $('createRoomBtn');
  btn.disabled = true;
  try {
    const { code } = await createRoom();
    enterRoom(code);
  } catch (error) {
    showToast(error.message || '部屋の作成に失敗しました');
  } finally {
    btn.disabled = false;
  }
}

async function handleJoinRoom() {
  const raw = $('joinCodeInput').value.trim();
  if (!/^\d{4}$/.test(raw)) { showToast('4桁の数字で入力してください'); return; }
  const btn = $('joinRoomBtn');
  btn.disabled = true;
  try {
    await joinRoom(raw);
    enterRoom(raw);
  } catch (error) {
    showToast(error.message || '参加に失敗しました');
  } finally {
    btn.disabled = false;
  }
}

function enterRoom(code) {
  state.code = code;
  saveActiveRoom(code);
  state.topicLocal = loadLocalTopic(code);
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = subscribeToRoom(code, (room) => {
    if (!room) {
      showToast('部屋が見つかりませんでした');
      leaveRoom();
      return;
    }
    const prevPhase = state.room?.phase;
    state.room = room;
    if (prevPhase !== 'ended' && room.phase === 'ended') {
      saveCompletedGameLocally(room);
    }
    if (room.phase === 'host_setting_topic' && myRole(room) !== 'host') state.topicLocal = '';
    render();
  });
  render();
}

function leaveRoom() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.code = null;
  state.room = null;
  state.topicLocal = '';
  clearActiveRoom();
  render();
}

function renderWaitingGuest(room) {
  const role = myRole(room);
  app.innerHTML = `
    <section class="waiting-view">
      <div class="code-card">
        <p class="field-label">部屋コード</p>
        <div class="code-display">${room.code}</div>
        <p class="hint-text">このコードを相手に伝えてください</p>
      </div>
      <p class="status-text">${role === 'host' ? '相手の参加を待っています…' : '参加しました'}</p>
      <button id="leaveBtn" class="secondary-btn" type="button">やめる</button>
    </section>`;
  $('leaveBtn').addEventListener('click', leaveRoom);
}

function renderSettingTopic(room) {
  const role = myRole(room);
  if (role === 'host') {
    app.innerHTML = `
      <section class="topic-view">
        <div class="code-card small"><p class="field-label">部屋コード ${room.code}</p></div>
        <h2>お題を決めてください</h2>
        <p class="hint-text">相手には見えません。人・モノ・キャラクターなど、何でもOK。</p>
        <textarea id="topicInput" class="topic-input" placeholder="例: ドラえもん">${escapeHtml(state.topicLocal)}</textarea>
        <button id="confirmTopicBtn" class="primary-btn" type="button">これで決定</button>
      </section>`;
    const textarea = $('topicInput');
    textarea.addEventListener('input', () => { state.topicLocal = textarea.value; });
    $('confirmTopicBtn').addEventListener('click', async () => {
      const topic = state.topicLocal.trim();
      if (!topic) { showToast('お題を入力してください'); return; }
      saveLocalTopic(room.code, topic);
      await startPlaying(room.code);
    });
  } else {
    app.innerHTML = `
      <section class="waiting-view">
        <p class="status-text">親がお題を考えています…</p>
      </section>`;
  }
}

function logEntryLine(entry) {
  if (entry.type === 'question') {
    return `<div class="log-line">
      <span class="log-q">Q${entry.n}. ${escapeHtml(entry.text)}</span>
      <span class="log-a ${ANSWER_CLASS[entry.answer] || ''}">${escapeHtml(entry.answer)}</span>
    </div>`;
  }
  const label = entry.type === 'final_guess' ? '最終回答' : `回答(質問権消費) #${entry.n}`;
  const resultClass = entry.correct ? 'ans-correct' : 'ans-incorrect';
  const resultText = entry.correct ? '正解！' : 'ハズレ';
  return `<div class="log-line log-line-guess">
    <span class="log-q">${label}: ${escapeHtml(entry.text)}</span>
    <span class="log-a ${resultClass}">${resultText}</span>
  </div>`;
}

function renderPlaying(room) {
  const role = myRole(room);
  const remaining = (room.maxTurns || MAX_TURNS) - (room.turnsUsed || 0);
  const logHtml = (room.log || []).map(logEntryLine).join('') || '<p class="hint-text">まだ質問がありません</p>';

  app.innerHTML = `
    <section class="play-view">
      <div class="play-head">
        <span class="role-badge">${role === 'host' ? '親' : '子'}</span>
        <span class="turns-left">${room.phase === 'final_guess' ? '最終回答フェーズ' : `残り質問 ${remaining} / ${room.maxTurns || MAX_TURNS}`}</span>
      </div>
      <div id="logArea" class="log-area">${logHtml}</div>
      <div id="actionArea" class="action-area"></div>
    </section>`;

  const logArea = $('logArea');
  logArea.scrollTop = logArea.scrollHeight;

  const actionArea = $('actionArea');
  if (room.pending) {
    renderPendingForHost(actionArea, room, role);
  } else if (role === 'guest') {
    renderGuestInput(actionArea, room);
  } else {
    actionArea.innerHTML = `<p class="hint-text">相手の質問を待っています…</p>`;
  }
}

function renderPendingForHost(actionArea, room, role) {
  if (role !== 'host') {
    actionArea.innerHTML = `<p class="hint-text">相手の回答を待っています…</p>`;
    return;
  }
  const p = room.pending;
  if (p.type === 'question') {
    actionArea.innerHTML = `
      <div class="pending-card">
        <p class="pending-label">Q${p.n}. ${escapeHtml(p.text)}</p>
        <div class="answer-grid">
          ${ANSWER_OPTIONS.map((opt) => `<button class="answer-btn ${ANSWER_CLASS[opt]}" data-answer="${opt}" type="button">${opt}</button>`).join('')}
        </div>
      </div>`;
    actionArea.querySelectorAll('[data-answer]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        actionArea.querySelectorAll('button').forEach((b) => (b.disabled = true));
        await answerQuestion(room.code, p, btn.dataset.answer);
      });
    });
  } else {
    // 質問権を消費した途中回答(type: 'guess')の正誤判定
    actionArea.innerHTML = `
      <div class="pending-card">
        <p class="pending-label">相手の回答: ${escapeHtml(p.text)}</p>
        <div class="judge-grid">
          <button id="judgeCorrectBtn" class="answer-btn ans-correct" type="button">正解</button>
          <button id="judgeIncorrectBtn" class="answer-btn ans-incorrect" type="button">ハズレ</button>
        </div>
      </div>`;
    $('judgeCorrectBtn').addEventListener('click', async () => {
      actionArea.querySelectorAll('button').forEach((b) => (b.disabled = true));
      await judgeEarlyGuess(room.code, p, true, state.topicLocal);
    });
    $('judgeIncorrectBtn').addEventListener('click', async () => {
      actionArea.querySelectorAll('button').forEach((b) => (b.disabled = true));
      await judgeEarlyGuess(room.code, p, false, null);
    });
  }
}

function renderGuestInput(actionArea, room) {
  if (room.phase === 'final_guess') {
    actionArea.innerHTML = `
      <div class="final-guess-card">
        <p class="pending-label">質問権を使い切りました。最終回答をどうぞ。</p>
        <textarea id="finalGuessInput" class="topic-input" placeholder="お題は何だと思いますか？"></textarea>
        <button id="submitFinalBtn" class="primary-btn" type="button">これで回答する</button>
      </div>`;
    $('submitFinalBtn').addEventListener('click', async () => {
      const text = $('finalGuessInput').value.trim();
      if (!text) { showToast('回答を入力してください'); return; }
      $('submitFinalBtn').disabled = true;
      await submitFinalGuess(room.code, text);
    });
    return;
  }
  actionArea.innerHTML = `
    <div class="question-input-card">
      <textarea id="questionInput" class="question-input" placeholder="はい/いいえで答えられる質問を書いてください"></textarea>
      <div class="question-buttons">
        <button id="sendQuestionBtn" class="primary-btn" type="button">質問する</button>
        <button id="useGuessBtn" class="secondary-btn" type="button">質問権を使って回答する</button>
      </div>
    </div>`;
  $('sendQuestionBtn').addEventListener('click', async () => {
    const text = $('questionInput').value.trim();
    if (!text) { showToast('質問を入力してください'); return; }
    $('sendQuestionBtn').disabled = true;
    await submitPending(room.code, 'question', text, room.turnsUsed || 0);
  });
  $('useGuessBtn').addEventListener('click', async () => {
    const text = prompt('質問権を1つ使って回答します。回答内容を入力してください');
    if (!text || !text.trim()) return;
    await submitPending(room.code, 'guess', text.trim(), room.turnsUsed || 0);
  });
}

function renderEnded(room) {
  const role = myRole(room);
  const isCorrect = room.result === 'correct';
  const logHtml = (room.log || []).map(logEntryLine).join('');
  app.innerHTML = `
    <section class="ended-view">
      <div class="result-card ${isCorrect ? 'is-correct' : 'is-incorrect'}">
        <div class="result-mark">${isCorrect ? '🎉' : '😵'}</div>
        <h1>${isCorrect ? '正解！' : '不正解…'}</h1>
        <p class="topic-reveal">お題は「${escapeHtml(room.topic || '')}」でした</p>
      </div>
      <div class="log-area">${logHtml}</div>
      <div id="swapArea" class="swap-area"></div>
      <button id="homeBtn" class="secondary-btn" type="button">ホームに戻る</button>
    </section>`;

  const swapArea = $('swapArea');
  if (role === 'host') {
    swapArea.innerHTML = `
      <p class="field-label">次のラウンド、親を交代しますか？</p>
      <div class="swap-buttons">
        <button id="swapYesBtn" class="primary-btn" type="button">交代する</button>
        <button id="swapNoBtn" class="secondary-btn" type="button">このまま続ける</button>
      </div>`;
    $('swapYesBtn').addEventListener('click', async () => {
      swapArea.querySelectorAll('button').forEach((b) => (b.disabled = true));
      await startNextRound(room.code, true);
    });
    $('swapNoBtn').addEventListener('click', async () => {
      swapArea.querySelectorAll('button').forEach((b) => (b.disabled = true));
      await startNextRound(room.code, false);
    });
  } else {
    swapArea.innerHTML = `<p class="hint-text">親が次のラウンドを準備しています…</p>`;
  }
  $('homeBtn').addEventListener('click', leaveRoom);
}

// ------------------------------------------------------------------
// 対戦終了時、この端末のローカル履歴(データタブ)に保存する
// ------------------------------------------------------------------
async function saveCompletedGameLocally(room) {
  const key = `${room.code}:${room.turnsUsed}:${room.result}`;
  if (state.savedEndedKey === key) return;
  state.savedEndedKey = key;
  const role = myRole(room);
  await putGame({
    id: `${room.code}-${Date.now()}`,
    roomCode: room.code,
    role,
    topic: room.topic,
    result: room.result,
    log: room.log || [],
    finalGuessText: room.finalGuessText || null,
    turnsUsed: room.turnsUsed || 0,
    endedAt: Date.now(),
  });
  if (state.tab === 'data') await refreshDataGames();
}

// ------------------------------------------------------------------
// データタブ(ピックノートの一覧→タップで展開、と同じ考え方)
// ------------------------------------------------------------------
async function refreshDataGames() {
  state.dataGames = await listGames();
}

function formatDate(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts);
}

async function renderDataTab() {
  if (!state.dataGames.length) await refreshDataGames();
  const games = state.dataGames;
  app.innerHTML = `
    <section class="data-view">
      <div class="dictionary-head-card"><h1>対戦データ</h1><p>完了した対戦の記録です。タップで質問・回答の履歴を見られます。</p></div>
      <div id="gameList" class="game-list">
        ${games.length ? '' : '<p class="hint-text">まだ記録がありません</p>'}
      </div>
    </section>`;
  const list = $('gameList');
  for (const game of games) {
    const row = document.createElement('div');
    row.className = 'game-row';
    const isCorrect = game.result === 'correct';
    row.innerHTML = `
      <button class="game-row-head" type="button">
        <span class="game-result-dot ${isCorrect ? 'is-correct' : 'is-incorrect'}"></span>
        <span class="game-topic">${escapeHtml(game.topic || '(無題)')}</span>
        <span class="game-role">${game.role === 'host' ? '親' : '子'}</span>
        <span class="game-date">${formatDate(game.endedAt)}</span>
      </button>
      <div class="game-row-body" hidden></div>`;
    const head = row.querySelector('.game-row-head');
    const body = row.querySelector('.game-row-body');
    head.addEventListener('click', () => {
      const open = !body.hidden;
      body.hidden = open;
      if (!open && !body.dataset.filled) {
        body.dataset.filled = '1';
        body.innerHTML = (game.log || []).map(logEntryLine).join('') +
          (game.finalGuessText ? `<p class="hint-text">最終回答: ${escapeHtml(game.finalGuessText)}</p>` : '') +
          `<button class="delete-game-btn" type="button">この記録を削除</button>`;
        body.querySelector('.delete-game-btn').addEventListener('click', async () => {
          await deleteGame(game.id);
          await refreshDataGames();
          render();
        });
      }
    });
    list.append(row);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ------------------------------------------------------------------
// 起動
// ------------------------------------------------------------------
async function init() {
  for (const btn of bottomTabbar.querySelectorAll('button')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
  const active = loadActiveRoom();
  if (active?.code) {
    enterRoom(active.code);
  } else {
    render();
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('SW registration failed', error));
  }
}

init().catch((error) => {
  console.error(error);
  alert('アプリを起動できませんでした。ブラウザを再読み込みしてください。');
});
