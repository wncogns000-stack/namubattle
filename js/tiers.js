// 점수(레이팅)·순위·티어 계산 (화면과 무관한 순수 로직)
import { TIERS, UNRANKED, START_RATING, ELO_K, DEFAULT_SETTINGS, levelForTierIndex } from './config.js';

const TOTAL_QUOTA = TIERS.reduce((s, t) => s + t.quota, 0);
const CUM = [];
TIERS.reduce((s, t, i) => (CUM[i] = s + t.quota), 0);

// 엘로 방식: 나보다 점수가 높은 친구를 이기면 더 많이 오르고, 낮은 친구에게 지면 더 많이 내려갑니다.
export function eloDelta(winnerRating, loserRating, k = ELO_K) {
  const expectedWin = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  return Math.max(1, Math.round(k * (1 - expectedWin)));
}

export function winRate(wins, losses) {
  const g = (wins || 0) + (losses || 0);
  return g ? (wins || 0) / g : null;
}

export function formatWinRate(wins, losses) {
  const r = winRate(wins, losses);
  return r == null ? '-' : `${Math.round(r * 100)}%`;
}

// 순위 비율(0~1 사이 위치)을 티어 번호로. 25명이면 TIERS의 quota와 정확히 같아집니다.
export function tierIndexForPosition(rank, total) {
  const scaled = ((rank + 0.5) * TOTAL_QUOTA) / total;
  for (let i = 0; i < CUM.length; i++) if (CUM[i] > scaled) return i;
  return TIERS.length - 1;
}

// users: { uid: {name, no, rating, wins, losses} }
// 반환: { list: [...정렬된 학생], byUid: {uid: standing} }
//   standing = { uid, name, no, rating, wins, losses, games, ranked, rank, tierIndex, tier }
export function computeStandings(users, settings = DEFAULT_SETTINGS) {
  const placement = settings.placementGames ?? DEFAULT_SETTINGS.placementGames;
  const all = Object.entries(users || {}).map(([uid, u]) => {
    const wins = u.wins || 0, losses = u.losses || 0;
    return {
      uid, name: u.name, no: u.no ?? null,
      rating: u.rating ?? START_RATING,
      wins, losses, games: wins + losses,
    };
  });
  const cmp = (a, b) => b.rating - a.rating || b.wins - a.wins || a.games - b.games || String(a.name).localeCompare(String(b.name), 'ko');
  const ranked = all.filter((s) => s.games >= placement).sort(cmp);
  const unranked = all.filter((s) => s.games < placement).sort((a, b) => (a.no ?? 999) - (b.no ?? 999) || String(a.name).localeCompare(String(b.name), 'ko'));
  let prev = null;
  ranked.forEach((s, i) => {
    // 점수가 같으면 같은 등수(더 좋은 쪽)를 줍니다
    s.rank = prev && prev.rating === s.rating ? prev.rank : i;
    s.ranked = true;
    s.tierIndex = tierIndexForPosition(s.rank, ranked.length);
    s.tier = TIERS[s.tierIndex];
    prev = s;
  });
  unranked.forEach((s) => {
    s.rank = null;
    s.ranked = false;
    s.tierIndex = -1;
    s.tier = UNRANKED;
    s.placementLeft = placement - s.games;
  });
  const list = [...ranked, ...unranked];
  const byUid = {};
  list.forEach((s) => (byUid[s.uid] = s));
  return { list, byUid, rankedCount: ranked.length };
}

// 선생님이 대결을 열어 두었는지. battle = { open, until } (until이 있으면 그 시각에 저절로 닫힘)
export function isBattleOpen(battle, now) {
  return !!(battle && battle.open && (!battle.until || now < battle.until));
}

// 두 학생이 대결할 수 있는지 (배치고사 중이면 누구와도 가능)
export function canMatch(a, b, settings = DEFAULT_SETTINGS) {
  if (!a || !b || a.uid === b.uid) return false;
  if (!a.ranked || !b.ranked) return true;
  const gap = settings.tierGap ?? DEFAULT_SETTINGS.tierGap;
  return Math.abs(a.tierIndex - b.tierIndex) <= gap;
}

// 두 학생의 티어로 문제 단계 정하기
export function levelForMatch(a, b, settings = DEFAULT_SETTINGS) {
  if (settings.level) return settings.level;
  const la = levelForTierIndex(a?.tierIndex);
  const lb = levelForTierIndex(b?.tierIndex);
  return Math.round((la + lb) / 2);
}

// 기록 목록으로 연승/연패 계산. history: [{win, at}]
export function streakOf(history) {
  const sorted = [...history].sort((a, b) => b.at - a.at);
  if (!sorted.length) return { win: null, n: 0 };
  const first = sorted[0].win;
  let n = 0;
  for (const h of sorted) {
    if (h.win === first) n++;
    else break;
  }
  return { win: first, n };
}

// 상대별 전적 정리
export function byOpponent(history) {
  const map = {};
  for (const h of history) {
    const key = h.opp;
    if (!map[key]) map[key] = { opp: h.opp, oppName: h.oppName, wins: 0, losses: 0, last: 0 };
    if (h.win) map[key].wins++;
    else map[key].losses++;
    if (h.at > map[key].last) { map[key].last = h.at; map[key].oppName = h.oppName; }
  }
  return Object.values(map).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || b.last - a.last);
}
