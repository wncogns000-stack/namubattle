// 로그인한 학생의 접속 상태, 대결 신청/수락(선생님이 켰을 때), 진행 중인 대결 연결
// 자동 매칭(대결 찾기)은 matchmaking.js
import { db } from './db.js';
import { store, standingOf, isOnline, subscribe, battleOpen } from './store.js';
import { HEARTBEAT_MS, INVITE_TTL_MS } from './config.js';
import { canMatch, levelForMatch } from './tiers.js';
import { generatePuzzle } from './puzzle.js';
import { h, toast, modal, josa, tierBadge, closeAllModals } from './ui.js';
import { logoutStudent } from './auth.js';
import { startMatchmaking, stopMatchmaking, leaveQueue } from './matchmaking.js';
import { play } from './sound.js';

export const session = {
  uid: null,
  state: 'lobby',
  activeGame: null,
  outgoing: null, // { to, at }
};

const offs = [];
let heartbeatTimer = null;
let inviteQueue = [];
let inviteModalOpen = false;
const handledInvites = new Set();

export const BATTLE_CLOSED_MSG = '지금은 대결 시간이 아니에요. 선생님이 대결을 열면 할 수 있어요.';
export const INVITE_OFF_MSG = '지금은 친구에게 직접 신청할 수 없어요. 대결 찾기를 눌러 주세요.';

// 친구에게 직접 신청할 수 있는지 (선생님이 켜 두고, 대결 시간일 때)
export function directInviteOn() {
  return !!store.settings.directInvite && battleOpen();
}

export function go(hash) {
  if (location.hash !== hash) location.hash = hash;
}

export function myName() {
  return store.users[session.uid]?.name || '';
}

export async function startSession(uid) {
  session.uid = uid;
  store.me = uid;
  const pres = `presence/${uid}`;
  const beat = () => db.update(pres, { at: db.now(), state: session.state, name: myName() || '' }).catch(() => {});
  beat();
  heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
  try { db.onDisconnectRemove(pres); } catch { /* 체험 모드 */ }

  offs.push(db.on(`active/${uid}`, (gid) => {
    session.activeGame = gid || null;
    if (gid) {
      cancelInvite(true);
      leaveQueue({ silent: true });
      closeAllModals();
      inviteQueue = [];
      if (!location.hash.startsWith(`#/game/${gid}`)) go(`#/game/${gid}`);
    }
    renderOutgoingBar();
  }));

  offs.push(db.on(`invites/${uid}`, (v) => {
    const now = db.now();
    inviteQueue = Object.entries(v || {})
      .filter(([, inv]) => inv.status === 'pending' && now - (inv.at || 0) < INVITE_TTL_MS)
      .map(([from, inv]) => ({ from, ...inv }));
    showNextInvite();
  }));

  // 선생님이 대결을 닫거나 직접 신청을 끄면 주고받던 신청을 정리 (이미 시작한 대결은 끝까지 진행)
  offs.push(subscribe((_, what) => {
    if (what !== 'battle' && what !== 'settings') return;
    if (directInviteOn()) return showNextInvite();
    if (session.outgoing) {
      cancelInvite(true);
      toast(battleOpen() ? '선생님이 직접 신청을 꺼서 신청을 취소했어요.' : '선생님이 대결을 닫아서 신청을 취소했어요.', 'warn');
    }
    if (inviteModalOpen) closeAllModals();
  }));

  startMatchmaking();
}

export function stopSession() {
  stopMatchmaking();
  offs.splice(0).forEach((f) => f());
  clearInterval(heartbeatTimer);
  if (session.uid) {
    db.remove(`presence/${session.uid}`).catch(() => {});
    try { db.cancelOnDisconnect(`presence/${session.uid}`); } catch { /* 체험 모드 */ }
  }
  cancelInvite(true);
  session.uid = null;
  session.activeGame = null;
  store.me = null;
  logoutStudent();
}

export function setPresenceState(state) {
  session.state = state;
  if (session.uid) db.update(`presence/${session.uid}`, { at: db.now(), state, name: myName() || '' }).catch(() => {});
}

// ───────── 보내는 신청 ─────────
let outgoingOff = null;
let outgoingTimer = null;

