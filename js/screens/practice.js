// 혼자 연습하기 (점수·전적에 반영되지 않음)
import { h, toast, flash, confetti, fmtClock } from '../ui.js';
import { LEVELS } from '../config.js';
import { generatePuzzle, checkBuild, viewsOf, emptyHeights } from '../puzzle.js';
import { puzzleCard, heightGrid } from '../views2d.js';
import { Builder3D } from '../builder3d.js';
import { setPresenceState } from '../session.js';
import { myStanding } from '../store.js';
import { levelForMatch } from '../tiers.js';

export function mount(root) {
  setPresenceState('practice');
  const me = myStanding();
  let level = levelForMatch(me, me, { level: 0 }) || 2;
  let cur = null;
  let builder = null;
  let heights = null;
  let grid = null;
  let startedAt = 0;
  let solved = 0;
  const page = h('div', { class: 'page practice-page' });
  root.appendChild(page);
  const timer = h('span', { class: 'timer' }, '0:00');
  const tick = setInterval(() => { if (cur) timer.textContent = fmtClock(Date.now() - startedAt); }, 1000);

  function newPuzzle() {
    builder?.dispose();
    cur = generatePuzzle(level);
    heights = emptyHeights(cur.puzzle.n);
    startedAt = Date.now();
    render();
  }

  function render() {
    const p = cur.puzzle;
    const canvasBox = h('div', { class: 'builder-box' });
    const countEl = h('b', null, '0개');
    const feedback = h('div', { class: 'feedback' });
    const modeAdd = h('button', { class: 'seg on', onclick: () => setMode('add') }, '➕ 쌓기');
    const modeRemove = h('button', { class: 'seg', onclick: () => setMode('remove') }, '➖ 빼기');
    function setMode(m) {
      if (builder) builder.mode = m;
      builder?.setMode(m);
      modeAdd.classList.toggle('on', m === 'add');
      modeRemove.classList.toggle('on', m === 'remove');
    }
    const onChange = (hs) => {
      heights = [...hs];
      grid.refresh();
      countEl.textContent = `${viewsOf(heights, p.n).count}개`;
      feedback.innerHTML = '';
    };
    grid = heightGrid({
      n: p.n, rows: p.rows, getHeights: () => heights,
      onCell: (x, y, forceRemove) => {
        const d = (forceRemove ? 'remove' : builder?.mode || 'add') === 'add' ? 1 : -1;
        if (builder?.ok) builder.bump(x, y, d);
        else {
          const i = y * p.n + x;
          const v = heights[i] + d;
          if (v >= 0 && v <= p.rows) { heights[i] = v; onChange(heights); }
        }
      },
    });
    const levelSel = h('select', { onchange: (e) => { level = Number(e.target.value); newPuzzle(); } },
      Object.entries(LEVELS).map(([k, L]) => h('option', { value: k, selected: Number(k) === level }, `${L.name} (${L.n}×${L.n}, ${L.maxH}층까지)`)),
    );

    page.innerHTML = '';
    page.append(
      h('div', { class: 'card practice-head' },
        h('span', { class: 'title-icon' }, '🧩'),
        h('div', { style: { flex: '1', minWidth: '180px' } },
          h('h2', null, '혼자 연습하기'),
          h('span', { class: 'muted small' }, '점수와 전적에는 반영되지 않아요.'),
        ),
        h('label', { class: 'inline' }, '난이도 ', levelSel),
        timer,
        h('span', { class: 'mode-chip' }, `⭐ 맞힌 문제 ${solved}개`),
      ),
      h('div', { class: 'game-grid' },
        puzzleCard(p),
        h('section', { class: 'card builder-card' },
          h('div', { class: 'toolbar' },
            h('div', { class: 'segmented' }, modeAdd, modeRemove),
            h('div', { class: 'view-btns' },
              h('button', { class: 'btn btn-small', title: '처음 시점', onclick: () => builder?.setView('home') }, '🏠 처음'),
              h('button', { class: 'btn btn-small vb-top', onclick: () => builder?.setView('top') }, '위'),
              h('button', { class: 'btn btn-small vb-front', onclick: () => builder?.setView('front') }, '앞'),
              h('button', { class: 'btn btn-small vb-side', onclick: () => builder?.setView('side') }, '옆'),
              h('button', { class: 'btn btn-small', onclick: () => builder?.rotate(-45) }, '⟲'),
              h('button', { class: 'btn btn-small', onclick: () => builder?.rotate(45) }, '⟳'),
            ),
          ),
          canvasBox,
          h('div', { class: 'builder-bottom' },
            h('div', { class: 'grid-side' }, h('div', { class: 'small muted' }, '위에서 본 모양에 수 쓰기'), grid.el),
            h('div', { class: 'action-side' },
              h('div', { class: 'my-count' }, '내가 쌓은 쌓기나무 ', countEl),
              h('button', { class: 'btn btn-challenge', onclick: check }, '✔ 확인하기'),
              feedback,
              h('div', { class: 'row-gap' },
                h('button', { class: 'btn btn-small', onclick: () => { builder?.ok ? builder.clear() : onChange(emptyHeights(p.n)); } }, '모두 지우기'),
                h('button', { class: 'btn btn-small', onclick: showAnswer }, '정답 보기'),
                h('button', { class: 'btn btn-small btn-primary', onclick: newPuzzle }, '새 문제'),
              ),
            ),
          ),
        ),
      ),
    );
    builder = new Builder3D(canvasBox, { n: p.n, rows: p.rows, heights, onChange });
    canvasBox.addEventListener('builder-limit', () => toast(`${p.rows}층까지만 쌓을 수 있어요.`, 'warn'));

    function check() {
      const r = checkBuild(heights, p);
      feedback.innerHTML = '';
      if (r.ok) {
        solved++;
        confetti(60);
        flash('⭕ 정답!', 'good');
        feedback.append(h('p', { class: 'ok' }, `정답이에요! (${fmtClock(Date.now() - startedAt)})`),
          h('button', { class: 'btn btn-primary', onclick: newPuzzle }, '다음 문제'));
        return;
      }
      const mark = (ok, label) => h('li', { class: ok ? 'ok' : 'bad' }, `${ok ? '✔' : '✘'} ${label}`);
      feedback.append(
        h('p', { class: 'bad' }, '아직 달라요. 어디가 다른지 확인해 봐요.'),
        h('ul', { class: 'checklist' },
          mark(r.top, '위에서 본 모양'),
          mark(r.front, '앞에서 본 모양'),
          mark(r.side, '옆에서 본 모양'),
          mark(r.count, `쌓기나무 개수 (${p.count}개)`),
        ),
      );
    }

    function showAnswer() {
      if (!builder) return;
      const ans = cur.solution;
      if (builder.ok) builder.setHeights(ans, false);
      else onChange(ans);
      feedback.innerHTML = '';
      feedback.append(h('p', { class: 'muted' }, '정답 모양을 보여 줬어요. 위·앞·옆 버튼으로 확인해 보세요.'));
    }
  }

  newPuzzle();
  return () => {
    clearInterval(tick);
    builder?.dispose();
  };
}
