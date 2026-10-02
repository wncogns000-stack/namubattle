// 랭킹 (로그인하지 않아도 볼 수 있음 — 교실 화면에 띄워 두기 좋아요)
import { h, tierEmblem } from '../ui.js';
import { store, subscribe, isOnline } from '../store.js';
import { TIERS, UNRANKED } from '../config.js';
import { formatWinRate } from '../tiers.js';
import { session } from '../session.js';

export function mount(root) {
  const box = h('div', { class: 'page ranking-page' });
  root.appendChild(box);

  function row(s) {
    return h('li', { class: `rank-row ${s.uid === session.uid ? 'me' : ''}` },
      h('span', { class: 'rank-no' }, s.ranked ? `${s.rank + 1}` : '-'),
      h('span', { class: `dot-online ${isOnline(s.uid) ? 'state-lobby' : 'state-offline'}` }),
      h('a', { class: 'rank-name', href: `#/history/${s.uid}` }, s.name),
      h('span', { class: 'rank-rating' }, `${s.rating}점`),
      h('span', { class: 'rank-wl' }, `${s.wins}승 ${s.losses}패`),
      h('span', { class: 'rank-wr' }, formatWinRate(s.wins, s.losses)),
    );
  }

  function render() {
    box.innerHTML = '';
    const { list, rankedCount } = store.standings;
    const live = Object.values(store.live || {});
    box.append(h('section', { class: 'card' },
      h('h2', null, '🏆 쌓기나무 배틀 랭킹'),
      h('p', { class: 'muted' }, `티어는 점수 순위로 정해져요 (25명 기준: ${TIERS.map((t) => `${t.name} ${t.quota}`).join(' · ')}). `,
        `처음 ${store.settings.placementGames}판은 배치고사예요.`),
      live.length ? h('div', { class: 'live-strip' }, '⚔️ 진행 중: ', live.map((g) => {
        const n = Object.values(g.players || {});
        return h('span', { class: 'live-chip' }, `${n[0]} vs ${n[1]}`);
      })) : null,
      !list.length ? h('p', { class: 'empty' }, '아직 등록된 학생이 없어요.') : null,
    ));
    for (let i = 0; i < TIERS.length; i++) {
      const members = list.filter((s) => s.tierIndex === i);
      if (!members.length) continue;
      box.append(h('section', { class: `card tier-group tier-bg-${TIERS[i].id}` },
        h('div', { class: 'tier-group-head' }, tierEmblem(TIERS[i], 48), h('h3', null, TIERS[i].name), h('span', { class: 'muted' }, `${members.length}명`)),
        h('ul', { class: 'rank-list' }, members.map(row)),
      ));
    }
    const un = list.filter((s) => !s.ranked);
    if (un.length) {
      box.append(h('section', { class: 'card tier-group' },
        h('div', { class: 'tier-group-head' }, tierEmblem(UNRANKED, 48), h('h3', null, '배치고사 중'), h('span', { class: 'muted' }, `${un.length}명`)),
        h('ul', { class: 'rank-list' }, un.map(row)),
      ));
    }
    if (rankedCount === 0 && list.length) {
      box.append(h('p', { class: 'muted center-text' }, '아직 배치고사를 마친 친구가 없어요. 대결을 해 보세요!'));
    }
  }
  render();
  const off = subscribe((_, what) => { if (what !== 'presence') render(); });
  const t = setInterval(render, 15_000);
  return () => { off(); clearInterval(t); };
}
