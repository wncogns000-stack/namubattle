import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS } from '../js/config.js';
import { computeStandings, eloDelta, canMatch, levelForMatch, tierIndexForPosition, streakOf, byOpponent, formatWinRate } from '../js/tiers.js';

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
