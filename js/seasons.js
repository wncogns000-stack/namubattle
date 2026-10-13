// 시즌
// - 지금 시즌: config/season = { current, startedAt } (없으면 시즌 1, 처음부터)
// - 마친 시즌: seasons/s번호 = { n, startedAt, endedAt, placementGames, players } (선생님이 '시즌 마치기'를 누를 때 보관)
// - 대결 기록(history)은 지우지 않고, 날짜로 시즌을 나눠 보여 줘요.
// - 이름 옆 배지: 가장 최근에 마친 시즌의 티어 (예: S1 💎)
import { store } from './store.js';
import { TIERS } from './config.js';
import { standingsFromSnapshot, inSeasonRange } from './tiers.js';
import { h, tierEmblem, fmtDate } from './ui.js';

export const seasonKey = (n) => `s${n}`;

export function currentSeason() {
  return Number(store.season?.current) || 1;
}

export function seasonData(n) {
  return store.seasons?.[seasonKey(n)] || null;
}

// 마친 시즌 번호들 (최근 것부터)
export function pastSeasons() {
  return Object.keys(store.seasons || {})
    .map((k) => Number(String(k).replace(/^s/, '')))
    .filter((n) => n > 0 && n < currentSeason() && seasonData(n))
    .sort((a, b) => b - a);
}

export function lastFinishedSeason() {
  return pastSeasons()[0] || null;
}

// 시즌 기간 { startedAt, endedAt } (지금 시즌은 endedAt 없음)
export function seasonRange(n) {
  if (n === currentSeason()) return { startedAt: store.season?.startedAt || null, endedAt: null };
  const s = seasonData(n);
  return s ? { startedAt: s.startedAt || null, endedAt: s.endedAt } : null;
}

export function filterSeason(hist, n = currentSeason()) {
  const range = seasonRange(n);
  return (hist || []).filter((r) => inSeasonRange(r.at || 0, range));
}

export function seasonPeriodText(n) {
  const r = seasonRange(n);
  if (!r) return '';
  const from = r.startedAt ? fmtDate(r.startedAt) : '처음';
  return r.endedAt ? `${from} ~ ${fmtDate(r.endedAt)}` : `${from}부터`;
}

// 지난 시즌 최종 랭킹 (랭킹 화면 모양)
export function seasonStandings(n) {
  const s = seasonData(n);
  return s ? standingsFromSnapshot(s) : null;
}

// '#/ranking/s1' 같은 주소의 시즌 → 번호 (지금 시즌이거나 없으면 null)
export function parseSeasonParam(param) {
  const n = Number(String(param || '').replace(/^s/, ''));
  return n > 0 && n < currentSeason() && seasonData(n) ? n : null;
}

// 이름 옆 지난 시즌 배지 (가장 최근에 마친 시즌에서 티어를 받은 학생만)
export function seasonBadge(uid, { size = 15 } = {}) {
  const n = lastFinishedSeason();
  if (!n) return null;
  const p = seasonData(n)?.players?.[uid];
  if (!p?.ranked) return null;
  const t = TIERS.find((x) => x.id === p.tier);
  if (!t) return null;
  return h('span', { class: `season-badge tier-${t.id}`, title: `시즌 ${n} ${t.name}` }, `S${n}`, tierEmblem(t, size));
}

// 시즌 고르기 (지난 시즌이 있을 때만). base: '#/ranking' 처럼 시즌 번호를 붙일 주소
export function seasonPicker(base, active) {
  const past = pastSeasons();
  if (!past.length) return null;
  const cur = currentSeason();
  const chip = (n, label) => h('a', { href: n === cur ? base : `${base}/${seasonKey(n)}`, class: `season-chip ${active === n ? 'on' : ''}` }, label);
  return h('nav', { class: 'season-picker' }, chip(cur, `시즌 ${cur} (지금)`), past.map((n) => chip(n, `시즌 ${n}`)));
}
