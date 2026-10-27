import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstParts, parseMin, fmtMin, normalizeSlots, slotsOn, activeSlot, nextSlotStart, battleState, nextChange, fmtWhen, dayText } from '../js/schedule.js';

// 한국 시간 2026-10-26(월) hh:mm 의 시각
const MON = Date.UTC(2026, 9, 25, 15, 0); // 2026-10-26 00:00 KST
const at = (day, hh, mm = 0) => MON + day * 86_400_000 + (hh * 60 + mm) * 60_000; // day: 0=월 … 6=일
const SLOTS = [[580, 590], [730, 770]]; // 09:40~09:50, 12:10~12:50
const every = (slots) => ({ mon: slots, tue: slots, wed: slots, thu: slots, fri: slots });
const SCH = { on: true, days: every(SLOTS) };

test('한국 시간으로 요일·분 계산 (기기 시간대와 무관)', () => {
  const p = kstParts(at(0, 12, 10));
  assert.equal(p.day, 1);
  assert.equal(p.min, 730);
  assert.equal(p.midnight, MON);
  assert.equal(p.date, '2026-10-26');
  assert.equal(kstParts(at(5, 23, 59)).day, 6); // 토요일 밤
});

test('시각 글자 ↔ 분', () => {
  assert.equal(parseMin('12:10'), 730);
  assert.equal(parseMin('9:05'), 545);
  assert.equal(parseMin('24:00'), 1440);
  assert.equal(parseMin('24:30'), null);
  assert.equal(parseMin('12:60'), null);
  assert.equal(parseMin(''), null);
  assert.equal(fmtMin(545), '09:05');
});

test('시간 목록 정리: 잘못된 시간 빼고, 겹치거나 이어지면 합침', () => {
  assert.deepEqual(normalizeSlots([[730, 770], [580, 590], [590, 600], [700, 690], [760, 800], ['x', 1]]), [[580, 600], [730, 800]]);
  assert.deepEqual(normalizeSlots({ 0: [580, 590] }), [[580, 590]]); // Firebase가 객체로 돌려줘도
  assert.deepEqual(normalizeSlots(null), []);
});

test('주말에는 시간표 없음', () => {
  assert.deepEqual(slotsOn(SCH, 1), SLOTS);
  assert.deepEqual(slotsOn(SCH, 0), []);
  assert.deepEqual(slotsOn(SCH, 6), []);
});

test('시간표 시간 동안만 열림', () => {
  assert.equal(battleState({}, SCH, at(0, 9, 39)).open, false);
  const s = battleState({}, SCH, at(0, 9, 40));
  assert.equal(s.open, true);
  assert.equal(s.auto, true);
  assert.equal(s.until, at(0, 9, 50));
  assert.equal(battleState({}, SCH, at(0, 9, 50)).open, false); // 끝 시각에는 닫힘
  assert.equal(battleState({}, SCH, at(5, 12, 20)).open, false); // 토요일
  assert.equal(battleState({}, { ...SCH, on: false }, at(0, 12, 20)).open, false); // 꺼 두면 안 열림
});

test('닫혀 있을 때 다음 시간표 시각', () => {
  assert.equal(battleState({}, SCH, at(0, 8, 0)).next, at(0, 9, 40));
  assert.equal(battleState({}, SCH, at(0, 10, 0)).next, at(0, 12, 10));
  assert.equal(battleState({}, SCH, at(0, 13, 0)).next, at(1, 9, 40));
  assert.equal(battleState({}, SCH, at(4, 13, 0)).next, at(7, 9, 40)); // 금요일 오후 → 다음 주 월요일
  assert.equal(battleState({}, { on: false, days: every(SLOTS) }, at(0, 8, 0)).next, null);
  assert.equal(nextSlotStart({ on: true, days: {} }, at(0, 8, 0)), null);
});

test('요일마다 다른 시간', () => {
  const sch = { on: true, days: { mon: [[580, 590]], wed: [[620, 650]] } };
  assert.equal(battleState({}, sch, at(0, 9, 45)).open, true);
  assert.equal(battleState({}, sch, at(1, 9, 45)).open, false); // 화요일엔 없음
  assert.equal(battleState({}, sch, at(2, 10, 30)).open, true);
  assert.equal(battleState({}, sch, at(0, 10, 0)).next, at(2, 10, 20));
});

