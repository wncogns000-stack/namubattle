import { h, toast, confirmBox, flash, confetti, josa, tierBadge, fmtClock, fmtDuration, avatar } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, standingOf, myStanding, isOnline } from '../store.js';
import { LEVELS } from '../config.js';
import { heightsFromString, heightsToString, solutionOf, viewsOf } from '../puzzle.js';
import { puzzleCard, heightGrid } from '../views2d.js';
import { Builder3D } from '../builder3d.js';
import { session, setPresenceState, leaveFinishedGame } from '../session.js';
import { challenge, surrender, lockInfo, opponentOf, cancelGame } from '../match.js';

const OPP_GONE_MS = 60_000;

export function mount(root, [gid]) {
  setPresenceState('game');
  const me = session.uid;
  let g = null;
  let phase = 'loading'; // loading | playing | finished | canceled | missing
  let builder = null;
  let grid = null;
  let heights = null;
  let busy = false;
  let saveTimer = null;
  const seen = new Set();
  let firstAttemptsLoad = true;
  const before = { standing: myStanding() ? { ...myStanding() } : null };
  let oppOfflineSince = null;
  const cleanups = [];

  const page = h('div', { class: 'page game-page' }, h('p', { class: 'loading' }, '대결을 불러오는 중…'));
  root.appendChild(page);

  const offGame = db.on(`games/${gid}`, (v) => {
    g = v;
    if (!g) return showMissing();
    if (!g.players || !g.players[me]) return showMissing('이 대결의 참가자가 아니에요.');
    if (g.status === 'playing') {
      if (phase !== 'playing') buildPlay();
      else updatePlay();
      handleNewAttempts();
    } else {
      handleNewAttempts();
      if (g.status === 'finished') showFinished();
      else if (g.status === 'canceled') showCanceled();
    }
  });
  cleanups.push(offGame);

  const tick = setInterval(() => {
    if (phase === 'playing') updatePlay();
  }, 1000);
  cleanups.push(() => clearInterval(tick));
  cleanups.push(subscribe((_, what) => {
    if (phase === 'playing' && (what === 'presence' || what === 'settings')) updatePlay();
    // 결과 화면: 점수·티어가 반영되면 다시 그림
    if (phase === 'finished' && what === 'users' && g?.finalized) showFinished();
  }));

  // ───────── 게임 진행 화면 ─────────
  let els = {};
  async function buildPlay() {
    phase = 'playing';
    const p = g.puzzle;
    const opp = opponentOf(g, me);
    const saved = await db.get(`builds/${gid}/${me}`);
    if (phase !== 'playing') return;
    heights = heightsFromString(saved, p.n);

    els.timer = h('span', { class: 'timer' }, '0:00');
    els.status = h('div', { class: 'chance' });
    els.count = h('b', null, '0개');
    els.challengeBtn = h('button', { class: 'btn btn-challenge', onclick: doChallenge }, '🙋 정답 도전!');
    els.oppNotice = h('div', { class: 'opp-notice', hidden: true });
    const canvasBox = h('div', { class: 'builder-box' });
    const modeAdd = h('button', { class: 'seg on', onclick: () => setMode('add') }, '➕ 쌓기');
    const modeRemove = h('button', { class: 'seg', onclick: () => setMode('remove') }, '➖ 빼기');
    els.modeBtns = { add: modeAdd, remove: modeRemove };

    grid = heightGrid({
      n: p.n, rows: p.rows,
      getHeights: () => heights,
      onCell: (x, y, forceRemove) => {
        const mode = forceRemove ? 'remove' : builder?.mode || 'add';
        if (builder?.ok) builder.bump(x, y, mode === 'add' ? 1 : -1);
        else bumpNoGL(x, y, mode === 'add' ? 1 : -1);
      },
    });

    const sMe = standingOf(me), sOpp = standingOf(opp);
    page.innerHTML = '';
    page.append(
      h('div', { class: 'vs-bar card' },
        h('div', { class: 'vs-player me' },
          avatar(g.players[me], me),
          h('div', { class: 'vs-info' },
            h('div', { class: 'vs-name' }, g.players[me], h('span', { class: 'vs-you' }, '나')),
            sMe ? tierBadge(sMe, { size: 22 }) : null,
          ),
        ),
        h('div', { class: 'vs-mid' }, h('span', { class: 'vs' }, 'VS'), h('span', { class: 'level-tag' }, LEVELS[p.level]?.name || ''), els.timer),
        h('div', { class: 'vs-player opp' },
          h('div', { class: 'vs-info' },
            h('div', { class: 'vs-name' }, g.players[opp] || '상대'),
            sOpp ? tierBadge(sOpp, { size: 22 }) : null,
          ),
          avatar(g.players[opp] || '상대', opp),
        ),
      ),
      els.status,
      els.oppNotice,
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
              h('button', { class: 'btn btn-small', title: '왼쪽으로 돌리기', onclick: () => builder?.rotate(-45) }, '⟲'),
              h('button', { class: 'btn btn-small', title: '오른쪽으로 돌리기', onclick: () => builder?.rotate(45) }, '⟳'),
            ),
          ),
          canvasBox,
          h('p', { class: 'muted small builder-help' }, '바닥이나 쌓기나무를 누르면 쌓여요. 끌면 돌려 볼 수 있어요. (마우스 오른쪽 버튼 = 빼기)'),
          h('div', { class: 'builder-bottom' },
            h('div', { class: 'grid-side' },
              h('div', { class: 'small muted' }, '위에서 본 모양에 수 쓰기'),
              grid.el,
            ),
            h('div', { class: 'action-side' },
              h('div', { class: 'my-count' }, '내가 쌓은 쌓기나무 ', els.count),
              els.challengeBtn,
              h('div', { class: 'row-gap' },
                h('button', { class: 'btn btn-small', onclick: clearAll }, '모두 지우기'),
                h('button', { class: 'btn btn-small btn-ghost', onclick: doSurrender }, '기권하기'),
              ),
            ),
          ),
        ),
      ),
    );
    builder = new Builder3D(canvasBox, { n: p.n, rows: p.rows, heights, onChange: onBuilderChange });
    canvasBox.addEventListener('builder-limit', () => toast(`${p.rows}층까지만 쌓을 수 있어요.`, 'warn'));
    updateCount();
    updatePlay();
  }

  function setMode(m) {
    builder?.setMode(m);
    if (builder && !builder.ok) builder.mode = m;
    els.modeBtns.add.classList.toggle('on', m === 'add');
    els.modeBtns.remove.classList.toggle('on', m === 'remove');
  }

  function bumpNoGL(x, y, d) {
    const p = g.puzzle;
    const i = y * p.n + x;
    const v = heights[i] + d;
    if (v < 0 || v > p.rows) return;
    heights[i] = v;
    onBuilderChange(heights);
  }

  function onBuilderChange(hs) {
    heights = [...hs];
    grid?.refresh();
    updateCount();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => db.set(`builds/${gid}/${me}`, heightsToString(heights)).catch(() => {}), 400);
  }

  function updateCount() {
    if (els.count) els.count.textContent = `${viewsOf(heights, g.puzzle.n).count}개`;
  }

  async function clearAll() {
    if (!heights.some((v) => v > 0)) return;
    if (!(await confirmBox('모두 지우기', '쌓은 쌓기나무를 모두 지울까요?', '지우기', 'danger'))) return;
    if (builder?.ok) builder.clear();
    else onBuilderChange(heights.map(() => 0));
  }

  function updatePlay() {
    if (!g || phase !== 'playing' || !els.status) return;
    const now = db.now();
    els.timer.textContent = fmtClock(now - (g.createdAt || now));
    const opp = opponentOf(g, me);
    const oppName = g.players[opp] || '상대';
    const li = lockInfo(g, me, store.settings, now);
    let text, cls;
    if (li.locked) {
      cls = 'chance-wait';
      text = `❌ 내가 틀려서 도전 기회가 ${oppName}에게 넘어갔어요. ${josa(oppName, '이/가')} 도전하면 다시 기회가 와요. 계속 만들면서 기다려요!`;
      if (li.remainMs != null) text += ` (${Math.ceil(li.remainMs / 1000)}초 뒤 다시 열림)`;
    } else if (li.opponentLocked) {
      cls = 'chance-mine';
      text = `✨ ${josa(oppName, '이/가')} 틀렸어요! 지금은 나만 정답 도전을 할 수 있어요.`;
    } else {
      cls = 'chance-open';
      text = '🏁 누구든 먼저 "정답 도전"을 외칠 수 있어요. 맞히면 바로 승리, 틀리면 기회가 상대에게 넘어가요!';
    }
    els.status.className = `chance ${cls}`;
    els.status.textContent = text;
    els.challengeBtn.disabled = busy || li.locked;
    els.challengeBtn.textContent = li.locked ? '⏳ 상대의 도전을 기다리는 중' : '🙋 정답 도전!';

    // 상대가 오래 접속하지 않으면 무효로 끝낼 수 있게
    if (!isOnline(opp)) {
      oppOfflineSince = oppOfflineSince || now;
    } else oppOfflineSince = null;
    const gone = oppOfflineSince && now - oppOfflineSince > OPP_GONE_MS;
    els.oppNotice.hidden = !gone;
    if (gone && !els.oppNotice.firstChild) {
      els.oppNotice.append(
        h('span', null, `${josa(oppName, '이/가')} 접속을 끊은 것 같아요. `),
        h('button', { class: 'btn btn-small', onclick: async () => {
          if (await confirmBox('대결 무효', '이 대결을 무효로 끝낼까요? 점수와 전적에는 반영되지 않아요.', '무효로 끝내기')) {
            await cancelGame(gid, 'left');
          }
        } }, '무효로 끝내기'),
      );
    }
  }

  async function doChallenge() {
    if (busy || !g || g.status !== 'playing') return;
    if (!heights.some((v) => v > 0)) {
      toast('먼저 쌓기나무를 쌓아 주세요!', 'warn');
      return;
    }
    busy = true;
    updatePlay();
    flash('🙋 정답 도전!', 'info', 900);
    try {
      clearTimeout(saveTimer);
      await db.set(`builds/${gid}/${me}`, heightsToString(heights));
      const res = await challenge(gid, me, heights, g.puzzle, store.settings);
      if (res.status === 'wrong') {
        const opp = opponentOf(g, me);
        setTimeout(() => flash('❌ 아쉬워요! 정답이 아니에요', 'bad', 1600), 700);
        toast(`도전 기회가 ${g.players[opp] || '상대'}에게 넘어갔어요.`, 'warn', 3500);
      } else if (res.status === 'notYourTurn') {
        toast('지금은 상대의 도전 차례예요.', 'warn');
      }
    } catch (e) {
      console.error(e);
      toast('도전을 보내지 못했어요. 인터넷 연결을 확인해 주세요.', 'error');
    } finally {
      busy = false;
      updatePlay();
    }
  }

  async function doSurrender() {
    if (!(await confirmBox('기권하기', '정말 기권할까요? 패배로 기록돼요.', '기권', 'danger'))) return;
    await surrender(gid, me);
  }

  function handleNewAttempts() {
    const list = Object.entries(g?.attempts || {}).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [k, a] of list) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (firstAttemptsLoad || a.uid === me) continue;
      const name = g.players[a.uid] || '상대';
      flash(`🙋 ${name} 정답 도전!`, 'info', 1000);
      if (!a.ok) {
        setTimeout(() => flash(`❌ ${josa(name, '이/가')} 틀렸어요! 이제 내 기회!`, 'good', 1800), 1100);
      }
    }
    firstAttemptsLoad = false;
  }

  // ───────── 결과 화면 ─────────
  let finishedShown = false;
  async function showFinished() {
    const finalizedNow = !!g.finalized;
    if (finishedShown && !finalizedNow) return;
    const firstTime = !finishedShown;
    finishedShown = true;
    if (phase === 'playing' && builder) heights = builder.getHeights();
    phase = 'finished';
    disposeBuilders();
    if (!heights) heights = heightsFromString(await db.get(`builds/${gid}/${me}`), g.puzzle.n);

    const won = g.winner === me;
    const opp = opponentOf(g, me);
    const oppName = g.players[opp] || '상대';
    if (firstTime && won && db.now() - (g.endedAt || 0) < 15000) confetti();

    const d = g.result?.delta;
    const reasonText = g.reason === 'surrender'
      ? (won ? `${josa(oppName, '이/가')} 기권했어요.` : '기권했어요.')
      : (won ? '정답을 먼저 맞혔어요!' : `${josa(oppName, '이/가')} 먼저 정답을 맞혔어요.`);
    const now = myStanding();
    let tierMsg = null;
    if (g.finalized && before.standing && now && before.standing.tier.id !== now.tier.id) {
      const up = now.tierIndex >= 0 && (before.standing.tierIndex < 0 || now.tierIndex < before.standing.tierIndex);
      tierMsg = h('div', { class: `tier-change ${up ? 'up' : 'down'}` },
        up ? '🎉 승급! ' : '티어 변동: ',
        tierBadge(before.standing, { size: 26 }), ' → ', tierBadge(now, { size: 32 }),
      );
    }
    const solution = solutionOf(g.puzzle);
    const solBox = h('div', { class: 'mini-builder' });
    const myBox = h('div', { class: 'mini-builder' });
    const attempts = Object.entries(g.attempts || {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, a]) => a);

    page.innerHTML = '';
    page.append(
      h('section', { class: `card result-hero ${won ? 'win' : 'lose'}` },
        h('div', { class: 'result-trophy', 'aria-hidden': 'true' }, won ? '🏆' : '💪'),
        h('div', { class: 'result-title' }, won ? '승리!' : '아쉬운 패배'),
        h('p', null, reasonText, won ? '' : ' 다음 대결에서는 꼭 이길 수 있어요!'),
        h('div', { class: 'result-points' },
          d == null ? h('span', { class: 'muted' }, '점수 기록 중…')
            : h('span', { class: won ? 'plus' : 'minus' }, `${won ? '+' : '−'}${d}점`),
          now ? h('span', null, ' → 지금 점수 ', h('b', null, now.rating)) : null,
        ),
        now ? h('div', { class: 'result-tier' }, tierBadge(now, { size: 36 }), now.ranked ? h('span', null, ` ${now.rank + 1}등`) : null) : null,
        tierMsg,
        h('div', { class: 'row-gap center' },
          h('button', { class: 'btn btn-primary btn-big', onclick: () => leaveFinishedGame(gid) }, '로비로 돌아가기'),
          h('button', { class: 'btn', onclick: () => leaveFinishedGame(gid, '#/history') }, '내 전적 보기'),
        ),
      ),
      h('div', { class: 'game-grid' },
        puzzleCard(g.puzzle, { title: '문제' }),
        h('section', { class: 'card' },
          h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🔍'), '정답 모양과 내가 만든 모양'),
          h('div', { class: 'compare' },
            h('div', null, h('div', { class: 'compare-label' }, '✅ 정답'), solBox),
            h('div', null, h('div', { class: 'compare-label' }, '🧱 내가 만든 모양'), myBox),
          ),
          h('h4', null, '도전 기록'),
          attempts.length
            ? h('ol', { class: 'attempt-list' }, attempts.map((a) => h('li', null,
              h('span', { class: 'muted' }, fmtDuration((a.at || 0) - (g.createdAt || 0))), ' ',
              h('b', null, g.players[a.uid] || ''), a.ok ? ' ⭕ 정답!' : ' ❌ 틀림',
            )))
            : h('p', { class: 'muted' }, '도전 기록이 없어요.'),
          h('p', { class: 'muted small' }, `걸린 시간 ${fmtDuration((g.endedAt || 0) - (g.createdAt || 0))}`),
        ),
      ),
    );
    if (solution) miniBuilders.push(new Builder3D(solBox, { n: g.puzzle.n, rows: g.puzzle.rows, heights: solution, editable: false }));
    miniBuilders.push(new Builder3D(myBox, { n: g.puzzle.n, rows: g.puzzle.rows, heights, editable: false }));
  }

  function showCanceled() {
    phase = 'canceled';
    disposeBuilders();
    page.innerHTML = '';
    page.append(h('section', { class: 'card center-text' },
      h('h2', null, '이 대결은 무효가 되었어요'),
      h('p', { class: 'muted' }, g.canceledBy === 'teacher' ? '선생님이 대결을 끝냈어요.' : '상대가 접속을 끊어 대결을 끝냈어요.', ' 점수와 전적에는 반영되지 않아요.'),
      h('button', { class: 'btn btn-primary btn-big', onclick: () => leaveFinishedGame(gid) }, '로비로 돌아가기'),
    ));
  }

  function showMissing(msg = '대결을 찾을 수 없어요.') {
    phase = 'missing';
    disposeBuilders();
    page.innerHTML = '';
    page.append(h('section', { class: 'card center-text' },
      h('h2', null, msg),
      h('button', { class: 'btn btn-primary', onclick: () => leaveFinishedGame(gid) }, '로비로 돌아가기'),
    ));
  }

  const miniBuilders = [];
  function disposeBuilders() {
    builder?.dispose();
    builder = null;
    miniBuilders.splice(0).forEach((b) => b.dispose());
  }

  return () => {
    clearTimeout(saveTimer);
    if (phase === 'playing' && heights) db.set(`builds/${gid}/${me}`, heightsToString(heights)).catch(() => {});
    cleanups.forEach((f) => f());
    disposeBuilders();
  };
}

