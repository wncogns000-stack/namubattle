// 자동 매칭 ('⚔️ 대결 찾기')
//
// 대기열: queue/{uid} = { at(들어온 시각), name, last(직전 상대), match: { id, with, by, at }, ready }
//  1) 대결 찾기 → 대기열에 들어가요.
//  2) 나보다 늦게 들어온 친구 중 티어 조건이 맞는 친구를 무작위로 골라 짝을 걸어요.
//     (상대 → 나 순서로 트랜잭션: 동시에 같은 친구를 잡으려 하면 먼저 잡은 쪽만 성공)
//  3) 두 사람에게 '상대를 찾았어요!' 창이 뜨고 5초를 세요(수락 없음). 5초가 지나면 짝을 건 쪽이 대결을 만들어요.
//     (그만 찾기 버튼이 없어서 상대를 보고 피할 수 없어요)
//  4) 그사이 상대가 대기열에서 빠지면(로그아웃 등) 기다린 순서 그대로 다시 찾아요.
// 서버 없이 각 학생의 기기가 이 규칙대로 움직여요. 기다리는 동안 혼자 연습 등 다른 화면에 있어도 돼요.
import { db } from './db.js';
import { store, subscribe, battleOpen, isOnline, standingOf, schoolOf } from './store.js';
import { MATCH_COUNTDOWN_MS } from './config.js';
import { pickOpponent, canMatch } from './tiers.js';
import { h, toast, modal, tierBadge, josa, fmtClock } from './ui.js';
import { session, myName, startGame, BATTLE_CLOSED_MSG } from './session.js';
import { play } from './sound.js';
import { schoolChip } from './schools.js';

const MATCH_GRACE_MS = 4000;   // 짝을 거는 중(두 번에 나눠 저장)이라 잠깐 어긋나 보일 수 있는 시간
const START_WAIT_MS = 15_000;  // 5초가 지난 뒤 짝을 건 쪽이 대결을 만들기를 기다리는 시간 (예전 버전 기기의 수락 15초까지)

