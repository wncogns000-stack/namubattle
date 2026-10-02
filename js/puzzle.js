// 쌓기나무 문제 엔진 (화면과 무관한 순수 로직)
//
// 좌표 약속 (교과서 6-2 3단원과 같음)
//   x : 앞에서 볼 때 왼쪽(0) → 오른쪽(n-1)
//   y : 앞줄(0) → 뒷줄(n-1)
//   높이 지도 h[y*n + x] = 그 자리에 쌓인 쌓기나무 수 (위에서 본 모양에 수를 쓰는 방법)
//
// 위에서 본 모양 : n×n, 그림의 아래쪽이 앞(y=0)
// 앞에서 본 모양 : x마다 가장 높은 층 (그림 왼쪽 = x=0)
// 옆에서 본 모양 : 오른쪽에서 본 모양. y마다 가장 높은 층 (그림 왼쪽 = 앞줄 y=0, 오른쪽 = 뒷줄)
//
// 문제(puzzle) 객체 : { n, rows, level, top, front, side, count }
//   top   : 길이 n*n 문자열 ('1' = 쌓기나무가 있는 칸)
//   front : 길이 n 문자열 (x별 높이 숫자)
//   side  : 길이 n 문자열 (y별 높이 숫자)
//   정답 높이 지도는 저장하지 않습니다. 정답 판정은 위·앞·옆 모양과 개수로 합니다.

import { LEVELS } from './config.js';

export function emptyHeights(n) {
  return new Array(n * n).fill(0);
}

export function heightsToString(h) {
  return h.map((v) => String(v)).join('');
}

export function heightsFromString(s, n) {
  const h = emptyHeights(n);
  if (typeof s !== 'string') return h;
  for (let i = 0; i < n * n && i < s.length; i++) h[i] = Number(s[i]) || 0;
  return h;
}

export function viewsOf(h, n) {
  let top = '';
  const front = new Array(n).fill(0);
  const side = new Array(n).fill(0);
  let count = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = h[y * n + x] || 0;
      top += v > 0 ? '1' : '0';
      if (v > front[x]) front[x] = v;
      if (v > side[y]) side[y] = v;
      count += v;
    }
  }
  return { top, front: front.join(''), side: side.join(''), count };
}

// 위에서 본 모양의 바운딩 박스로 잘라 낸 그림들 (위치를 옮겨도 같은 모양으로 보기 위해)
function croppedViews(v, n) {
  let x0 = n, x1 = -1, y0 = n, y1 = -1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (v.top[y * n + x] === '1') {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { top: '', front: '', side: '', count: v.count };
  let top = '';
  for (let y = y0; y <= y1; y++) top += v.top.slice(y * n + x0, y * n + x1 + 1) + '|';
  return {
    top,
    front: v.front.slice(x0, x1 + 1),
    side: v.side.slice(y0, y1 + 1),
    count: v.count,
  };
}

// 학생이 만든 높이 지도가 문제와 맞는지 확인합니다.
// 놓은 위치가 한두 칸 옮겨져 있어도 모양이 같으면 맞는 것으로 봅니다.
export function checkBuild(h, puzzle) {
  const n = puzzle.n;
  const mine = croppedViews(viewsOf(h, n), n);
  const goal = croppedViews(puzzle, n);
  const result = {
    top: mine.top === goal.top,
    front: mine.front === goal.front,
    side: mine.side === goal.side,
    count: mine.count === goal.count,
  };
  result.ok = result.top && result.front && result.side && result.count;
  return result;
}

// 위·앞·옆 모양(과 개수)에 맞는 높이 지도를 찾습니다. limit개까지만 찾습니다.
// useCount=false 이면 개수 조건 없이 찾습니다.
export function solve(puzzle, { limit = 2, useCount = true } = {}) {
  const n = puzzle.n;
  const F = [...puzzle.front].map(Number);
  const S = [...puzzle.side].map(Number);
  const cells = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (puzzle.top[y * n + x] === '1') cells.push({ x, y, cap: Math.min(F[x], S[y]) });
    }
  }
  // 위에서 본 모양에 칸이 있는 열/줄은 앞/옆 모양에서도 높이가 1 이상이어야 하고, 반대도 마찬가지
  for (let x = 0; x < n; x++) {
    const has = cells.some((c) => c.x === x);
    if (has !== F[x] > 0) return [];
  }
  for (let y = 0; y < n; y++) {
    const has = cells.some((c) => c.y === y);
    if (has !== S[y] > 0) return [];
  }
  if (cells.some((c) => c.cap < 1)) return [];

  const N = puzzle.count;
  // 남은 칸들로 만들 수 있는 최소/최대 개수 (가지치기용)
  const restMax = new Array(cells.length + 1).fill(0);
  for (let i = cells.length - 1; i >= 0; i--) restMax[i] = restMax[i + 1] + cells[i].cap;
  // 각 열/줄의 마지막 칸 인덱스 (그때까지 최고 높이를 채웠는지 확인)
  const lastInCol = new Array(n).fill(-1);
  const lastInRow = new Array(n).fill(-1);
  cells.forEach((c, i) => { lastInCol[c.x] = i; lastInRow[c.y] = i; });

  const colMax = new Array(n).fill(0);
  const rowMax = new Array(n).fill(0);
  const cur = new Array(cells.length).fill(0);
  const out = [];

  function rec(i, sum) {
    if (out.length >= limit) return;
    if (useCount) {
      const left = cells.length - i;
      if (sum + left > N) return;          // 남은 칸에 최소 1개씩
      if (sum + restMax[i] < N) return;    // 최대로 쌓아도 모자람
    }
    if (i === cells.length) {
      if (useCount && sum !== N) return;
      const h = emptyHeights(n);
      cells.forEach((c, k) => { h[c.y * n + c.x] = cur[k]; });
      out.push(h);
      return;
    }
    const c = cells[i];
    for (let v = 1; v <= c.cap; v++) {
      const pc = colMax[c.x], pr = rowMax[c.y];
      if (v > pc) colMax[c.x] = v;
      if (v > pr) rowMax[c.y] = v;
      const colOk = lastInCol[c.x] !== i || colMax[c.x] === F[c.x];
      const rowOk = lastInRow[c.y] !== i || rowMax[c.y] === S[c.y];
      if (colOk && rowOk) {
        cur[i] = v;
        rec(i + 1, sum + v);
      }
      colMax[c.x] = pc;
      rowMax[c.y] = pr;
      if (out.length >= limit) return;
    }
  }
  rec(0, 0);
  return out;
}

