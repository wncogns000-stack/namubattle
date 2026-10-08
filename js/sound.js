// 효과음 (BGM 없음)
// 소리 파일 없이 Web Audio로 그 자리에서 만들어요. 내려받을 파일이 없어서 가볍고, 학교망에서도 바로 나와요.
// - 기기마다 위쪽 메뉴의 🔊/🔇로 켜고 끌 수 있어요(그 기기에만 저장).
// - 선생님이 게임 설정에서 끄면 모든 학생 기기에서 소리가 나지 않아요.
// - 태블릿은 화면을 한 번 누른 뒤부터 소리를 낼 수 있어요(브라우저 규칙).

const KEY = 'namubattle-sound';
const VOLUME = 0.45; // 25대가 함께 울리므로 너무 크지 않게 (태블릿 음량으로도 조절)

let ctx = null;
let master = null;
let teacherOn = true;
const noiseBufs = new WeakMap();

export function deviceSoundOn() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setDeviceSound(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* 저장 못 해도 됨 */ }
}
export function setTeacherSound(on) {
  teacherOn = on !== false;
}
export function teacherSoundOn() {
  return teacherOn;
}
export const soundOn = () => teacherOn && deviceSoundOn();

function audio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

// 브라우저는 사용자가 화면을 누른 뒤에만 소리를 허락하므로, 누를 때마다 소리 장치를 깨워 둠
export function unlockAudio() {
  const wake = () => { if (soundOn()) audio(); };
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
}

// ───────── 소리 조각 ─────────
function tone(c, out, t, { f, f2 = f, d = 0.12, type = 'sine', v = 0.4, a = 0.005 }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + d + 0.03);
}

function noise(c, out, t, { d = 0.06, v = 0.3, f = 1800, f2 = f, q = 1.2 } = {}) {
  let buf = noiseBufs.get(c);
  if (!buf) {
    buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBufs.set(c, buf);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f, t);
  if (f2 !== f) bp.frequency.exponentialRampToValueAtTime(f2, t + d);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + d + 0.03);
}

// 음 높이 (Hz)
const A4 = 440, C5 = 523, E5 = 659, G5 = 784, A5 = 880, B5 = 988, C6 = 1047, D6 = 1175, E6 = 1319, G6 = 1568, B6 = 1976, C7 = 2093;

