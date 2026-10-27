// 대결 시간표: 요일마다 정해 둔 시간(쉬는 시간, 점심시간 등)에 대결이 저절로 열리고 닫혀요. (화면과 무관한 순수 로직)
// schedule = { on, same, days: { mon: [[시작분, 끝분], ...], tue, wed, thu, fri }, skip: 'YYYY-MM-DD' }
//   - 시각은 한국 시간 0시부터 센 분 (예: 12:10 → 730)
//   - same: 선생님 화면에서 '매일 같은 시간'으로 고쳤는지 (요일마다 같은 시간이 들어 있음)
//   - skip: 이 날은 시간표로 열지 않음 ('오늘은 쉬기')
// 선생님이 직접 열고 닫은 것(battle = { open, until, at })과 함께 정하는 방법:
//   - 시간표 시간이 시작된 뒤에 선생님이 직접 열거나 닫았으면 그 시간이 끝날 때까지 선생님 것이 우선
//   - 그 밖에는 시간표 시간 동안 열림, 시간표 시간이 아닐 때는 선생님이 열어 둔 대로
import { isBattleOpen } from './tiers.js';

export const DAYS = [['mon', '월'], ['tue', '화'], ['wed', '수'], ['thu', '목'], ['fri', '금']];
const DAY_KEY = [null, 'mon', 'tue', 'wed', 'thu', 'fri', null]; // Date.getUTCDay() 순서 (일요일 0)
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const KST = 9 * 3600_000; // 한국 시간 (서머타임 없음)
const DAY_MS = 86_400_000;
export const MAX_SLOTS = 12;

// 한국 시간으로 now가 무슨 요일·몇 분인지
export function kstParts(now) {
  const d = new Date(now + KST);
  return {
    day: d.getUTCDay(),
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
    midnight: now - ((now + KST) % DAY_MS),
    date: d.toISOString().slice(0, 10),
  };
}

export function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// '12:10' → 730 (잘못된 값이면 null)
export function parseMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 24 || mm > 59 || (hh === 24 && mm > 0)) return null;
  return hh * 60 + mm;
}

// 시간 목록 정리: 숫자로, 시작 < 끝만, 시각 순서, 겹치거나 이어지는 시간은 하나로
export function normalizeSlots(slots) {
  const list = (Array.isArray(slots) ? slots : Object.values(slots || {}))
    .map((x) => [Number(x?.[0]), Number(x?.[1])])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e <= 1440 && s < e)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [s, e] of list) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// 그 요일(0=일요일)의 시간 목록
export function slotsOn(schedule, day) {
  const key = DAY_KEY[day];
  return key ? normalizeSlots(schedule?.days?.[key]) : [];
}

// 날짜(그날 한국 시간 0시)별로 시간표가 쓰이는지 (꺼져 있거나 '오늘은 쉬기'면 아님)
function slotsForDay(schedule, midnight) {
  if (!schedule?.on) return [];
  const p = kstParts(midnight);
  if (schedule.skip && schedule.skip === p.date) return [];
  return slotsOn(schedule, p.day).map(([s, e]) => [midnight + s * 60_000, midnight + e * 60_000]);
}

// 지금 시간표로 열려 있는 시간 { start, end } (없으면 null)
export function activeSlot(schedule, now) {
  const { midnight } = kstParts(now);
  const hit = slotsForDay(schedule, midnight).find(([s, e]) => s <= now && now < e);
  return hit ? { start: hit[0], end: hit[1] } : null;
}

// 다음에 시간표로 열리는 시각 (일주일 안에 없으면 null)
export function nextSlotStart(schedule, now) {
  const { midnight } = kstParts(now);
  for (let d = 0; d <= 7; d++) {
    const hit = slotsForDay(schedule, midnight + d * DAY_MS).find(([s]) => s > now);
    if (hit) return hit[0];
  }
  return null;
}

// 대결이 열려 있는지 (선생님이 직접 연 것 + 시간표)
// → { open, until(닫히는 시각, 없으면 null), auto(시간표로 열림), overridden(시간표 시간인데 선생님이 닫음), next(닫혀 있을 때 다음 시간표 시각) }
export function battleState(battle, schedule, now) {
  const manual = isBattleOpen(battle, now);
  const slot = activeSlot(schedule, now);
  if (slot && !((battle?.at || 0) >= slot.start)) {
    let until = slot.end;
    if (manual) until = battle.until ? Math.max(slot.end, battle.until) : null;
    return { open: true, until, auto: true, overridden: false, next: null };
  }
  return {
    open: manual,
    until: manual ? battle.until || null : null,
    auto: false,
    overridden: !!slot && !manual,
    next: manual ? null : nextSlotStart(schedule, now),
  };
}

// 열림·닫힘이 바뀔 수 있는 다음 시각 (화면을 그때 다시 그리려고)
export function nextChange(battle, schedule, now) {
  let best = battle?.open && battle.until > now ? battle.until : Infinity;
  const { midnight } = kstParts(now);
  for (let d = 0; d <= 7; d++) {
    const day = midnight + d * DAY_MS;
    if (day >= best) break;
    if (d > 0 && schedule?.on && schedule.skip) best = Math.min(best, day); // 날짜가 바뀌면 '오늘은 쉬기'가 풀림
    for (const [s, e] of slotsForDay(schedule, day)) {
      if (s > now) best = Math.min(best, s);
      if (e > now) best = Math.min(best, e);
    }
  }
  return best === Infinity ? null : best;
}

// 오늘 시간표 글자 (예: '10:40~10:50, 12:10~12:50')
export function dayText(schedule, day) {
  const slots = slotsOn(schedule, day);
  return slots.map(([s, e]) => `${fmtMin(s)}~${fmtMin(e)}`).join(', ');
}

// 다음 시각을 '오늘 12:10', '내일 10:40', '목요일 10:40'처럼
export function fmtWhen(ms, now) {
  const a = kstParts(now), b = kstParts(ms);
  const days = Math.round((b.midnight - a.midnight) / DAY_MS);
  const label = days === 0 ? '오늘' : days === 1 ? '내일' : `${WEEKDAY[b.day]}요일`;
  return `${label} ${fmtMin(b.min)}`;
}

export const todayKey = (now) => kstParts(now).date;
export const weekdayName = (day) => WEEKDAY[day];