const mm = {
  on: false, offs: [], timer: null,
  busy: false,          // 짝 거는 중
  wasQueued: false,     // 대기열에 있었는지 (밖에서 지워졌을 때 알려 주려고)
  leavingUntil: 0,      // 나가기를 눌러 지우는 중
  found: null,          // 떠 있는 '상대를 찾았어요' 창 { id, close, els, tick }
  done: new Set(),      // 짝마다 한 번만 할 일 (알림 등)
  confirmed: new Set(), // 내가 건 짝 중 서버가 확인한 것 (확인 전에는 창을 띄우지 않음)
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
      leaveQueue({ msg: '대결 시간이 끝나서 대결 찾기를 멈췄어요.' });
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
  closeFound();
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
    closeFound();
    if (mm.wasQueued) {
      mm.wasQueued = false;
      // 대결이 시작돼서 지워진 경우는 알리지 않음
      setTimeout(() => {
        if (!session.activeGame && !isQueued()) toast(battleOpen() ? '대결 찾기가 멈췄어요.' : '대결 시간이 끝나서 대결 찾기를 멈췄어요.', 'warn');
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
    closeFound();
    tryMatch();
  }
  renderBar();
}

async function tryMatch() {
  if (mm.busy || !battleOpen()) return;
  const uid = session.uid;
  // 상대도 접속 중이고 그 학교도 대결 시간이어야 함. 여러 학교면 되도록 다른 학교 친구와
  const openBy = {}; // 학교별로 한 번만 계산
  const schoolOpen = (sid) => (openBy[sid] ??= battleOpen(sid));
  const opp = pickOpponent(uid, store.queue, store.standings.byUid, store.settings, Math.random,
    (u) => isOnline(u) && schoolOpen(schoolOf(u)), schoolOf);
  if (!opp) return;
  mm.busy = true;
  try {
    const id = db.newKey();
    const at = db.now();
    const claim = (who, other) => db.transaction(`queue/${who}`,
      (v) => (v && !v.match ? { ...v, match: { id, with: other, by: uid, at }, ready: null } : undefined));
    const a = await claim(opp, uid);
    if (!a.committed || a.value?.match?.id !== id) return;
    const b = await claim(uid, opp);
    if (!b.committed || b.value?.match?.id !== id) await unmatch(opp, id); // 그 사이 다른 친구가 나를 잡았으면 되돌림
    else mm.confirmed.add(id);
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
  // 대결을 만드는 중이면 그대로 둠 (상대 기기가 먼저 대결 화면으로 넘어가며 대기열에서 빠져도 '상대가 멈췄다'로 보지 않도록)
  if (mm.done.has(`start:${m.id}`)) return;
  const backToSearch = (text) => {
    closeFound();
    unmatch(uid, m.id);
    if (text && once(`reset:${m.id}`)) toast(text, 'warn');
  };
  // 내가 건 짝은 서버가 확인한 뒤에만 창을 띄움 (여럿이 동시에 같은 친구를 잡으면 내 화면에만 잠깐 짝이 보였다 사라질 수 있음)
  if (m.by === uid && !mm.confirmed.has(m.id)) {
    if (!mm.busy && age > MATCH_GRACE_MS) backToSearch(null);
    return;
  }
  if (!opp || opp.match?.id !== m.id) {
    const shown = mm.found?.id === m.id;
    // 5초가 지난 뒤면 대결을 만드는 중: 짝을 건 쪽 기기가 먼저 대결 화면으로 넘어가며 대기열에서 빠질 수 있으니 대결이 오기를 기다림
    if (shown && age >= MATCH_COUNTDOWN_MS) {
      if (age > MATCH_COUNTDOWN_MS + START_WAIT_MS) backToSearch('대결을 시작하지 못해서 다시 찾고 있어요.');
      return;
    }
    if (age > MATCH_GRACE_MS) backToSearch(shown ? (opp ? '짝이 풀려서 다시 찾고 있어요.' : '상대가 대결 찾기를 멈춰서 다시 찾고 있어요.') : null);
    return;
  }
  // 예전 버전(수락 방식) 기기와 짝지어져도 시작되도록 '준비됨' 표시
  if (!e.ready && once(`ready:${m.id}`)) {
    db.transaction(`queue/${uid}`, (v) => (v && v.match?.id === m.id ? { ...v, ready: true } : undefined)).catch(() => {});
  }
  showFound(m, opp, age);
  if (age < MATCH_COUNTDOWN_MS) return;
  // 5초가 지나면 짝을 건 쪽이 대결을 만듦
  if (m.by === uid) startMatchGame(m);
  else if (age > MATCH_COUNTDOWN_MS + START_WAIT_MS) backToSearch('대결을 시작하지 못해서 다시 찾고 있어요.');
}

async function startMatchGame(m) {
  if (!once(`start:${m.id}`)) return;
  const uid = session.uid;
  const res = await startGame(uid, m.with, { [`queue/${uid}`]: null, [`queue/${m.with}`]: null });
  if (res.ok) return;
  // 상대가 이미 다른 대결 중이면 그 친구는 대기열에서 빼고 나는 다시 찾기
  if (res.busy === m.with) await db.remove(`queue/${m.with}`).catch(() => {});
  closeFound();
  await unmatch(uid, m.id);
  toast('상대가 이미 다른 대결을 시작했어요. 다시 찾고 있어요.', 'warn');
}

// ───────── '상대를 찾았어요' 창 (5초 세기) ─────────
function showFound(m, opp, age) {
  if (mm.found?.id !== m.id) {
    closeFound();
    const st = standingOf(m.with);
    const name = opp.name || store.users[m.with]?.name || '친구';
    const els = {
      count: h('b', { class: 'found-count' }),
      status: h('p', { class: 'ready-status' }),
    };
    // 숫자가 매끄럽게 줄고 5초가 되자마자 시작하도록 창이 떠 있는 동안 자주 확인
    mm.found = { id: m.id, els, close: null, tick: setInterval(check, 200) };
    play('found');
    modal({
      title: '⚔️ 대결 상대를 찾았어요!',
      className: 'ready-modal found-modal',
      dismissible: false,
      buttons: [],
      body: h('div', { class: 'ready-body' },
        h('div', { class: 'invite-body' },
          st ? tierBadge(st, { size: 44 }) : null,
          h('p', { class: 'invite-text' }, schoolChip(m.with), h('b', null, name), `${josa(name, '과/와').slice(name.length)} 대결해요!`),
        ),
        h('div', { class: 'found-countdown' }, els.count),
        els.status,
      ),
      onOpen: (close) => { if (mm.found?.id === m.id) mm.found.close = close; },
    });
  }
  const { els } = mm.found;
  const left = Math.max(0, Math.ceil((MATCH_COUNTDOWN_MS - age) / 1000));
  els.count.textContent = left > 0 ? String(left) : '시작!';
  els.status.textContent = left > 0 ? `${left}초 뒤에 대결이 시작돼요. 준비하세요!` : '대결을 만드는 중…';
}

function closeFound() {
  if (!mm.found) return;
  const { close, tick } = mm.found;
  mm.found = null;
  clearInterval(tick);
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
