import { test } from 'node:test';
import assert from 'node:assert/strict';

// 브라우저의 localStorage 흉내
class MemoryStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { addEventListener() {} };

const { createLocalAdapter } = await import('../js/db.js');

test('체험 모드 저장소: 읽기/쓰기/여러 곳 쓰기/지우기', async () => {
  localStorage.clear();
  const db = createLocalAdapter();
  await db.set('users/u1', { name: '가', rating: 1000 });
  await db.set('users/u2', { name: '나', rating: 990 });
  assert.deepEqual(await db.get('users/u1'), { name: '가', rating: 1000 });
  assert.equal(await db.get('users/u1/name'), '가');
  assert.deepEqual(Object.keys(await db.get('users')), ['u1', 'u2']);
  await db.update('', { 'users/u1/rating': 1016, 'history/u1/g1': { win: true }, 'live/g1': { a: 1 } });
  assert.equal(await db.get('users/u1/rating'), 1016);
  assert.deepEqual(await db.get('history/u1'), { g1: { win: true } });
  await db.update('', { 'live/g1': null, 'users/u2': null });
  assert.equal(await db.get('live'), null);
  assert.equal(await db.get('users/u2'), null);
  assert.equal(await db.get('nothing/here'), null);
});

test('체험 모드 저장소: 위쪽 경로 통째로 지우기', async () => {
  localStorage.clear();
  const db = createLocalAdapter();
  await db.set('builds/g1/u1', '012');
  await db.set('builds/g1/u2', '210');
  await db.set('builds/g2/u1', '111');
  assert.deepEqual(await db.get('builds/g1'), { u1: '012', u2: '210' });
  await db.update('', { builds: null });
  assert.equal(await db.get('builds'), null);
  assert.equal(localStorage.length, 0);
});

test('체험 모드 저장소: 트랜잭션', async () => {
  localStorage.clear();
  const db = createLocalAdapter();
  let r = await db.transaction('active/u1', (v) => (v ? undefined : 'g1'));
  assert.equal(r.committed, true);
  assert.equal(r.value, 'g1');
  r = await db.transaction('active/u1', (v) => (v ? undefined : 'g2'));
  assert.equal(r.committed, false);
  assert.equal(await db.get('active/u1'), 'g1');
  await db.set('games/g1', { status: 'playing', attempts: { a: { ok: false } } });
  r = await db.transaction('games/g1', (g) => { g.status = 'finished'; g.lock = null; return g; });
  assert.deepEqual(r.value, { status: 'finished', attempts: { a: { ok: false } } });
});

test('체험 모드 저장소: 값이 바뀌면 알림', async () => {
  localStorage.clear();
  const db = createLocalAdapter();
  const seen = [];
  const off = db.on('invites/u1', (v) => seen.push(v));
  await new Promise((r) => setTimeout(r, 5));
  await db.set('invites/u1/u2', { status: 'pending' });
  await new Promise((r) => setTimeout(r, 5));
  await db.set('presence/u9', { at: 1 }); // 상관없는 곳
  await new Promise((r) => setTimeout(r, 5));
  off();
  assert.deepEqual(seen, [null, { u2: { status: 'pending' } }]);
});
