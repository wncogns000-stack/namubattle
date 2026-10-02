// 위·앞·옆에서 본 모양을 교과서처럼 그립니다 (초록=위, 노랑=앞, 분홍=옆).
import { h, svgEl } from './ui.js';

const CELL = 30;
const FILL = '#ffb47a';
const STROKE = '#c46a2c';
const GRID = '#8ec5ef';

export const VIEW_COLORS = {
  top: { bg: '#c4ecb7', name: '위에서 본 모양' },
  front: { bg: '#fbe2a0', name: '앞에서 본 모양' },
  side: { bg: '#fbc6d8', name: '옆에서 본 모양' },
};

// cols×rows 격자. isFilled(c, r)에서 r=0은 그림의 맨 윗줄.
function gridSVG(cols, rows, isFilled, { arrows = false, label } = {}) {
  const padR = arrows ? 44 : 4;
  const padB = arrows ? 46 : 4;
  const W = cols * CELL + 4 + padR;
  const Hh = rows * CELL + 4 + padB;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, class: 'view-svg', role: 'img', 'aria-label': label || '' });
  const g = svgEl('g', { transform: 'translate(2,2)' });
  // 점선 격자
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.appendChild(svgEl('rect', {
        x: c * CELL, y: r * CELL, width: CELL, height: CELL,
        fill: 'none', stroke: GRID, 'stroke-width': 1, 'stroke-dasharray': '3 3',
      }));
    }
  }
  // 칠한 칸
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isFilled(c, r)) {
        g.appendChild(svgEl('rect', {
          x: c * CELL, y: r * CELL, width: CELL, height: CELL,
          fill: FILL, stroke: STROKE, 'stroke-width': 1.4,
        }));
      }
    }
  }
  svg.appendChild(g);
  if (arrows) {
    // 앞(노랑) : 아래에서 위로 보는 화살표, 옆(분홍) : 오른쪽에서 왼쪽으로
    const cx = 2 + (cols * CELL) / 2;
    const by = 2 + rows * CELL;
    svg.appendChild(svgEl('line', { x1: cx, y1: by + 26, x2: cx, y2: by + 7, stroke: '#333', 'stroke-width': 1.6, 'marker-end': 'url(#arrowhead)' }));
    svg.appendChild(svgEl('circle', { cx, cy: by + 36, r: 9, fill: '#f6d76b' }));
    svg.appendChild(svgEl('text', { x: cx, y: by + 40, 'text-anchor': 'middle', 'font-size': 10, fill: '#7a5b00', 'font-weight': 700 }, '앞'));
    const rx = 2 + cols * CELL;
    const cy = 2 + (rows * CELL) / 2;
    svg.appendChild(svgEl('line', { x1: rx + 26, y1: cy, x2: rx + 7, y2: cy, stroke: '#333', 'stroke-width': 1.6, 'marker-end': 'url(#arrowhead)' }));
    svg.appendChild(svgEl('circle', { cx: rx + 35, cy, r: 9, fill: '#f8a9c4' }));
    svg.appendChild(svgEl('text', { x: rx + 35, y: cy + 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#8a1c45', 'font-weight': 700 }, '옆'));
    const defs = svgEl('defs');
    const marker = svgEl('marker', { id: 'arrowhead', markerWidth: 8, markerHeight: 8, refX: 6, refY: 4, orient: 'auto' });
    marker.appendChild(svgEl('path', { d: 'M0,0 L8,4 L0,8 Z', fill: '#333' }));
    defs.appendChild(marker);
    svg.appendChild(defs);
  }
  return svg;
}

function viewBlock(kind, svg) {
  const c = VIEW_COLORS[kind];
  return h('figure', { class: `view view-${kind}` },
    h('figcaption', { class: 'view-label', style: { background: c.bg } }, c.name),
    svg,
  );
}

export function topViewSVG(p) {
  const n = p.n;
  // 그림의 맨 윗줄 = 뒷줄(y = n-1)
  return gridSVG(n, n, (c, r) => p.top[(n - 1 - r) * n + c] === '1', { arrows: true, label: '위에서 본 모양' });
}

export function frontViewSVG(p) {
  const rows = p.rows || p.n;
  return gridSVG(p.n, rows, (c, r) => Number(p.front[c]) > rows - 1 - r, { label: '앞에서 본 모양' });
}

export function sideViewSVG(p) {
  const rows = p.rows || p.n;
  // 오른쪽에서 볼 때 그림 왼쪽 = 앞줄(y=0)
  return gridSVG(p.n, rows, (c, r) => Number(p.side[c]) > rows - 1 - r, { label: '옆에서 본 모양' });
}

// 문제 카드: 세 그림 + 개수
export function puzzleCard(p, { title = '이 모양을 만들어요!' } = {}) {
  return h('section', { class: 'card puzzle-card' },
    h('h3', { class: 'card-title' }, title),
    h('div', { class: 'views' },
      viewBlock('top', topViewSVG(p)),
      viewBlock('front', frontViewSVG(p)),
      viewBlock('side', sideViewSVG(p)),
    ),
    h('div', { class: 'count-pill' }, '사용한 쌓기나무 ', h('b', null, `${p.count}개`)),
    h('p', { class: 'hint muted' }, '옆에서 본 모양은 오른쪽에서 본 모양이에요.'),
  );
}

// 위에서 본 모양에 수 쓰기 (누르면 쌓기/빼기)
export function heightGrid({ n, rows, getHeights, onCell }) {
  const wrap = h('div', { class: 'height-grid-wrap' });
  const grid = h('div', { class: 'height-grid', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } });
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const y = n - 1 - r;
      const btn = h('button', { class: 'hg-cell', type: 'button', 'aria-label': `${c + 1}열 ${y + 1}줄` });
      btn.addEventListener('click', () => onCell(c, y));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); onCell(c, y, true); });
      cells.push({ btn, x: c, y });
      grid.appendChild(btn);
    }
  }
  wrap.appendChild(grid);
  wrap.appendChild(h('div', { class: 'hg-front' }, h('span', { class: 'dot dot-front' }, '앞')));
  function refresh() {
    const hs = getHeights();
    for (const { btn, x, y } of cells) {
      const v = hs[y * n + x] || 0;
      btn.textContent = v ? String(v) : '';
      btn.classList.toggle('filled', v > 0);
      btn.classList.toggle('full', v >= rows);
    }
  }
  refresh();
  return { el: wrap, refresh };
}
