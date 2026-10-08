// 게임 전체에서 쓰는 설정값입니다.
// 선생님 페이지에서 바꿀 수 있는 값(DEFAULT_SETTINGS)은 데이터베이스에 저장된 값이 우선합니다.

// 티어: 위에서부터 높은 티어. quota는 25명 기준 인원수(합계 25).
// 학생 수가 25명이 아니어도 같은 비율로 나눠집니다.
export const TIERS = [
  { id: 'challenger',  name: '챌린저',     quota: 1, color: '#f5c542', color2: '#3b82f6' },
  { id: 'grandmaster', name: '그랜드마스터', quota: 1, color: '#ef4444', color2: '#7f1d1d' },
  { id: 'master',      name: '마스터',     quota: 2, color: '#a855f7', color2: '#581c87' },
  { id: 'diamond',     name: '다이아몬드',  quota: 2, color: '#60a5fa', color2: '#1e3a8a' },
  { id: 'emerald',     name: '에메랄드',    quota: 3, color: '#10b981', color2: '#065f46' },
  { id: 'platinum',    name: '플래티넘',    quota: 4, color: '#2dd4bf', color2: '#115e59' },
  { id: 'gold',        name: '골드',       quota: 4, color: '#eab308', color2: '#854d0e' },
  { id: 'silver',      name: '실버',       quota: 3, color: '#cbd5e1', color2: '#475569' },
  { id: 'bronze',      name: '브론즈',     quota: 3, color: '#d97706', color2: '#78350f' },
  { id: 'iron',        name: '아이언',     quota: 2, color: '#78716c', color2: '#292524' },
];

// 배치고사 중인 학생에게 보여 줄 표시
export const UNRANKED = { id: 'unranked', name: '배치고사', color: '#94a3b8', color2: '#334155' };

export const START_RATING = 1000;
export const ELO_K = 32;

// 선생님이 바꿀 수 있는 기본 설정
export const DEFAULT_SETTINGS = {
  tierGap: 2,          // 티어 차이가 이 값 이하인 친구와만 대결 가능 (예: 2 → 골드는 플래티넘~실버, 에메랄드, 브론즈까지)
  placementGames: 3,   // 이 판수만큼 하기 전에는 '배치고사' (누구와도 대결 가능)
  passTimeoutSec: 0,   // 틀린 뒤 상대에게 넘어간 도전 기회가 다시 열리기까지의 시간(초). 0이면 상대가 도전할 때까지 계속 기다림
  level: 0,            // 0이면 티어에 따라 자동, 1~5면 모든 대결을 그 단계로 고정
  directInvite: false, // 친구에게 직접 대결 신청 (끄면 '대결 찾기' 자동 매칭만)
};

// 문제 난이도. n: 바닥 칸 수(n×n), maxH: 최대 층수, cells: 바닥에 놓이는 칸 수 범위, count: 전체 쌓기나무 개수 범위
// countNeeded: 이 확률로 '위·앞·옆만으로는 여러 모양이 가능하고 개수까지 봐야 하나로 정해지는' 문제를 냅니다(숨은 쌓기나무).
export const LEVELS = {
  1: { name: '1단계', n: 3, maxH: 2, cells: [3, 5], count: [4, 7],   countNeeded: 0.0 },
  2: { name: '2단계', n: 3, maxH: 3, cells: [4, 6], count: [6, 10],  countNeeded: 0.3 },
  3: { name: '3단계', n: 3, maxH: 3, cells: [5, 8], count: [9, 14],  countNeeded: 0.6 },
  4: { name: '4단계', n: 4, maxH: 3, cells: [6, 9], count: [10, 16], countNeeded: 0.7 },
  5: { name: '5단계', n: 4, maxH: 4, cells: [7, 10], count: [13, 22], countNeeded: 0.8 },
};

// 티어 순서(0=챌린저 … 9=아이언) → 문제 단계
export function levelForTierIndex(idx) {
  if (idx == null || idx < 0) return 2; // 배치고사
  if (idx <= 1) return 5;
  if (idx <= 3) return 4;
  if (idx <= 5) return 3;
  if (idx <= 7) return 2;
  return 1;
}

// 접속 중으로 볼 시간(ms)
export const ONLINE_WINDOW_MS = 45_000;
export const HEARTBEAT_MS = 15_000;
export const INVITE_TTL_MS = 60_000;
// 자동 매칭에서 상대를 찾았을 때 '수락'을 누를 수 있는 시간(ms)
export const READY_MS = 15_000;