export async function sendInvite(toUid) {
  if (!battleOpen()) {
    toast(BATTLE_CLOSED_MSG, 'warn');
    return;
  }
  if (!store.settings.directInvite) {
    toast(INVITE_OFF_MSG, 'warn');
    return;
  }
  const me = standingOf(session.uid);
  const other = standingOf(toUid);
  if (!canMatch(me, other, store.settings)) {
    toast('티어 차이가 커서 대결할 수 없어요.', 'warn');
    return;
  }
  if (session.outgoing) await cancelInvite(true);
  const at = db.now();
  await db.set(`invites/${toUid}/${session.uid}`, { fromName: myName(), at, status: 'pending' });
  session.outgoing = { to: toUid, at };
  renderOutgoingBar();
  outgoingOff = db.on(`invites/${toUid}/${session.uid}`, (v) => {
    if (!session.outgoing) return;
    if (v && v.status === 'declined') {
      toast(`${josa(store.users[toUid]?.name || '상대', '이/가')} 대결을 거절했어요.`, 'warn');
      cancelInvite(true);
    } else if (v && v.status === 'closed') {
      toast(BATTLE_CLOSED_MSG, 'warn');
      cancelInvite(true);
    } else if (v && v.status === 'off') {
      toast(INVITE_OFF_MSG, 'warn');
      cancelInvite(true);
    } else if (v && v.status === 'busy') {
      toast(`${josa(store.users[toUid]?.name || '상대', '은/는')} 지금 다른 대결 중이에요.`, 'warn');
      cancelInvite(true);
    } else if (!v) {
      // 수락되면 active가 바뀌어 대결 화면으로 이동합니다. 잠깐 기다린 뒤에도 그대로면 취소된 것.
      setTimeout(() => {
        if (session.outgoing && !session.activeGame) {
          cancelInvite(true);
        }
      }, 2500);
    }
  });
  outgoingTimer = setTimeout(() => {
    if (session.outgoing) {
      toast('응답이 없어서 신청을 취소했어요.', 'warn');
      cancelInvite(true);
    }
  }, INVITE_TTL_MS);
}

export async function cancelInvite(silent = false) {
  const o = session.outgoing;
  session.outgoing = null;
  outgoingOff && outgoingOff();
  outgoingOff = null;
  clearTimeout(outgoingTimer);
  if (o) {
    const cur = await db.get(`invites/${o.to}/${session.uid}`).catch(() => null);
    if (cur && cur.at === o.at) await db.remove(`invites/${o.to}/${session.uid}`).catch(() => {});
    if (!silent) toast('신청을 취소했어요.');
  }
  renderOutgoingBar();
}

function renderOutgoingBar() {
  window.dispatchEvent(new Event('nb-outgoing'));
  const bar = document.getElementById('outgoing');
  if (!bar) return;
  bar.innerHTML = '';
  const o = session.outgoing;
  if (!o || session.activeGame) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.appendChild(h('div', { class: 'outgoing-inner' },
    h('span', { class: 'spinner' }),
    h('span', null, `${store.users[o.to]?.name || '친구'}에게 대결 신청 중… 기다려 주세요`),
    h('button', { class: 'btn btn-small', onclick: () => cancelInvite() }, '취소'),
  ));
}

