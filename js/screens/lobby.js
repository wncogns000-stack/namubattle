import { h, tierBadge, tierEmblem, toast, avatar, fmtTime, fmtClock } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, isOnline, presenceState, myStanding, battleOpen } from '../store.js';
import { TIERS } from '../config.js';
import { canMatch, formatWinRate, streakOf } from '../tiers.js';
import { session, sendInvite, setPresenceState } from '../session.js';
import { joinQueue, leaveQueue, queueInfo } from '../matchmaking.js';

const STATE_LABEL = { lobby: '대기 중', game: '대결 중', practice: '연습 중', other: '둘러보는 중' };

export function mount(root) {
  setPresenceState('lobby');
  const profileBox = h('div');
  const matchBox = h('div');
  const listBox = h('div');
  const liveBox = h('div');
  let history = [];

  root.appendChild(h('div', { class: 'page lobby' },
    profileBox,
    matchBox,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '👋'), '지금 접속한 친구'),
        h('a', { class: 'btn btn-small', href: '#/practice' }, '🧩 혼자 연습하기'),
      ),
      listBox,
    ),
    liveBox,
  ));

  const offHist = db.on(`history/${session.uid}`, (v) => {
    history = Object.values(v || {});
    renderProfile();
  });

  function rangeText(me) {
    if (!me) return '';
    if (!me.ranked) return `배치고사 중이라 누구와도 대결할 수 있어요. (${me.placementLeft}판 남음)`;
    const gap = store.settings.tierGap;
    const hi = Math.max(0, me.tierIndex - gap);
    const lo = Math.min(TIERS.length - 1, me.tierIndex + gap);
    return hi === lo ? `${TIERS[hi].name} 친구와 대결할 수 있어요.` : `${TIERS[lo].name} ~ ${TIERS[hi].name} 친구와 대결할 수 있어요. (배치고사 중인 친구와도 가능)`;
  }

  // 접속 신호는 25명이 15초마다 보내므로 1초에 몇 번씩 들어옵니다.
  // 보이는 내용이 그대로면 다시 그리지 않아야 누르려던 버튼이 사라지지 않아요.
  function changed(box, data) {
    const key = JSON.stringify(data);
    if (box.dataset.key === key) return false;
    box.dataset.key = key;
    return true;
  }

  function renderProfile() {
    const me = myStanding();
    const st = streakOf(history);
    if (!changed(profileBox, [me, st, store.standings.rankedCount, store.settings.tierGap])) return;
    profileBox.innerHTML = '';
    if (!me) return;
    profileBox.appendChild(h('section', { class: `card player-card tier-bg-${me.tier.id}` },
      h('div', { class: 'pc-emblem' }, tierEmblem(me.tier, 104)),
      h('div', { class: 'pc-main' },
        h('div', { class: 'row-gap' },
          h('span', { class: 'pc-tier' }, me.ranked ? me.tier.name : `배치고사 ${me.games}/${me.games + me.placementLeft}`),
          st.n >= 2 ? h('span', { class: `streak ${st.win ? '' : 'lose'}` }, st.win ? `🔥 ${st.n}연승 중` : `${st.n}연패… 힘내요!`) : null,
        ),
        h('div', { class: 'pc-name' }, me.name),
        h('div', { class: 'stat-tiles' },
          stat('점수', me.rating),
          me.ranked ? stat('순위', `${me.rank + 1}등`, `/${store.standings.rankedCount}`) : null,
          stat('전적', `${me.wins}승 ${me.losses}패`),
          stat('승률', formatWinRate(me.wins, me.losses)),
        ),
        h('div', { class: 'pc-note' }, rangeText(me)),
      ),
    ));
  }

  function stat(label, value, sub) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value, sub ? h('small', null, sub) : null));
  }

  // ───────── 대결 찾기 (자동 매칭) ─────────
  // 버튼이 있는 틀은 상태가 바뀔 때만 새로 그리고, 숫자·시간은 그 자리에서 글자만 바꿈 (누르는 순간 버튼이 바뀌지 않도록)
  let live = null; // { time, count }
  function renderMatch() {
    const open = battleOpen();
    const q = queueInfo();
    if (changed(matchBox, [open, store.battle.until, q.queued, q.matched, !!session.activeGame])) buildMatch(open, q);
    if (!live) return;
    if (live.time) live.time.textContent = fmtClock(q.waitedMs);
    if (live.count) {
      live.count.textContent = q.queued
        ? `지금 ${q.searching}명이 찾는 중 · 나와 맞는 친구 ${q.eligible}명${q.eligible ? '' : ' — 맞는 친구가 들어오면 바로 짝지어 줄게요.'}`
        : (q.searching ? `지금 ${q.searching}명이 찾는 중이에요.` : '찾는 동안 혼자 연습해도 돼요. 상대를 찾으면 알려 줄게요!');
    }
  }

  function buildMatch(open, q) {
    matchBox.innerHTML = '';
    live = null;
    if (!open) {
      matchBox.appendChild(h('section', { class: 'card match-card is-closed' },
        h('div', { class: 'battle-notice closed' },
          h('b', null, '🔒 지금은 대결 시간이 아니에요'),
          h('span', null, '선생님이 대결을 열면 대결 찾기를 할 수 있어요. 그동안 혼자 연습으로 실력을 키워 봐요!'),
        ),
        h('div', { class: 'match-row' },
          h('button', { class: 'btn btn-big match-btn', disabled: true }, '🔒 대결 찾기'),
          h('a', { class: 'btn', href: '#/practice' }, '🧩 혼자 연습하기'),
        ),
      ));
      return;
    }
    const until = store.battle.until ? h('span', { class: 'match-until' }, `⏰ ${fmtTime(store.battle.until)}까지 대결할 수 있어요`) : null;
    live = { count: h('span', null) };
    if (!q.queued) {
      matchBox.appendChild(h('section', { class: 'card match-card' },
        h('div', { class: 'match-row' },
          h('button', { class: 'btn btn-primary btn-big match-btn', disabled: !!session.activeGame, onclick: () => joinQueue().catch((e) => toast(e.message, 'error')) }, '⚔️ 대결 찾기'),
          h('div', { class: 'match-text' },
            h('b', null, '비슷한 티어 친구와 자동으로 짝지어 줘요'),
            live.count,
            until,
          ),
        ),
      ));
      return;
    }
    live.time = q.matched ? null : h('b', { class: 'match-time' });
    matchBox.appendChild(h('section', { class: 'card match-card is-searching' },
      h('div', { class: 'match-row' },
        h('div', { class: 'match-radar' }, h('span', { class: 'spinner' })),
        h('div', { class: 'match-text' },
          h('b', null, q.matched ? '상대를 찾았어요! 수락 창을 확인하세요.' : '대결 상대를 찾는 중… ', live.time),
          live.count,
          until,
        ),
        h('div', { class: 'match-actions' },
          h('a', { class: 'btn', href: '#/practice' }, '🧩 기다리며 연습'),
          h('button', { class: 'btn', onclick: () => leaveQueue({ msg: '대결 찾기를 멈췄어요.' }) }, '그만 찾기'),
        ),
      ),
    ));
  }

  function renderList() {
    const me = myStanding();
    const others = store.standings.list.filter((s) => s.uid !== session.uid && isOnline(s.uid));
    const open = battleOpen();
    const direct = !!store.settings.directInvite; // 선생님이 켰을 때만 직접 신청
    const searching = (uid) => !!store.queue?.[uid];
    if (!changed(listBox, [me, others, others.map((s) => [presenceState(s.uid), searching(s.uid)]), store.settings, session.outgoing?.to, !!session.activeGame, open])) return;
    listBox.innerHTML = '';
    if (!others.length) {
      listBox.appendChild(h('p', { class: 'empty' }, '아직 접속한 친구가 없어요. 친구들이 들어오면 여기에 보여요.'));
      return;
    }
    // 대결 가능한 친구를 위로
    others.sort((a, b) => Number(canMatch(me, b, store.settings)) - Number(canMatch(me, a, store.settings)));
    const ul = h('ul', { class: 'player-list' });
    for (const s of others) {
      const state = presenceState(s.uid);
      const ok = canMatch(me, s, store.settings);
      const busy = state === 'game';
      const pending = session.outgoing?.to === s.uid;
      let btn = null;
      if (!direct) btn = ok ? null : h('span', { class: 'tag tag-muted' }, '티어 차이');
      else if (!ok) btn = h('span', { class: 'tag tag-muted' }, '티어 차이');
      else if (busy) btn = h('span', { class: 'tag tag-busy' }, '대결 중');
      else if (!open) btn = h('button', { class: 'btn btn-small', disabled: true }, '🔒 대결 신청');
      else btn = h('button', {
        class: `btn ${pending ? '' : 'btn-primary'} btn-small`,
        disabled: !!pending || !!session.activeGame,
        onclick: () => sendInvite(s.uid).catch((e) => toast(e.message, 'error')),
      }, pending ? '신청함' : '⚔️ 대결 신청');
      ul.appendChild(h('li', { class: `player-row ${ok ? '' : 'dim'}` },
        avatar(s.name, s.uid, state),
        h('div', { class: 'pr-main' },
          h('div', { class: 'pr-top' },
            h('span', { class: 'player-name' }, s.name),
            searching(s.uid) && !busy ? h('span', { class: 'status-chip state-search' }, '🔎 대결 찾는 중')
              : h('span', { class: `status-chip state-${state}` }, STATE_LABEL[state] || ''),
          ),
          h('span', { class: 'player-meta' },
            tierBadge(s, { size: 20 }),
            h('span', null, `${s.rating}점 · ${s.wins}승 ${s.losses}패`),
          ),
        ),
        btn,
      ));
    }
    listBox.appendChild(ul);
  }

  function renderLive() {
    if (!changed(liveBox, store.live || {})) return;
    liveBox.innerHTML = '';
    const games = Object.entries(store.live || {});
    if (!games.length) return;
    liveBox.appendChild(h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🔥'), '지금 진행 중인 대결'),
      h('div', { class: 'live-chips' }, games.map(([, g]) => {
        const names = Object.values(g.players || {});
        return h('span', { class: 'live-chip' }, names[0] || '?', h('span', { class: 'swords' }, '⚔️'), names[1] || '?', h('span', { class: 'lv' }, `${g.level}단계`));
      })),
    ));
  }

  const renderAll = () => { renderProfile(); renderMatch(); renderList(); renderLive(); };
  renderAll();
  const off = subscribe(renderAll);
  // 접속 표시가 시간이 지나면 꺼지도록 주기적으로 다시 그림
  const timer = setInterval(renderList, 10_000);
  const clock = setInterval(renderMatch, 1000); // 기다린 시간
  window.addEventListener('nb-outgoing', renderList);
  return () => { off(); offHist(); clearInterval(timer); clearInterval(clock); window.removeEventListener('nb-outgoing', renderList); };
}