// 재현 가능한 난수 (테스트용)
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// 서로 이어진(변끼리 맞닿은) 바닥 모양 만들기
function randomFootprint(n, size, rng) {
  const start = randInt(rng, 0, n * n - 1);
  const set = new Set([start]);
  while (set.size < size) {
    const frontier = [];
    for (const i of set) {
      const x = i % n, y = Math.floor(i / n);
      if (x > 0) frontier.push(i - 1);
      if (x < n - 1) frontier.push(i + 1);
      if (y > 0) frontier.push(i - n);
      if (y < n - 1) frontier.push(i + n);
    }
    const cand = frontier.filter((i) => !set.has(i));
    if (!cand.length) break;
    set.add(cand[randInt(rng, 0, cand.length - 1)]);
  }
  return [...set];
}

// 앞쪽·왼쪽으로 붙이기 (그림이 격자 왼쪽 아래부터 그려지도록)
function anchor(h, n) {
  let x0 = n, y0 = n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (h[y * n + x] > 0) { if (x < x0) x0 = x; if (y < y0) y0 = y; }
  }
  if (x0 === n) return h;
  const out = emptyHeights(n);
  for (let y = y0; y < n; y++) for (let x = x0; x < n; x++) {
    out[(y - y0) * n + (x - x0)] = h[y * n + x];
  }
  return out;
}

export function puzzleFromHeights(h, n, level = 0, rows) {
  const v = viewsOf(h, n);
  const maxH = Math.max(...h);
  return { n, rows: rows || Math.max(n, maxH), level, top: v.top, front: v.front, side: v.side, count: v.count };
}

// 정답이 하나뿐인 문제를 만듭니다. { puzzle, solution }
export function generatePuzzle(level = 2, rng = Math.random) {
  const L = LEVELS[level] || LEVELS[2];
  const { n, maxH } = L;
  const rows = Math.max(n, maxH);
  const wantCountNeeded = rng() < L.countNeeded;
  let fallback = null;
  for (let tries = 0; tries < 4000; tries++) {
    const size = randInt(rng, L.cells[0], L.cells[1]);
    const cells = randomFootprint(n, size, rng);
    if (cells.length < L.cells[0]) continue;
    const target = randInt(rng, Math.max(L.count[0], cells.length + 1), Math.min(L.count[1], cells.length * maxH));
    if (target < cells.length + 1) continue;
    let h = emptyHeights(n);
    for (const i of cells) h[i] = 1;
    let sum = cells.length;
    let guard = 0;
    while (sum < target && guard++ < 500) {
      const i = cells[randInt(rng, 0, cells.length - 1)];
      if (h[i] < maxH) { h[i]++; sum++; }
    }
    if (sum !== target) continue;
    // 바닥 모양이 한 줄짜리만 되지 않도록 (앞/옆 모양이 너무 뻔해짐)
    const v = viewsOf(h, n);
    const usedCols = [...v.front].filter((c) => c !== '0').length;
    const usedRows = [...v.side].filter((c) => c !== '0').length;
    if (usedCols < 2 || usedRows < 2) continue;
    h = anchor(h, n);
    const puzzle = puzzleFromHeights(h, n, level, rows);
    const sols = solve(puzzle, { limit: 2 });
    if (sols.length !== 1) continue;
    const countNeeded = solve(puzzle, { limit: 2, useCount: false }).length > 1;
    if (countNeeded === wantCountNeeded) return { puzzle, solution: h };
    if (!fallback) fallback = { puzzle, solution: h };
  }
  if (fallback) return fallback;
  // 만일을 위한 고정 문제 (교과서 63쪽 모양)
  const h = [1, 2, 1, 0, 0, 1, 0, 0, 3];
  return { puzzle: puzzleFromHeights(h, 3, level, 3), solution: h };
}

// 문제의 정답(하나뿐) 높이 지도. 결과 화면에서 보여 줄 때 씁니다.
export function solutionOf(puzzle) {
  const s = solve(puzzle, { limit: 1 });
  return s[0] || null;
}
