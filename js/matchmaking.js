// 자동 매칭 ('⚔️ 대결 찾기')
//
// 대기열: queue/{uid} = { at(들어온 시각), name, last(직전 상대), match: { id, with, by, at }, ready }
//  1) 대결 찾기 → 대기열에 들어가요.
//  2) 나보다 늦게 들어온 친구 중 티어 조건이 맞는 친구를 무작위로 골라 짝을 걸어요.
//     (상대 → 나 순서로 트랜잭션: 동시에 같은 친구를 잡으려 하면 먼저 잡은 쪽만 성공)
//  3) 두 사람에게 '수락' 창이 떠요(15초). 둘 다 수락하면 짝을 건 쪽이 대결을 만들어요.
//  4) 시간 안에 수락하지 않은 사람은 대기열에서 나가고, 수락한 사람은 기다린 순서 그대로 다시 찾아요.
// 서버 없이 각 학생의 기기가 이 규칙대로 움직여요. 기다리는 동안 혼자 연습 등 다른 화면에 있어도 돼요.
import { db } from './db.js';
import { store, subscribe, battleOpen, isOnline, standingOf } from './store.js';
import { READY_MS } from './config.js';
import { pickOpponent, canMatch } from './tiers.js';
import { h, toast, modal, tierBadge, josa, fmtClock } from './ui.js';
import { session, myName, startGame, BATTLE_CLOSED_MSG } from './session.js';

const MATCH_GRACE_MS = 4000;   // 짝을 거는 중(두 번에 나눠 저장)이라 잠깐 어긋나 보일 수 있는 시간
const START_WAIT_MS = 10_000;  // 둘 다 수락한 뒤 대결이 만들어지기를 기다리는 시간

const mm = {
  on: false, offs: [], timer: null,
  busy: false,          // 짝 거는 중
  wasQueued: false,     // 대기열에 있었는지 (밖에서 지워졌을 때 알려 주려고)
  leavingUntil: 0,      // 나가기를 눌러 지우는 중
  ready: null,          // 떠 있는 수락 창 { id, close, els }
  done: new Set(),      // 짝마다 한 번만 할 일 (알림 등)
};

const myEntry = () => (session.uid ? store.queue?.[session.uid] || null : null);
export const isQueued = () => !!myEntry();

// 로비에서 보여 줄 정보
export function queueInfo() {
  const e = myEntry();
  const me = standingOf(session.uid);
  const others = Object.keys(store.queue || {}).filter((u) => u !== session.uid && isOnline(u));
  return {
    queued: !!e,
    matched: !!e?.match,
    waitedMs: e ? Math.max(0, db.now() - e.at) : 0,
    searching: others.length + (e ? 1 : 0),
    eligible: others.filter((u) => canMatch(me, standingOf(u), store.settings)).length,
  };
}

export function startMatchmaking() {
  if (mm.on) return;
  mm.on = true;
  db.remove(`queue/${session.uid}`).catch(() => {}); // 새로고침 전에 남아 있던 것 정리
  mm.offs.push(subscribe((_, what) => {
    if (what === 'battle' && !battleOpen() && isQueued()) {
      leaveQueue({ msg: '선생님이 대결을 닫아서 대결 찾기를 멈췄어요.' });
      return;
    }
    if (what === 'queue' || what === 'users' || what === 'settings') check();
  }));
  mm.timer = setInterval(check, 1000);
  const onHash = () => renderBar();
  window.addEventListener('hashchange', onHash);
  mm.offs.push(() => window.removeEventListener('hashchange', onHash));
}

export function stopMatchmaking() {
  if (!mm.on) return;
  leaveQueue({ silent: true });
  mm.offs.splice(0).forEach((f) => f());
  clearInterval(mm.timer);
  mm.on = false;
  renderBar();
}

