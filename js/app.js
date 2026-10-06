// 시작점: 데이터 연결 → 로그인 상태 복원 → 화면 전환(라우터)
import { initDB } from './db.js';
import { startStore, store, subscribe, whenLoaded, myStanding } from './store.js';
import { currentUid } from './auth.js';
import { session, startSession, stopSession, go } from './session.js';
import { h, tierBadge, confirmBox } from './ui.js';
import { startUpdates } from './update.js';
import * as login from './screens/login.js';
import * as lobby from './screens/lobby.js';
import * as game from './screens/game.js';
import * as practice from './screens/practice.js';
import * as ranking from './screens/ranking.js';
import * as history from './screens/history.js';
import * as teacher from './screens/teacher.js';

const ROUTES = {
  login: { screen: login, auth: false },
  lobby: { screen: lobby, auth: true },
  game: { screen: game, auth: true },
  practice: { screen: practice, auth: true },
  ranking: { screen: ranking, auth: false },
  history: { screen: history, auth: false },
  teacher: { screen: teacher, auth: false },
};

let cleanup = null;
const app = document.getElementById('app');

function parseHash() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = parts[0] || (session.uid ? 'lobby' : 'login');
  return { name, params: parts.slice(1).map(decodeURIComponent) };
}

function render() {
  let { name, params } = parseHash();
  if (!ROUTES[name]) name = session.uid ? 'lobby' : 'login';
  const route = ROUTES[name];
  if (name === 'history' && !params[0] && !session.uid) return go('#/login');
  if (route.auth && !session.uid) return go('#/login');
  if (name === 'login' && session.uid) return go('#/lobby');
  // 진행 중인 대결이 있으면 그 대결로
  if (session.activeGame && name !== 'game' && name !== 'teacher') return go(`#/game/${session.activeGame}`);

  if (cleanup) {
    try { cleanup(); } catch (e) { console.error(e); }
    cleanup = null;
  }
  app.innerHTML = '';
  window.scrollTo(0, 0);
  document.body.dataset.route = name;
  renderNav(name);
  cleanup = route.screen.mount(app, params) || null;
}

function renderNav(active) {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  const link = (hash, label, key) => h('a', { href: hash, class: active === key ? 'on' : '' }, label);
  if (session.uid) {
    const me = myStanding();
    const inGame = active === 'game';
    const items = [
      inGame ? null : link('#/lobby', '🏠 로비', 'lobby'),
      inGame ? null : link('#/practice', '🧩 연습', 'practice'),
      inGame ? null : link('#/ranking', '🏆 랭킹', 'ranking'),
      inGame ? null : link('#/history', '📜 내 전적', 'history'),
      h('span', { class: 'nav-me' }, me ? tierBadge(me, { size: 22, showName: false }) : null, h('b', null, store.users[session.uid]?.name || '')),
      inGame ? null : h('button', { class: 'btn btn-small btn-ghost', onclick: async () => {
        if (await confirmBox('로그아웃', '로그아웃할까요?', '로그아웃')) {
          stopSession();
          go('#/login');
          render();
        }
      } }, '로그아웃'),
    ];
    nav.append(...items.filter(Boolean));
  } else {
    nav.append(link('#/login', '로그인', 'login'), link('#/ranking', '🏆 랭킹', 'ranking'), link('#/teacher', '선생님', 'teacher'));
  }
}

async function main() {
  startUpdates(() => parseHash().name);
  try {
    await initDB();
  } catch (e) {
    console.error(e);
    app.innerHTML = '';
    app.append(h('div', { class: 'center-page' }, h('section', { class: 'card error-card' },
      h('h2', null, '서버에 연결하지 못했어요'),
      h('p', null, '인터넷 연결을 확인하고 새로고침 해 주세요.'),
      h('p', { class: 'muted small' }, '선생님께: Firebase 설정값(js/firebase-config.js)과 "익명 로그인" 사용 설정, Realtime Database 규칙을 확인해 주세요. (README 참고)'),
      h('pre', { class: 'small' }, String(e?.message || e)),
    )));
    return;
  }
  startStore();
  await whenLoaded();
  const uid = currentUid();
  if (uid && store.users[uid]) await startSession(uid);
  else if (uid) stopSession();
  window.addEventListener('hashchange', render);
  // 이름·티어가 바뀌면 위쪽 메뉴도 새로
  subscribe((_, what) => { if (what === 'users' && session.uid) renderNav(parseHash().name); });
  // 내 계정이 지워지면 로그아웃
  subscribe((_, what) => {
    if (what === 'users' && session.uid && !store.users[session.uid]) {
      stopSession();
      go('#/login');
    }
  });
  render();
}

main();
