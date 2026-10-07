// 승수 랭킹 (로그인하지 않아도 볼 수 있음)
// 티어·점수와 상관없이 이긴 횟수만으로 줄 세웁니다. 데이터는 읽기만 하고 아무것도 바꾸지 않아요.
import { h, avatar, tierBadge, tierEmblem } from '../ui.js';
import { store, subscribe, isOnline } from '../store.js';
import { winsRanking } from '../tiers.js';
import { session } from '../session.js';

// 티어 랭킹 ↔ 승수 랭킹 전환 (랭킹 화면과 함께 씀)
export function rankSwitch(active) {
  const tab = (hash, label, key) => h('a', { href: hash, class: `rank-switch-tab ${active === key ? 'on' : ''}` }, label);
  return h('nav', { class: 'rank-switch' }, tab('#/ranking', '🏆 티어 랭킹', 'ranking'), tab('#/wins', '🏅 승수 랭킹', 'wins'));
}

export function mount(root) {
  const box = h('div', { class: 'page ranking-page wins-page' });
  root.appendChild(box);

  function row(s) {
    const top = s.wins > 0 && s.winRank < 3 ? ` top${s.winRank + 1}` : '';
    return h('li', { class: `wins-row${top} ${s.uid === session.uid ? 'me' : ''}` },
      h('span', { class: 'wins-no' }, `${s.winRank + 1}`),
      avatar(s.name, s.uid, isOnline(s.uid) ? 'lobby' : null),
      h('span', { class: 'wins-who' },
        h('a', { class: 'rank-name', href: `#/history/${s.uid}` }, s.name),
        tierBadge(s, { size: 18 }),
      ),
      h('span', { class: 'wins-count' }, s.wins, h('small', null, '승')),
      h('span', { class: 'wins-games' }, `${s.games}판 참여`),
    );
  }

  function podium(list) {
    const winners = list.filter((s) => s.wins > 0);
    // 3등과 승수가 같은 친구가 단상 밖에 남으면 서운하니 단상 없이 목록(메달 색 번호)으로만 보여 줌
    if (winners.length < 3 || (winners[3] && winners[3].wins === winners[2].wins)) return null;
    const top = winners.slice(0, 3);
    // 단상 색·높이는 실제 등수로 (승수가 같으면 같은 높이)
    const spot = (s) => h('a', { class: `podium-spot p${s.winRank + 1}`, href: `#/history/${s.uid}` },
      tierEmblem(s.tier, s.winRank === 0 ? 64 : 50),
      h('span', { class: 'podium-name' }, s.name),
      h('span', { class: 'podium-rating' }, `${s.wins}승`),
      h('span', { class: 'podium-base' }, `${s.winRank + 1}`),
    );
    return h('div', { class: 'podium' }, spot(top[1]), spot(top[0]), spot(top[2]));
  }

  let lastKey = '';
  function render() {
    const list = winsRanking(store.standings.list);
    // 내용이 그대로면 다시 그리지 않음 (이름을 누르려던 순간 화면이 바뀌지 않도록)
    const key = JSON.stringify([list.map((s) => [s.uid, s.name, s.wins, s.games, s.tier.id, s.placementLeft, isOnline(s.uid)]), session.uid]);
    if (key === lastKey) return;
    lastKey = key;
    box.innerHTML = '';
    const totalGames = list.reduce((sum, s) => sum + s.wins, 0);
    box.append(
      rankSwitch('wins'),
      h('section', { class: 'card rank-hero' },
        h('h2', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🏅'), '승수 랭킹'),
        h('p', { class: 'muted', style: { margin: '0' } }, '티어나 점수와 상관없이 이긴 횟수만 세요. 어느 티어에서든 꾸준히 대결하면 올라갈 수 있어요!'),
        totalGames ? h('div', { class: 'live-strip' }, `⚔️ 지금까지 끝난 대결 ${totalGames}판`) : null,
        podium(list),
        !list.length ? h('p', { class: 'empty' }, '아직 등록된 학생이 없어요.') : null,
      ),
    );
    if (list.length) box.append(h('section', { class: 'card' }, h('ul', { class: 'rank-list' }, list.map(row))));
  }
  render();
  const off = subscribe((_, what) => { if (what !== 'live' && what !== 'battle') render(); });
  const t = setInterval(render, 15_000); // 접속 표시
  return () => { off(); clearInterval(t); };
}