test('오늘은 쉬기: 그날만 안 열리고 다음 날은 다시', () => {
  const sch = { ...SCH, skip: '2026-10-26' };
  assert.equal(battleState({}, sch, at(0, 12, 20)).open, false);
  assert.equal(battleState({}, sch, at(0, 8, 0)).next, at(1, 9, 40));
  assert.equal(battleState({}, sch, at(1, 9, 45)).open, true);
});

test('시간표 시간에 선생님이 닫으면 그 시간이 끝날 때까지 닫힘, 다음 시간엔 다시 열림', () => {
  const closed = { open: false, at: at(0, 12, 20) };
  const s = battleState(closed, SCH, at(0, 12, 30));
  assert.equal(s.open, false);
  assert.equal(s.overridden, true);
  assert.equal(s.next, at(1, 9, 40));
  assert.equal(battleState(closed, SCH, at(1, 9, 45)).open, true);
  // 시간표 시간 전에 닫은 것은 시간표가 이김
  assert.equal(battleState({ open: false, at: at(0, 12, 0) }, SCH, at(0, 12, 30)).open, true);
  // 예전 데이터(at 없음)도 시간표가 이김
  assert.equal(battleState({ open: false }, SCH, at(0, 12, 30)).open, true);
});

test('선생님이 직접 연 것과 함께', () => {
  // 시간표 밖: 선생님이 연 대로
  const m40 = { open: true, until: at(0, 11, 0), at: at(0, 10, 20) };
  assert.deepEqual(battleState(m40, SCH, at(0, 10, 30)), { open: true, until: at(0, 11, 0), auto: false, overridden: false, next: null });
  // 시간표보다 늦게 닫히게 열어 두면 늦은 쪽까지
  const m = { open: true, until: at(0, 13, 0), at: at(0, 11, 0) };
  assert.equal(battleState(m, SCH, at(0, 12, 20)).until, at(0, 13, 0));
  // 시간표보다 일찍 끝나게 열어 둔 것은 시간표 끝까지
  const short = { open: true, until: at(0, 12, 20), at: at(0, 11, 40) };
  assert.equal(battleState(short, SCH, at(0, 12, 15)).until, at(0, 12, 50));
  // '닫을 때까지 열기'는 시간표가 끝나도 계속
  const forever = { open: true, until: null, at: at(0, 8, 0) };
  assert.equal(battleState(forever, SCH, at(0, 12, 20)).until, null);
  assert.equal(battleState(forever, SCH, at(0, 13, 0)).open, true);
  // 시간표 시간 중에 '40분 동안 열기'를 누르면 그대로 40분
  const during = { open: true, until: at(0, 13, 0), at: at(0, 12, 20) };
  const s = battleState(during, SCH, at(0, 12, 55));
  assert.equal(s.open, true);
  assert.equal(s.until, at(0, 13, 0));
});

test('다음에 바뀌는 시각', () => {
  assert.equal(nextChange({}, SCH, at(0, 8, 0)), at(0, 9, 40));
  assert.equal(nextChange({}, SCH, at(0, 9, 45)), at(0, 9, 50));
  assert.equal(nextChange({ open: true, until: at(0, 9, 42) }, SCH, at(0, 9, 41)), at(0, 9, 42));
  assert.equal(nextChange({}, SCH, at(0, 13, 0)), at(1, 9, 40));
  assert.equal(nextChange({}, { ...SCH, skip: '2026-10-26' }, at(0, 8, 0)), at(1, 0, 0)); // 자정에 '쉬기'가 풀림
  assert.equal(nextChange({}, { on: false }, at(0, 8, 0)), null);
  assert.equal(nextChange({ open: true, until: at(0, 9, 0) }, { on: false }, at(0, 8, 0)), at(0, 9, 0));
});

test('글자로 보여 주기', () => {
  assert.equal(fmtWhen(at(0, 12, 10), at(0, 10, 0)), '오늘 12:10');
  assert.equal(fmtWhen(at(1, 9, 40), at(0, 13, 0)), '내일 09:40');
  assert.equal(fmtWhen(at(3, 9, 40), at(0, 13, 0)), '목요일 09:40');
  assert.equal(dayText(SCH, 1), '09:40~09:50, 12:10~12:50');
  assert.equal(dayText(SCH, 0), '');
});
