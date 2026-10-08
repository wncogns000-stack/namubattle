import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS } from '../js/config.js';
import { computeStandings, eloDelta, canMatch, levelForMatch, tierIndexForPosition, streakOf, byOpponent, formatWinRate, isBattleOpen, winsRanking, pickOpponent } from '../js/tiers.js';

test('티어 인원 합계는 25명', () => {
  assert.equal(TIERS.reduce((s, t) => s + t.quota, 0), 25);
});

test('25명이면 티어별 인원이 정확히 정원과 같다', () => {
  const users = {};
  for (let i = 0; i < 25; i++) users['u' + i] = { name: '학생' + i, rating: 1500 - i * 10, wins: 3, losses: 0 };
  const { list } = computeStandings(users, { placementGames: 3 });
  const counts = TIERS.map(() => 0);
  list.forEach((s) => counts[s.tierIndex]++);
  assert.deepEqual(counts, TIERS.map((t) => t.quota));
  assert.equal(list[0].tier.name, '챌린저');
  assert.equal(list[24].tier.name, '아이언');
});

test('배치고사 중인 학생은 티어가 없고 누구와도 대결 가능', () => {
  const users = {
    a: { name: '가', rating: 1200, wins: 5, losses: 0 },
    b: { name: '나', rating: 800, wins: 0, losses: 5 },
    c: { name: '다', wins: 1, losses: 0 },
  };
  const { byUid } = computeStandings(users, { placementGames: 3 });
  assert.equal(byUid.c.ranked, false);
  assert.equal(byUid.c.placementLeft, 2);
  assert.equal(canMatch(byUid.a, byUid.c, { tierGap: 0 }), true);
});

test('티어 차이가 허용 범위를 넘으면 대결 불가', () => {
  const users = {};
  for (let i = 0; i < 25; i++) users['u' + i] = { name: '학생' + i, rating: 1500 - i * 10, wins: 3, losses: 0 };
  const { list } = computeStandings(users, { placementGames: 3 });
  const top = list[0], iron = list[24];
  assert.equal(canMatch(top, iron, { tierGap: 2 }), false);
  assert.equal(canMatch(list[0], list[1], { tierGap: 1 }), true);
  assert.equal(canMatch(list[0], list[0], { tierGap: 9 }), false);
});

test('점수가 같으면 같은 등수', () => {
  const users = {
    a: { name: 'A', rating: 1000, wins: 3, losses: 0 },
    b: { name: 'B', rating: 1000, wins: 3, losses: 0 },
  };
  const { list } = computeStandings(users, { placementGames: 3 });
  assert.equal(list[0].rank, list[1].rank);
  assert.equal(list[0].tierIndex, list[1].tierIndex);
});

test('엘로 점수: 강한 상대를 이기면 더 많이 오른다', () => {
  assert.equal(eloDelta(1000, 1000), 16);
  assert.ok(eloDelta(900, 1100) > eloDelta(1100, 900));
  assert.ok(eloDelta(2000, 500) >= 1);
});

test('적은 인원일 때도 티어 번호가 범위 안', () => {
  for (let n = 1; n <= 30; n++) {
    for (let r = 0; r < n; r++) {
      const t = tierIndexForPosition(r, n);
      assert.ok(t >= 0 && t < TIERS.length);
    }
  }
});

test('문제 단계', () => {
  assert.equal(levelForMatch({ tierIndex: 0 }, { tierIndex: 1 }, {}), 5);
  assert.equal(levelForMatch({ tierIndex: 9 }, { tierIndex: 8 }, {}), 1);
  assert.equal(levelForMatch({ tierIndex: -1 }, { tierIndex: -1 }, {}), 2);
  assert.equal(levelForMatch({ tierIndex: 0 }, { tierIndex: 9 }, { level: 3 }), 3);
});

test('연승과 상대별 전적', () => {
  const h = [
    { opp: 'x', oppName: '철수', win: true, at: 3 },
    { opp: 'y', oppName: '영희', win: true, at: 2 },
    { opp: 'x', oppName: '철수', win: false, at: 1 },
  ];
  assert.deepEqual(streakOf(h), { win: true, n: 2 });
  const o = byOpponent(h);
  assert.equal(o[0].opp, 'x');
  assert.equal(o[0].wins, 1);
  assert.equal(o[0].losses, 1);
  assert.equal(formatWinRate(2, 1), '67%');
  assert.equal(formatWinRate(0, 0), '-');
});

test('선생님이 연 대결 시간', () => {
  assert.equal(isBattleOpen(undefined, 1000), false); // 처음에는 닫혀 있음
  assert.equal(isBattleOpen({}, 1000), false);
  assert.equal(isBattleOpen({ open: false, until: 5000 }, 1000), false);
  assert.equal(isBattleOpen({ open: true }, 1000), true); // 닫을 때까지
  assert.equal(isBattleOpen({ open: true, until: null }, 1000), true);
  assert.equal(isBattleOpen({ open: true, until: 5000 }, 4999), true);
  assert.equal(isBattleOpen({ open: true, until: 5000 }, 5000), false); // 시간이 되면 저절로 닫힘
});

