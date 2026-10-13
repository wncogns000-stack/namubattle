// 여러 화면이 함께 쓰는 실시간 데이터 (학생 목록, 설정, 접속 상태)
import { db } from './db.js';
import { DEFAULT_SETTINGS, ONLINE_WINDOW_MS } from './config.js';
import { computeStandings, isBattleOpen } from './tiers.js';

export const store = {
  users: {},
  settings: { ...DEFAULT_SETTINGS },
  presence: {},
  live: {},
  battles: {}, // 학교별 대결 시간 { 학교: { open, until } } (기본 학교 main은 config/battle, 다른 학교는 config/battles/학교)
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
const gotBattle = { main: false, others: false };

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
  // 대결 시간: 기본 학교는 예전 그대로 config/battle, 다른 학교는 config/battles/학교
  const battleChanged = () => {
    store.loaded.battle = gotBattle.main && gotBattle.others;
    // 정해 둔 시각이 되면 화면들이 '닫힘'으로 바뀌도록 한 번 더 알림
    battleTimers.forEach(clearTimeout);
    battleTimers = [];
    for (const b of Object.values(store.battles)) {
      const left = (b?.until || 0) - db.now();
      if (b?.open && left > 0) battleTimers.push(setTimeout(() => emit('battle'), Math.min(left + 500, 2 ** 31 - 1)));
    }
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

// 그 학교 선생님이 대결을 열어 두었는지 (학교를 안 주면 로그인한 학생의 학교)
export function battleOpen(sid) {
  return isBattleOpen(battleOf(sid || mySchool()), db.now());
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
