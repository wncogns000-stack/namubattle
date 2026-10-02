// 여러 화면이 함께 쓰는 실시간 데이터 (학생 목록, 설정, 접속 상태)
import { db } from './db.js';
import { DEFAULT_SETTINGS, ONLINE_WINDOW_MS } from './config.js';
import { computeStandings } from './tiers.js';

export const store = {
  users: {},
  settings: { ...DEFAULT_SETTINGS },
  presence: {},
  live: {},
  standings: computeStandings({}),
  me: null,
  loaded: { users: false, settings: false },
};

const subs = new Set();
let started = false;

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
  if (store.loaded.users && store.loaded.settings) return Promise.resolve();
  return new Promise((resolve) => {
    const off = subscribe(() => {
      if (store.loaded.users && store.loaded.settings) {
        off();
        resolve();
      }
    });
  });
}
