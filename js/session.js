// 로그인한 학생의 접속 상태, 대결 신청/수락, 진행 중인 대결 연결
import { db } from './db.js';
import { store, standingOf, isOnline } from './store.js';
import { HEARTBEAT_MS, INVITE_TTL_MS } from './config.js';
import { canMatch, levelForMatch } from './tiers.js';
import { generatePuzzle } from './puzzle.js';
import { h, toast, modal, josa, tierBadge, closeAllModals } from './ui.js';
import { logoutStudent } from './auth.js';

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
}

export function stopSession() {
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
  const inv = inviteQueue.find((i) => !handledInvites.has(i.from + ':' + i.at));
  if (!inv) return;
  if (location.hash.startsWith('#/game/')) return;
  handledInvites.add(inv.from + ':' + inv.at);
  inviteModalOpen = true;
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
  const level = levelForMatch(sMe, sOther, store.settings);
  const { puzzle } = generatePuzzle(level);
  const gid = db.newKey();
  const now = db.now();
  const players = { [from]: inv.fromName || store.users[from]?.name || '', [me]: myName() };
  await db.set(`games/${gid}`, { players, a: from, b: me, puzzle, status: 'playing', createdAt: now });
  // 상대를 먼저 붙잡고(다른 대결에 들어가지 않았는지 확인), 다음에 나
  const claimOther = await db.transaction(`active/${from}`, (v) => (v ? undefined : gid));
  if (!claimOther.committed || claimOther.value !== gid) {
    await db.remove(`games/${gid}`);
    await db.update(`invites/${me}/${from}`, { status: 'busy' });
    toast('상대가 이미 다른 대결을 시작했어요.', 'warn');
    return;
  }
  const claimMe = await db.transaction(`active/${me}`, (v) => (v ? undefined : gid));
  if (!claimMe.committed || claimMe.value !== gid) {
    await db.remove(`active/${from}`);
    await db.remove(`games/${gid}`);
    toast('이미 진행 중인 대결이 있어요.', 'warn');
    return;
  }
  await db.update('', {
    [`live/${gid}`]: { players, level: puzzle.level, createdAt: now },
    [`invites/${me}/${from}`]: null,
  });
}

export async function leaveFinishedGame(gid, to = '#/lobby') {
  if (!session.uid) return;
  await db.transaction(`active/${session.uid}`, (v) => (v === gid ? null : undefined));
  if (session.activeGame === gid) session.activeGame = null;
  go(to);
}