export async function joinQueue() {
  const uid = session.uid;
  if (!uid || session.activeGame || isQueued()) return;
  if (!battleOpen()) {
    toast(BATTLE_CLOSED_MSG, 'warn');
    return;
  }
  // 직전 상대 (다른 후보가 있으면 연달아 만나지 않도록)
  let last = null;
  try {
    const hist = Object.values((await db.get(`history/${uid}`)) || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
    last = hist[0]?.opp || null;
  } catch { /* 없어도 됨 */ }
  mm.leavingUntil = 0;
  await db.set(`queue/${uid}`, { at: db.now(), name: myName(), last });
  try { db.onDisconnectRemove(`queue/${uid}`); } catch { /* 체험 모드 */ }
  renderBar();
}

export function leaveQueue({ msg, silent } = {}) {
  const uid = session.uid;
  closeReady();
  if (!uid) return;
  const was = isQueued() || mm.wasQueued;
  mm.wasQueued = false;
  if (was) {
    mm.leavingUntil = db.now() + 5000;
    db.remove(`queue/${uid}`).catch(() => {});
    try { db.cancelOnDisconnect(`queue/${uid}`); } catch { /* 체험 모드 */ }
    if (msg && !silent) toast(msg, 'warn');
  }
  renderBar();
}

// 짝 풀기 (내 쪽 또는 상대 쪽). 같은 짝일 때만
const unmatch = (who, id) => db.transaction(`queue/${who}`, (v) => (v && v.match?.id === id ? { ...v, match: null, ready: null } : undefined)).catch(() => {});

function once(key) {
  if (mm.done.has(key)) return false;
  mm.done.add(key);
  return true;
}

function check() {
  if (!mm.on || !session.uid) return;
  const e = myEntry();
  if (e && db.now() < mm.leavingUntil) return; // 지우는 중
  if (!e) {
    closeReady();
    if (mm.wasQueued) {
      mm.wasQueued = false;
      // 대결이 시작돼서 지워진 경우는 알리지 않음
      setTimeout(() => {
        if (!session.activeGame && !isQueued()) toast(battleOpen() ? '대결 찾기가 멈췄어요.' : '선생님이 대결을 닫아서 대결 찾기를 멈췄어요.', 'warn');
      }, 1500);
    }
    renderBar();
    return;
  }
  mm.wasQueued = true;
  if (session.activeGame) {
    leaveQueue({ silent: true });
    return;
  }
  if (e.match) handleMatch(e);
  else {
    closeReady();
    tryMatch();
  }
  renderBar();
}

async function tryMatch() {
  if (mm.busy || !battleOpen()) return;
  const uid = session.uid;
  const opp = pickOpponent(uid, store.queue, store.standings.byUid, store.settings, Math.random, (u) => isOnline(u));
  if (!opp) return;
  mm.busy = true;
  try {
    const id = db.newKey();
    const at = db.now();
    const claim = (who, other) => db.transaction(`queue/${who}`,
      (v) => (v && !v.match ? { ...v, match: { id, with: other, by: uid, at }, ready: false } : undefined));
    const a = await claim(opp, uid);
    if (!a.committed || a.value?.match?.id !== id) return;
    const b = await claim(uid, opp);
    if (!b.committed || b.value?.match?.id !== id) await unmatch(opp, id); // 그 사이 다른 친구가 나를 잡았으면 되돌림
  } catch (err) {
    console.warn('매칭 실패', err);
  } finally {
    mm.busy = false;
  }
}

function handleMatch(e) {
  const uid = session.uid;
  const m = e.match;
  const opp = store.queue?.[m.with];
  const age = db.now() - m.at;
  const backToSearch = (text) => {
    closeReady();
    unmatch(uid, m.id);
    if (text && once(`reset:${m.id}`)) toast(text, 'warn');
  };
  if (!opp || opp.match?.id !== m.id) {
    if (age > MATCH_GRACE_MS) backToSearch(e.ready ? '상대가 수락하지 않아서 다시 찾고 있어요.' : null);
    return;
  }
  showReady(m, e, opp, age);
  if (!e.ready) {
    if (age > READY_MS && once(`late:${m.id}`)) leaveQueue({ msg: '시간 안에 수락하지 않아서 대결 찾기를 멈췄어요.' });
    return;
  }
  if (!opp.ready) {
    if (age > READY_MS + 2000) backToSearch('상대가 수락하지 않아서 다시 찾고 있어요.');
    return;
  }
  // 둘 다 수락: 짝을 건 쪽이 대결을 만듦
  if (m.by === uid) startMatchGame(m);
  else if (age > READY_MS + START_WAIT_MS) backToSearch('대결을 시작하지 못해서 다시 찾고 있어요.');
}

async function startMatchGame(m) {
  if (!once(`start:${m.id}`)) return;
  const uid = session.uid;
  const res = await startGame(uid, m.with, { [`queue/${uid}`]: null, [`queue/${m.with}`]: null });
  if (res.ok) return;
  // 상대가 이미 다른 대결 중이면 그 친구는 대기열에서 빼고 나는 다시 찾기
  if (res.busy === m.with) await db.remove(`queue/${m.with}`).catch(() => {});
  closeReady();
  await unmatch(uid, m.id);
  toast('상대가 이미 다른 대결을 시작했어요. 다시 찾고 있어요.', 'warn');
}

// ───────── 수락 창 ─────────
function showReady(m, e, opp, age) {
  if (mm.ready?.id !== m.id) {
    closeReady();
    const st = standingOf(m.with);
    const name = opp.name || store.users[m.with]?.name || '친구';
    const els = {
      count: h('span', { class: 'ready-count' }),
      status: h('p', { class: 'ready-status' }),
      accept: h('button', { class: 'btn btn-primary btn-big', onclick: () => accept(m) }, '✅ 수락!'),
    };
    mm.ready = { id: m.id, els, close: null };
    modal({
      title: '⚔️ 대결 상대를 찾았어요!',
      className: 'ready-modal',
      dismissible: false,
      buttons: [],
      body: h('div', { class: 'ready-body' },
        h('div', { class: 'invite-body' },
          st ? tierBadge(st, { size: 44 }) : null,
          h('p', { class: 'invite-text' }, h('b', null, name), `${josa(name, '과/와').slice(name.length)} 대결해요!`),
        ),
        els.status,
        h('div', { class: 'ready-buttons' },
          h('button', { class: 'btn', onclick: () => leaveQueue({ msg: '대결 찾기를 멈췄어요.' }) }, '그만 찾기'),
          els.accept,
        ),
      ),
      onOpen: (close) => { if (mm.ready?.id === m.id) mm.ready.close = close; },
    });
  }
  const { els } = mm.ready;
  const left = Math.max(0, Math.ceil((READY_MS - age) / 1000));
  els.accept.disabled = !!e.ready;
  els.accept.textContent = e.ready ? '수락했어요' : `✅ 수락! (${left})`;
  els.status.className = `ready-status ${e.ready ? 'wait' : ''}`;
  els.status.textContent = e.ready
    ? (opp.ready ? '둘 다 수락했어요! 곧 시작해요…' : '상대가 수락하기를 기다리는 중…')
    : `${left}초 안에 수락하지 않으면 대결 찾기가 멈춰요.`;
}

function accept(m) {
  const uid = session.uid;
  db.transaction(`queue/${uid}`, (v) => (v && v.match?.id === m.id ? { ...v, ready: true } : undefined)).catch(() => {});
}

function closeReady() {
  if (!mm.ready) return;
  const { close } = mm.ready;
  mm.ready = null;
  if (close) close(undefined);
}

// ───────── 다른 화면에서 보이는 '찾는 중' 막대 ─────────
let barEls = null;
function renderBar() {
  const bar = document.getElementById('queuebar');
  const e = myEntry();
  document.body.dataset.queued = e ? '1' : '';
  if (!bar) return;
  const hash = location.hash || '#/lobby';
  const show = !!e && !e.match && mm.on && !session.activeGame && !hash.startsWith('#/lobby') && !hash.startsWith('#/game');
  bar.hidden = !show;
  if (!show) return;
  if (!barEls) {
    barEls = { time: h('b', null, '') };
    bar.innerHTML = '';
    bar.appendChild(h('div', { class: 'outgoing-inner' },
      h('span', { class: 'spinner' }),
      h('span', null, '대결 상대를 찾는 중… ', barEls.time),
      h('button', { class: 'btn btn-small', onclick: () => leaveQueue({ msg: '대결 찾기를 멈췄어요.' }) }, '그만 찾기'),
    ));
  }
  barEls.time.textContent = fmtClock(db.now() - e.at);
}
