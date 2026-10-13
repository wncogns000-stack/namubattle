// 랭킹 (로그인하지 않아도 볼 수 있음 — 교실 화면에 띄워 두기 좋아요)
// #/ranking = 지금 시즌, #/ranking/s1 = 마친 시즌의 최종 랭킹
import { h, tierEmblem, avatar } from '../ui.js';
import { store, subscribe, isOnline } from '../store.js';
import { TIERS, UNRANKED } from '../config.js';
import { formatWinRate, winRate } from '../tiers.js';
import { session } from '../session.js';
import { rankSwitch } from './wins.js';
import { schoolChip, multiSchool } from '../schools.js';
import { currentSeason, pastSeasons, parseSeasonParam, seasonStandings, seasonPeriodText, seasonPicker, seasonBadge, seasonKey } from '../seasons.js';

export function mount(root, [seasonParam] = []) {
  const box = h('div', { class: 'page ranking-page' });
  root.appendChild(box);

  function render() {
    // 지난 시즌을 고른 경우 그 시즌의 보관 기록, 아니면 지금 기록
    const past = parseSeasonParam(seasonParam);
    const st = past ? seasonStandings(past) : store.standings;
    const histLink = (uid) => (past ? `#/history/${uid}/${seasonKey(past)}` : `#/history/${uid}`);
    const chipOf = (s) => (past ? schoolChip(null, { sid: s.school || 'main' }) : schoolChip(s.uid));

    const row = (s) => {
      const wr = winRate(s.wins, s.losses);
      return h('li', { class: `rank-row tier-${s.tier.id} ${s.uid === session.uid ? 'me' : ''}` },
        h('span', { class: 'rank-no' }, s.ranked ? `${s.rank + 1}` : '-'),
        avatar(s.name, s.uid, !past && isOnline(s.uid) ? 'lobby' : null),
        h('span', { class: 'rank-who' }, h('a', { class: 'rank-name', href: histLink(s.uid) }, s.name), chipOf(s), past ? null : seasonBadge(s.uid)),
        h('span', { class: 'rank-rating' }, s.rating, h('small', null, '점')),
        h('span', { class: 'rank-wl' }, `${s.wins}승 ${s.losses}패`),
        h('span', { class: 'rank-wr' },
          h('span', { class: 'wr-bar' }, h('i', { style: { width: `${Math.round((wr ?? 0) * 100)}%` } })),
          formatWinRate(s.wins, s.losses),
        ),
      );
    };

    const podium = (list) => {
      const top = list.filter((s) => s.ranked).slice(0, 3);
      if (top.length < 3) return null;
      const spot = (s, cls, place) => h('a', { class: `podium-spot ${cls}`, href: histLink(s.uid) },
        tierEmblem(s.tier, cls === 'p1' ? 76 : 60),
        h('span', { class: 'podium-name' }, s.name),
        h('span', { class: 'podium-rating' }, `${s.rating}점`),
        h('span', { class: 'podium-base' }, place),
      );
      return h('div', { class: 'podium' }, spot(top[1], 'p2', '2'), spot(top[0], 'p1', '1'), spot(top[2], 'p3', '3'));
    };

    box.innerHTML = '';
    const { list, rankedCount } = st;
    // 티어별 실제 인원 (학생 수가 25명이 아니면 같은 비율로 나눠져요)
    const counts = TIERS.map((_, i) => list.filter((s) => s.tierIndex === i).length);
    const live = past ? [] : Object.values(store.live || {});
    const cur = currentSeason();
    box.append(rankSwitch('ranking', past));
    const picker = seasonPicker('#/ranking', past || cur);
    if (picker) box.append(picker);
    box.append(h('section', { class: `card rank-hero ${past ? 'past-season' : ''}` },
      h('h2', { class: 'card-title' }, h('span', { class: 'title-icon' }, past ? '🏁' : '🏆'),
        past ? `시즌 ${past} 최종 랭킹` : `쌓기나무 배틀 랭킹${pastSeasons().length ? ` · 시즌 ${cur}` : ''}`),
      past
        ? h('p', { class: 'muted', style: { margin: '0' } }, `${seasonPeriodText(past)} · 시즌을 마칠 때의 기록이에요. 이름을 누르면 그 시즌 전적을 볼 수 있어요.`)
        : h('p', { class: 'muted', style: { margin: '0' } }, `티어는 ${multiSchool() ? '모든 학교 학생을 합친 ' : ''}점수 순위로 정해져요. 처음 ${store.settings.placementGames}판은 배치고사예요.${rankedCount && rankedCount !== 25 ? ` (지금 ${rankedCount}명 기준 인원)` : ' (25명 기준 인원)'}`),
      h('div', { class: 'tier-legend' }, TIERS.map((t, i) => h('span', { class: `tier-${t.id}` }, tierEmblem(t, 18), `${t.name} ${rankedCount ? counts[i] : t.quota}`))),
      live.length ? h('div', { class: 'live-strip' }, '🔥 진행 중', live.map((g) => {
        const n = Object.values(g.players || {});
        return h('span', { class: 'live-chip' }, n[0], h('span', { class: 'swords' }, '⚔️'), n[1]);
      })) : null,
      podium(list),
      !list.length ? h('p', { class: 'empty' }, past ? '이 시즌에는 대결 기록이 없어요.' : '아직 등록된 학생이 없어요.') : null,
    ));
    for (let i = 0; i < TIERS.length; i++) {
      const members = list.filter((s) => s.tierIndex === i);
      if (!members.length) continue;
      box.append(h('section', { class: `card tier-group tier-bg-${TIERS[i].id}` },
        h('div', { class: 'tier-group-head' }, tierEmblem(TIERS[i], 50), h('h3', null, TIERS[i].name), h('span', { class: 'count' }, `${members.length}명`)),
        h('ul', { class: 'rank-list' }, members.map(row)),
      ));
    }
    const un = list.filter((s) => !s.ranked);
    if (un.length) {
      box.append(h('section', { class: 'card tier-group tier-bg-unranked' },
        h('div', { class: 'tier-group-head' }, tierEmblem(UNRANKED, 50), h('h3', null, past ? '배치고사 미완료' : '배치고사 중'), h('span', { class: 'count' }, `${un.length}명`)),
        h('ul', { class: 'rank-list' }, un.map(row)),
      ));
    }
    if (!past && rankedCount === 0 && list.length) {
      box.append(h('p', { class: 'muted center-text' }, '아직 배치고사를 마친 친구가 없어요. 대결을 해 보세요!'));
    }
  }
  render();
  const off = subscribe((_, what) => { if (what !== 'presence') render(); });
  const t = setInterval(render, 15_000);
  return () => { off(); clearInterval(t); };
}
