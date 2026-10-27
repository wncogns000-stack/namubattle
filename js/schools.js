// 여러 학교가 함께 하기
// - 처음부터 있던 학생들은 학교 정보가 없고, '기본 학교'(main) 소속으로 봐요. 기존 데이터는 바꾸지 않아요.
// - 다른 학교는 기본 학교 선생님이 선생님 페이지 '학교' 탭에서 추가해요. schools/학교 = { name, createdAt }
// - 학교마다 선생님 비밀번호와 대결 시간이 따로예요.
//     선생님 비밀번호: 기본 학교 config/teacher, 다른 학교 config/teachers/학교
//     대결 시간:      기본 학교 config/battle,  다른 학교 config/battles/학교
//     대결 시간표:    기본 학교 config/schedule, 다른 학교 config/schedules/학교
// - 랭킹·티어는 모든 학교를 합쳐서 계산하고, 학교별 합계(승·패)는 일부러 보여 주지 않아요.
import { store, schoolOf } from './store.js';
import { MAIN_SCHOOL_NAME } from './config.js';
import { h } from './ui.js';

export const MAIN = 'main';

export { teacherPath } from './auth.js';
export const battlePath = (sid) => (!sid || sid === MAIN ? 'config/battle' : `config/battles/${sid}`);
export const schedulePath = (sid) => (!sid || sid === MAIN ? 'config/schedule' : `config/schedules/${sid}`);

// [{ id, name }] 기본 학교가 맨 앞, 나머지는 추가한 순서
export function schoolList() {
  const s = store.schools || {};
  const others = Object.entries(s)
    .filter(([id, v]) => id !== MAIN && v)
    .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
    .map(([id, v]) => ({ id, name: v.name || '학교' }));
  return [{ id: MAIN, name: s[MAIN]?.name || MAIN_SCHOOL_NAME }, ...others];
}

export const multiSchool = () => schoolList().length > 1;

export function schoolName(sid) {
  return schoolList().find((x) => x.id === (sid || MAIN))?.name || '';
}

export function schoolIndex(sid) {
  return Math.max(0, schoolList().findIndex((x) => x.id === (sid || MAIN)));
}

// 이름 옆에 붙는 작은 학교 표시 (학교가 하나뿐이면 표시하지 않음)
export function schoolChip(uid, { sid } = {}) {
  if (!multiSchool()) return null;
  const id = sid || schoolOf(uid);
  return h('span', { class: `school-chip sc-${schoolIndex(id) % 4}` }, schoolName(id));
}

export { schoolOf };