// ───────── 받은 신청 ─────────
async function showNextInvite() {
  if (inviteModalOpen || session.activeGame) return;
  const now = db.now();
  const inv = inviteQueue.find((i) => !handledInvites.has(i.from + ':' + i.at) && now - (i.at || 0) < INVITE_TTL_MS);
  if (!inv || !store.loaded.battle || !store.loaded.settings) return;
  if (!directInviteOn()) {
    handledInvites.add(inv.from + ':' + inv.at);
    await db.update(`invites/${session.uid}/${inv.from}`, { status: battleOpen() ? 'off' : 'closed' }).catch(() => {});
    return showNextInvite();
  }
  if (store.queue?.[session.uid]?.match) return; // 자동 매칭 수락 창이 떠 있는 동안은 잠시 미룸
  if (location.hash.startsWith('#/game/')) return;
  handledInvites.add(inv.from + ':' + inv.at);
  inviteModalOpen = true;
  play('found');
  const st = standingOf(inv.from);
  const ans = await modal({
    title: '⚔️ 대결 신청이 왔어요!',
    body: h('div', { class: 'invite-body' },
      st ? tierBadge(st, { size: 44 }) : null,
      h('p', { class: 'invite-text' }, h('b', null, inv.fromName || '친구'), ' 님이 쌓기나무 대결을 신청했어요.'),
    ),
    buttons: [
      { label: '거절', value: 'no' },
      { label: '수락! 대결 시작', value: 'yes', kind: 'primary' },
    ],
    dismissible: false,
  });
  inviteModalOpen = false;
  if (ans === 'yes') await acceptInvite(inv);
  else if (ans === 'no') await db.update(`invites/${session.uid}/${inv.from}`, { status: 'declined' }).catch(() => {});
  showNextInvite();
}

async function acceptInvite(inv) {
  const me = session.uid;
  const from = inv.from;
  const cur = await db.get(`invites/${me}/${from}`);
  if (!cur || cur.status !== 'pending') {
    toast('신청이 취소되었어요.', 'warn');
    return;
  }
  if (!directInviteOn()) {
    toast(battleOpen() ? INVITE_OFF_MSG : BATTLE_CLOSED_MSG, 'warn');
    await db.update(`invites/${me}/${from}`, { status: battleOpen() ? 'off' : 'closed' });
    return;
  }
  const sMe = standingOf(me), sOther = standingOf(from);
  if (!canMatch(sMe, sOther, store.settings)) {
    toast('티어 차이가 커서 대결할 수 없어요.', 'warn');
    await db.update(`invites/${me}/${from}`, { status: 'declined' });
    return;
  }
  if (!isOnline(from)) {
    toast('상대가 접속해 있지 않아요.', 'warn');
    await db.remove(`invites/${me}/${from}`);
    return;
  }
  const res = await startGame(from, me, { [`invites/${me}/${from}`]: null }, inv.fromName);
  if (res.ok) return;
  if (res.busy === from) {
    await db.update(`invites/${me}/${from}`, { status: 'busy' });
    toast('상대가 이미 다른 대결을 시작했어요.', 'warn');
  } else {
    toast('이미 진행 중인 대결이 있어요.', 'warn');
  }
}

// 두 학생의 대결 시작 (직접 신청 수락·자동 매칭 공통). a = 신청한 쪽 / 먼저 기다린 쪽
// extra: 대결을 만들면서 함께 지울 것(신청서, 대기열 등)
// 반환: { ok: true, gid } 또는 { ok: false, busy: 이미 다른 대결 중인 학생 }
export async function startGame(a, b, extra = {}, aName) {
  const level = levelForMatch(standingOf(a), standingOf(b), store.settings);
  const { puzzle } = generatePuzzle(level);
  const gid = db.newKey();
  const now = db.now();
  const players = { [a]: aName || store.users[a]?.name || '', [b]: store.users[b]?.name || '' };
  await db.set(`games/${gid}`, { players, a, b, puzzle, status: 'playing', createdAt: now });
  // 상대를 먼저 붙잡고(다른 대결에 들어가지 않았는지 확인), 다음에 나
  const claimA = await db.transaction(`active/${a}`, (v) => (v ? undefined : gid));
  if (!claimA.committed || claimA.value !== gid) {
    await db.remove(`games/${gid}`);
    return { ok: false, busy: a };
  }
  const claimB = await db.transaction(`active/${b}`, (v) => (v ? undefined : gid));
  if (!claimB.committed || claimB.value !== gid) {
    await db.remove(`active/${a}`);
    await db.remove(`games/${gid}`);
    return { ok: false, busy: b };
  }
  await db.update('', { [`live/${gid}`]: { players, level: puzzle.level, createdAt: now }, ...extra });
  return { ok: true, gid };
}

export async function leaveFinishedGame(gid, to = '#/lobby') {
  if (!session.uid) return;
  await db.transaction(`active/${session.uid}`, (v) => (v === gid ? null : undefined));
  if (session.activeGame === gid) session.activeGame = null;
  go(to);
}
