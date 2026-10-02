import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  viewsOf, checkBuild, solve, generatePuzzle, seededRandom, puzzleFromHeights,
  heightsToString, heightsFromString, solutionOf, emptyHeights,
} from '../js/puzzle.js';

// 교과서 63쪽 예시: 앞줄 1,2,1 / 가운데 줄 오른쪽 1 / 뒷줄 오른쪽 3
const TEXTBOOK = [1, 2, 1, 0, 0, 1, 0, 0, 3];

test('교과서 63쪽 모양의 위·앞·옆 모양', () => {
  const v = viewsOf(TEXTBOOK, 3);
  // 위에서 본 모양: 앞줄 3칸, 오른쪽 열 3칸
  assert.equal(v.top, '111' + '001' + '001');
  // 앞에서 본 모양: 왼쪽부터 1, 2, 3층
  assert.equal(v.front, '123');
  // 옆(오른쪽)에서 본 모양: 왼쪽=앞줄 2층, 가운데 1층, 오른쪽=뒷줄 3층
  assert.equal(v.side, '213');
  assert.equal(v.count, 8);
});

test('같은 모양이면 정답, 다른 모양이면 오답', () => {
  const p = puzzleFromHeights(TEXTBOOK, 3);
  assert.equal(checkBuild(TEXTBOOK, p).ok, true);
  const wrong = [...TEXTBOOK];
  wrong[0] = 2; // 개수와 앞 모양이 달라짐
  const r = checkBuild(wrong, p);
  assert.equal(r.ok, false);
  assert.equal(r.count, false);
  assert.equal(r.top, true);
});

test('위치를 옮겨서 만들어도 같은 모양이면 정답', () => {
  // 2x2 안쪽 모양을 3x3 판의 오른쪽 뒤로 옮김
  const a = [2, 1, 0, 1, 0, 0, 0, 0, 0];
  const b = [0, 0, 0, 0, 2, 1, 0, 1, 0];
  const p = puzzleFromHeights(a, 3);
  assert.equal(checkBuild(b, p).ok, true);
});

test('좌우로 뒤집은 모양은 오답 (앞/옆 방향이 중요)', () => {
  const a = [2, 1, 0, 1, 0, 0, 0, 0, 0];
  const mirrored = [1, 2, 0, 0, 1, 0, 0, 0, 0];
  const p = puzzleFromHeights(a, 3);
  assert.equal(checkBuild(mirrored, p).ok, false);
});

test('빈 판은 오답', () => {
  const p = puzzleFromHeights(TEXTBOOK, 3);
  assert.equal(checkBuild(emptyHeights(3), p).ok, false);
});

// 3x3, 최대 3층의 모든 높이 지도를 직접 세어 solve와 비교
function bruteCount(p) {
  let cnt = 0;
  const h = new Array(9).fill(0);
  function rec(i) {
    if (i === 9) {
      const v = viewsOf(h, 3);
      if (v.top === p.top && v.front === p.front && v.side === p.side && v.count === p.count) cnt++;
      return;
    }
    for (let k = 0; k <= 3; k++) { h[i] = k; rec(i + 1); }
  }
  rec(0);
  return cnt;
}

test('solve 결과가 완전 탐색과 일치', () => {
  const rng = seededRandom(1234);
  for (let t = 0; t < 40; t++) {
    const h = Array.from({ length: 9 }, () => (rng() < 0.35 ? 0 : 1 + Math.floor(rng() * 3)));
    if (h.every((v) => v === 0)) continue;
    const p = puzzleFromHeights(h, 3);
    const brute = bruteCount(p);
    const mine = solve(p, { limit: 1000 }).length;
    assert.equal(mine, brute, `heights ${h}`);
  }
});

test('생성된 문제는 단계마다 정답이 딱 하나', () => {
  for (const level of [1, 2, 3, 4, 5]) {
    const rng = seededRandom(level * 31);
    for (let i = 0; i < 60; i++) {
      const { puzzle, solution } = generatePuzzle(level, rng);
      assert.equal(puzzle.level, level);
      assert.equal(solve(puzzle, { limit: 3 }).length, 1);
      assert.equal(checkBuild(solution, puzzle).ok, true);
      assert.deepEqual(solutionOf(puzzle), solution);
      assert.ok(Math.max(...solution) <= puzzle.rows);
    }
  }
});

test('높이 지도 문자열 변환', () => {
  const s = heightsToString(TEXTBOOK);
  assert.equal(s, '121001003');
  assert.deepEqual(heightsFromString(s, 3), TEXTBOOK);
  assert.deepEqual(heightsFromString(undefined, 2), [0, 0, 0, 0]);
});
