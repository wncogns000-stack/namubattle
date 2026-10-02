import { h, tierBadge, tierEmblem, toast, avatar } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, isOnline, presenceState, myStanding } from '../store.js';
import { TIERS } from '../config.js';
import { canMatch, formatWinRate, streakOf } from '../tiers.js';
import { session, sendInvite, setPresenceState } from '../session.js';

const STATE_LABEL = { lobby: '대기 중', game: '대결 중', practice: '연습 중', other: '둘러보는 중' };

export function mount(root) {
  setPresenceState('lobby');
  const profileBox = h('div');
  const listBox = h('div');
  const liveBox = h('div');
  let history = [];

  root.appendChild(h('div', { class: 'page lobby' },
    profileBox,
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

  function renderProfile() {
    const me = myStanding();
    profileBox.innerHTML = '';
    if (!me) return;
    const st = streakOf(history);
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

  function renderList() {
    const me = myStanding();
    listBox.innerHTML = '';
    const others = store.standings.list.filter((s) => s.uid !== session.uid && isOnline(s.uid));
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
      let btn;
      if (!ok) btn = h('span', { class: 'tag tag-muted' }, '티어 차이');
      else if (busy) btn = h('span', { class: 'tag tag-busy' }, '대결 중');
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
            h('span', { class: `status-chip state-${state}` }, STATE_LABEL[state] || ''),
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

  const renderAll = () => { renderProfile(); renderList(); renderLive(); };
  renderAll();
  const off = subscribe(renderAll);
  // 접속 표시가 시간이 지나면 꺼지도록 주기적으로 다시 그림
  const timer = setInterval(renderList, 10_000);
  window.addEventListener('nb-outgoing', renderList);
  return () => { off(); offHist(); clearInterval(timer); window.removeEventListener('nb-outgoing', renderList); };
}