// 효과음 목록: (오디오, 출력, 시작 시각, ...추가값)
export const SOUNDS = {
  // 쌓기나무를 하나 놓음: 나무 '톡'. 높이 쌓을수록 조금씩 높은 소리
  place: (c, o, t, level = 1) => {
    const f = 330 * 2 ** ((Math.min(Math.max(level, 1), 6) - 1) * 2 / 12);
    noise(c, o, t, { d: 0.045, v: 0.3, f: 2400, q: 1.6 });
    tone(c, o, t, { f: f * 1.7, f2: f, d: 0.09, type: 'triangle', v: 0.3 });
  },
  // 하나 뺌: 낮아지는 '뽁'
  remove: (c, o, t) => {
    tone(c, o, t, { f: 560, f2: 250, d: 0.1, type: 'sine', v: 0.32 });
    noise(c, o, t, { d: 0.035, v: 0.12, f: 1200 });
  },
  // 모두 지우기: '쓱'
  clear: (c, o, t) => noise(c, o, t, { d: 0.32, v: 0.5, f: 2600, f2: 300, q: 0.8 }),
  // 더 높이 쌓을 수 없음: 둔탁한 '퉁' (태블릿 스피커는 아주 낮은 소리가 잘 안 들려서 너무 낮지 않게)
  limit: (c, o, t) => tone(c, o, t, { f: 260, f2: 160, d: 0.14, type: 'triangle', v: 0.4 }),
  // 내가 정답 도전!
  challenge: (c, o, t) => {
    tone(c, o, t, { f: G5, d: 0.07, type: 'square', v: 0.17 });
    tone(c, o, t + 0.08, { f: D6, d: 0.12, type: 'square', v: 0.17 });
  },
  // 상대가 정답 도전: '띠링'
  oppChallenge: (c, o, t) => {
    tone(c, o, t, { f: A5, d: 0.13, type: 'triangle', v: 0.3 });
    tone(c, o, t + 0.13, { f: E6, d: 0.2, type: 'triangle', v: 0.3 });
  },
  // 틀림: 낮은 '삐-빅'
  wrong: (c, o, t) => {
    tone(c, o, t, { f: 233, d: 0.16, type: 'square', v: 0.18 });
    tone(c, o, t + 0.18, { f: 185, d: 0.28, type: 'square', v: 0.18 });
  },
  // 상대가 틀려서 내 기회: 반짝
  chance: (c, o, t) => [E6, G6, C7].forEach((f, i) => tone(c, o, t + i * 0.07, { f, d: 0.18, type: 'triangle', v: 0.24 })),
  // 대결 상대를 찾음 / 신청이 옴: '띵-동'
  found: (c, o, t) => {
    tone(c, o, t, { f: E6, d: 0.4, type: 'triangle', v: 0.34 });
    tone(c, o, t + 0.24, { f: C6, d: 0.6, type: 'triangle', v: 0.34 });
  },
  // 수락 눌렀을 때
  accept: (c, o, t) => tone(c, o, t, { f: C6, d: 0.09, type: 'triangle', v: 0.26 }),
  // 대결 시작: '삐, 삐, 삐-'
  start: (c, o, t) => {
    tone(c, o, t, { f: C5, d: 0.12, type: 'square', v: 0.18 });
    tone(c, o, t + 0.28, { f: C5, d: 0.12, type: 'square', v: 0.18 });
    tone(c, o, t + 0.56, { f: C6, d: 0.45, type: 'square', v: 0.2 });
  },
  // 승리: 짧은 팡파르
  win: (c, o, t) => {
    [C5, E5, G5, C6].forEach((f, i) => tone(c, o, t + i * 0.1, { f, d: 0.18, type: 'triangle', v: 0.3 }));
    [C6, E6, G6].forEach((f) => tone(c, o, t + 0.42, { f, d: 0.8, type: 'triangle', v: 0.18 }));
  },
  // 패배: 너무 슬프지 않게 내려가는 세 음
  lose: (c, o, t) => [E5, C5, A4].forEach((f, i) => tone(c, o, t + i * 0.2, { f, d: 0.32, type: 'triangle', v: 0.28 })),
  // 연습 정답
  correct: (c, o, t) => {
    tone(c, o, t, { f: C6, d: 0.13, type: 'triangle', v: 0.3 });
    tone(c, o, t + 0.11, { f: G6, d: 0.3, type: 'triangle', v: 0.3 });
  },
  // 티어 승급
  tierUp: (c, o, t) => [G5, B5, D6, G6, B6].forEach((f, i) => tone(c, o, t + i * 0.08, { f, d: 0.32, type: 'triangle', v: 0.2 })),
};

export function play(name, ...args) {
  if (!soundOn() || !SOUNDS[name]) return;
  try { window.dispatchEvent(new CustomEvent('nb-sfx', { detail: name })); } catch { /* 무시 */ }
  const c = audio();
  if (!c || c.state !== 'running') return; // 아직 화면을 누르지 않았으면 조용히 넘어감
  try { SOUNDS[name](c, master, c.currentTime + 0.01, ...args); } catch { /* 소리는 없어도 게임은 계속 */ }
}

// 쌓기 판이 바뀌었을 때 알맞은 소리 고르기 (old → next 높이 배열)
// 하나 놓기 → place(새 높이), 하나 빼기 → remove, 모두 지우기 → clear. 정답 보기처럼 한꺼번에 바뀌면 소리 없음
export function buildSound(old, next) {
  if (!old || !next || old.length !== next.length) return null;
  let diff = 0, idx = -1;
  for (let i = 0; i < next.length; i++) {
    const d = (next[i] || 0) - (old[i] || 0);
    if (d) { diff += d; idx = i; }
  }
  if (diff === 1) return { name: 'place', level: next[idx] };
  if (diff === -1) return { name: 'remove' };
  if (diff < -1 && next.every((v) => !v)) return { name: 'clear' };
  return null;
}

export function playBuild(old, next) {
  const s = buildSound(old, next);
  if (s) play(s.name, s.level);
}
