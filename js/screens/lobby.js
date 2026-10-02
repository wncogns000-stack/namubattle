import { h, tierBadge, tierEmblem, toast } from '../ui.js';
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
        h('h3', { class: 'card-title' }, '🟢 지금 접속한 친구'),
        h('a', { class: 'btn btn-small', href: '#/practice' }, '혼자 연습하기'),
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
    profileBox.appendChild(h('section', { class: `card profile tier-bg-${me.tier.id}` },
      h('div', { class: 'profile-emblem' }, tierEmblem(me.tier, 92)),
      h('div', { class: 'profile-main' },
        h('div', { class: 'profile-name' }, me.name),
        h('div', { class: 'profile-tier' }, me.ranked ? me.tier.name : `배치고사 ${me.games}/${me.games + me.placementLeft}`),
        h('div', { class: 'profile-stats' },
          h('span', null, '점수 ', h('b', null, me.rating)),
          me.ranked ? h('span', null, '순위 ', h('b', null, `${me.rank + 1}등`), ` / ${store.standings.rankedCount}명`) : null,
          h('span', null, h('b', null, `${me.wins}승 ${me.losses}패`)),
          h('span', null, '승률 ', h('b', null, formatWinRate(me.wins, me.losses))),
          st.n >= 2 ? h('span', { class: st.win ? 'streak-win' : 'streak-lose' }, st.win ? `🔥 ${st.n}연승 중` : `${st.n}연패… 힘내요!`) : null,
        ),
        h('div', { class: 'muted small' }, rangeText(me)),
      ),
    ));
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
      }, pending ? '신청함' : '대결 신청');
      ul.appendChild(h('li', { class: `player-row ${ok ? '' : 'dim'}` },
        h('span', { class: `dot-online state-${state}` }),
        tierBadge(s, { size: 30 }),
        h('span', { class: 'player-name' }, s.name),
        h('span', { class: 'player-meta' }, `${s.rating}점 · ${s.wins}승 ${s.losses}패 · ${STATE_LABEL[state] || ''}`),
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
      h('h3', { class: 'card-title' }, '⚔️ 지금 진행 중인 대결'),
      h('ul', { class: 'live-list' }, games.map(([, g]) => {
        const names = Object.values(g.players || {});
        return h('li', null, h('b', null, names[0] || '?'), ' vs ', h('b', null, names[1] || '?'), h('span', { class: 'muted' }, ` · ${g.level}단계`));
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
