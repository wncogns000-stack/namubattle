// 여러 화면이 함께 쓰는 실시간 데이터 (학생 목록, 설정, 접속 상태)
import { db } from './db.js';
import { DEFAULT_SETTINGS, ONLINE_WINDOW_MS } from './config.js';
import { computeStandings } from './tiers.js';
import { battleState, nextChange } from './schedule.js';

export const store = {
  users: {},
  settings: { ...DEFAULT_SETTINGS },
  presence: {},
  live: {},
  battles: {}, // 학교별 대결 시간 { 학교: { open, until } } (기본 학교 main은 config/battle, 다른 학교는 config/battles/학교)
  schedules: {}, // 학교별 대결 시간표 { 학교: { on, days, skip } } (기본 학교 config/schedule, 다른 학교 config/schedules/학교)
  season: {}, // 지금 시즌 { current, startedAt } (없으면 시즌 1)
  seasons: {}, // 마친 시즌의 최종 기록 { 번호: { startedAt, endedAt, players } }
  schools: {}, // 함께 하는 학교 { 학교: { name, createdAt } } — 학교 정보가 없는 학생은 기본 학교(main)
  queue: {}, // 자동 매칭 대기열 { uid: { at, name, last, match, ready } }
  standings: computeStandings({}),
  me: null,
  loaded: { users: false, settings: false, battle: false, schools: false, season: false, seasons: false },
};

const subs = new Set();
let started = false;
let battleTimers = [];
const gotBattle = { main: false, others: false, schedMain: false, schedOthers: false };
let lastBattleKey = '';

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function emit(what) {
  for (const fn of [...subs]) {
    try { fn(store, what); } catch (e) { console.error(e); }
  }
}

function recompute() {
  store.standings = computeStandings(store.users, store.settings);
}

export function startStore() {
  if (started) return;
  started = true;
  db.on('users', (v) => {
    store.users = v || {};
    store.loaded.users = true;
    recompute();
    emit('users');
  });
  db.on('config/settings', (v) => {
    store.settings = { ...DEFAULT_SETTINGS, ...(v || {}) };
    store.loaded.settings = true;
    recompute();
    emit('settings');
  });
  db.on('presence', (v) => {
    store.presence = v || {};
    emit('presence');
  });
  db.on('live', (v) => {
    store.live = v || {};
    emit('live');
  });
  db.on('queue', (v) => {
    store.queue = v || {};
    emit('queue');
  });
  db.on('config/season', (v) => {
    store.season = v || {};
    store.loaded.season = true;
    emit('season');
  });
  db.on('seasons', (v) => {
    store.seasons = v || {};
    store.loaded.seasons = true;
    emit('seasons');
  });
  db.on('schools', (v) => {
    store.schools = v || {};
    store.loaded.schools = true;
    emit('schools');
  });
  // 대결 시간: 기본 학교는 예전 그대로 config/battle, 다른 학교는 config/battles/학교 (시간표도 같은 방식)
  const battleChanged = () => {
    store.loaded.battle = gotBattle.main && gotBattle.others && gotBattle.schedMain && gotBattle.schedOthers;
    lastBattleKey = battleKey();
    armBattleTimer();
    emit('battle');
  };
  db.on('config/battle', (v) => {
    store.battles = { ...store.battles, main: v || {} };
    gotBattle.main = true;
    battleChanged();
  });
  db.on('config/battles', (v) => {
    store.battles = { ...(v || {}), main: store.battles.main || {} };
    gotBattle.others = true;
    battleChanged();
  });
  db.on('config/schedule', (v) => {
    store.schedules = { ...store.schedules, main: v || {} };
    gotBattle.schedMain = true;
    battleChanged();
  });
  db.on('config/schedules', (v) => {
    store.schedules = { ...(v || {}), main: store.schedules.main || {} };
    gotBattle.schedOthers = true;
    battleChanged();
  });
  // 태블릿이 잠들었다 깨면 타이머가 늦을 수 있어서, 20초마다·화면이 다시 켜질 때도 열림·닫힘이 바뀌었는지 확인
  setInterval(battleTick, 20_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) battleTick(); });
}

// 정해 둔 시각(시간표 시작·끝, '40분 동안' 끝)이 되면 화면들이 열림·닫힘을 다시 그리도록 알림
const allSchools = () => [...new Set(['main', ...Object.keys(store.schools), ...Object.keys(store.battles), ...Object.keys(store.schedules)])];
const battleKey = () => JSON.stringify(allSchools().map((sid) => { const b = battleInfo(sid); return [sid, b.open, b.until]; }));

function battleTick() {
  const key = battleKey();
  if (key !== lastBattleKey) {
    lastBattleKey = key;
    emit('battle');
  }
  armBattleTimer();
}

function armBattleTimer() {
  battleTimers.forEach(clearTimeout);
  battleTimers = [];
  const now = db.now();
  const times = allSchools().map((sid) => nextChange(battleOf(sid), scheduleOf(sid), now)).filter(Boolean);
  if (!times.length) return;
  const left = Math.min(...times) - now;
  battleTimers.push(setTimeout(battleTick, Math.min(Math.max(left, 0) + 500, 6 * 3600_000)));
}

// 학생의 학교 (학교 정보가 없으면 기본 학교 main — 처음부터 있던 학생들)
export function schoolOf(uid) {
  return store.users[uid]?.school || 'main';
}

// 로그인한 학생의 학교
export function mySchool() {
  return store.me ? schoolOf(store.me) : 'main';
}

export function battleOf(sid = mySchool()) {
  return store.battles[sid] || {};
}

export function scheduleOf(sid = mySchool()) {
  return store.schedules[sid] || {};
}

// 그 학교 대결이 열려 있는지 (선생님이 직접 연 것 + 시간표). 학교를 안 주면 로그인한 학생의 학교
// → { open, until, auto(시간표로 열림), overridden(시간표 시간인데 선생님이 닫음), next(다음 시간표 시각) }
export function battleInfo(sid) {
  const id = sid || mySchool();
  return battleState(battleOf(id), scheduleOf(id), db.now());
}

export function battleOpen(sid) {
  return battleInfo(sid).open;
}

export function isOnline(uid) {
  const p = store.presence[uid];
  return !!(p && db.now() - (p.at || 0) < ONLINE_WINDOW_MS);
}

export function presenceState(uid) {
  return isOnline(uid) ? store.presence[uid].state || 'lobby' : 'offline';
}

export function myStanding() {
  return store.me ? store.standings.byUid[store.me] : null;
}

export function standingOf(uid) {
  return store.standings.byUid[uid] || null;
}

// 데이터가 처음 도착할 때까지 기다리기
export function whenLoaded() {
  const ready = () => store.loaded.users && store.loaded.settings && store.loaded.schools && store.loaded.season && store.loaded.seasons;
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = subscribe(() => {
      if (ready()) {
        off();
        resolve();
      }
    });
  });
}