test('승수 랭킹: 티어와 상관없이 승수 순, 같으면 같은 등수', () => {
  const users = {
    a: { name: '가', no: 1, rating: 1300, wins: 3, losses: 0 },  // 높은 티어, 3승
    b: { name: '나', no: 2, rating: 800, wins: 9, losses: 12 },  // 낮은 티어, 9승
    c: { name: '다', no: 3, rating: 900, wins: 3, losses: 7 },   // 3승 (가와 같은 등수)
    d: { name: '라', no: 4, wins: 0, losses: 1 },                // 배치고사, 0승
  };
  const before = JSON.stringify(users);
  const list = winsRanking(computeStandings(users, { placementGames: 3 }).list);
  assert.deepEqual(list.map((s) => [s.name, s.wins, s.winRank]), [['나', 9, 0], ['가', 3, 1], ['다', 3, 1], ['라', 0, 3]]);
  assert.equal(JSON.stringify(users), before); // 원래 데이터는 그대로
});

test('자동 매칭: 상대 고르기 규칙', () => {
  const users = {};
  for (let i = 0; i < 25; i++) users['u' + String(i).padStart(2, '0')] = { name: '학생' + i, rating: 1500 - i * 10, wins: 3, losses: 0 };
  users.new = { name: '새친구', wins: 0, losses: 0 }; // 배치고사
  const { byUid } = computeStandings(users, { placementGames: 3 });
  const S = { tierGap: 2 };
  // u00 챌린저, u24 아이언 → 티어 차이 커서 안 됨
  assert.equal(pickOpponent('u00', { u00: { at: 1 }, u24: { at: 2 } }, byUid, S), null);
  // 배치고사는 누구와도
  assert.equal(pickOpponent('u00', { u00: { at: 1 }, new: { at: 2 } }, byUid, S), 'new');
  // 나보다 먼저 들어온 친구에게는 내가 걸지 않음 (그 친구가 나를 고름)
  assert.equal(pickOpponent('u01', { u00: { at: 1 }, u01: { at: 2 } }, byUid, S), null);
  assert.equal(pickOpponent('u00', { u00: { at: 1 }, u01: { at: 2 } }, byUid, S), 'u01');
  // 같은 시각이면 uid 순서로 한쪽만
  assert.equal(pickOpponent('u00', { u00: { at: 5 }, u01: { at: 5 } }, byUid, S), 'u01');
  assert.equal(pickOpponent('u01', { u00: { at: 5 }, u01: { at: 5 } }, byUid, S), null);
  // 이미 짝이 정해졌거나, 내가 짝이 있으면 안 고름
  assert.equal(pickOpponent('u00', { u00: { at: 1 }, u01: { at: 2, match: { id: 'x' } } }, byUid, S), null);
  assert.equal(pickOpponent('u00', { u00: { at: 1, match: { id: 'x' } }, u01: { at: 2 } }, byUid, S), null);
  // 접속하지 않은 친구 제외
  assert.equal(pickOpponent('u00', { u00: { at: 1 }, u01: { at: 2 } }, byUid, S, Math.random, (u) => u !== 'u01'), null);
  // 직전 상대는 다른 후보가 있으면 피함, 없으면 다시 만남
  const q = { u10: { at: 1, last: 'u11' }, u11: { at: 2 }, u12: { at: 3 } };
  for (let i = 0; i < 20; i++) assert.equal(pickOpponent('u10', q, byUid, S), 'u12');
  assert.equal(pickOpponent('u10', { u10: { at: 1, last: 'u11' }, u11: { at: 2 } }, byUid, S), 'u11');
  // 후보 여럿이면 무작위 (여러 상대가 골고루 나옴)
  const many = { u10: { at: 1 }, u08: { at: 2 }, u09: { at: 3 }, u11: { at: 4 }, u12: { at: 5 } };
  const seen = new Set();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 200; i++) seen.add(pickOpponent('u10', many, byUid, S, rnd));
  assert.ok(seen.size >= 3, `여러 상대가 나와야 함: ${[...seen]}`);
  for (const u of seen) assert.ok(['u08', 'u09', 'u11', 'u12'].includes(u));
});

test('version.json과 앱 버전이 같다 (올릴 때 둘 다 바꿨는지 확인)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../js/update.js', import.meta.url), 'utf8');
  const appVersion = src.match(/APP_VERSION = '([^']+)'/)[1];
  const file = JSON.parse(await readFile(new URL('../version.json', import.meta.url), 'utf8'));
  assert.equal(file.version, appVersion);
});
