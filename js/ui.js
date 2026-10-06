// 화면 공통 도우미
import { TIERS, UNRANKED } from './config.js';

// h('div', {class: 'x', onclick: fn}, '글자', child, [children])
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v; // 우리 코드가 만든 고정 문자열에만 사용
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

// ───────── 한국어 조사 ─────────
function hasFinal(word) {
  const s = String(word || '').trim();
  const ch = s.charCodeAt(s.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 !== 0;
  return null;
}
// josa('민준', '이/가') → '민준이', josa('하나', '은/는') → '하나는'
export function josa(word, pair) {
  const [a, b] = pair.split('/');
  const f = hasFinal(word);
  if (f === null) return `${word}${a}(${b})`;
  return `${word}${f ? a : b}`;
}

// ───────── 알림 ─────────
export function toast(msg, type = 'info', ms = 2600) {
  const root = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${type}` }, msg);
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// buttons: [{label, value, kind}] → 누른 버튼의 value로 resolve
let modalStack = [];
export function modal({ title, body, buttons = [{ label: '확인', value: true, kind: 'primary' }], dismissible = true, className = '' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modals');
    const close = (v) => {
      wrap.remove();
      modalStack = modalStack.filter((m) => m !== entry);
      resolve(v);
    };
    const box = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true' },
      title ? h('h3', { class: 'modal-title' }, title) : null,
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-buttons' },
        buttons.map((b) => h('button', { class: `btn ${b.kind ? 'btn-' + b.kind : ''}`, onclick: () => close(b.value) }, b.label)),
      ),
    );
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (dismissible && e.target === wrap) close(undefined); } }, box);
    const entry = { close };
    modalStack.push(entry);
    root.appendChild(wrap);
    const first = box.querySelector('input, .btn-primary');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export function closeAllModals() {
  for (const m of [...modalStack]) m.close(undefined);
}

export function confirmBox(title, text, okLabel = '확인', kind = 'primary') {
  return modal({
    title,
    body: h('p', null, text),
    buttons: [
      { label: '취소', value: false },
      { label: okLabel, value: true, kind },
    ],
  }).then((v) => v === true);
}

// 입력칸이 있는 대화상자. fields: [{name, label, type, value, placeholder}]
export async function promptBox(title, fields, okLabel = '확인', note) {
  const inputs = {};
  const body = h('div', { class: 'form' },
    note ? h('p', { class: 'muted' }, note) : null,
    fields.map((f) => {
      const inp = h('input', { type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', autocomplete: 'off' });
      inputs[f.name] = inp;
      return h('label', { class: 'field' }, h('span', null, f.label), inp);
    }),
  );
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') body.closest('.modal').querySelector('.btn-primary')?.click();
  });
  const ok = await modal({ title, body, buttons: [{ label: '취소', value: false }, { label: okLabel, value: true, kind: 'primary' }] });
  if (!ok) return null;
  const out = {};
  for (const [k, inp] of Object.entries(inputs)) out[k] = inp.value;
  return out;
}

// ───────── 티어 배지 ─────────
let gradId = 0;
const SHIELD_OUT = 'M32 5 L55 13.5 L55 33 C55 46.5 44.5 55 32 61 C19.5 55 9 46.5 9 33 L9 13.5 Z';
const SHIELD_IN = 'M32 9.5 L50.5 16.5 L50.5 33 C50.5 43.8 42.2 51 32 56 C21.8 51 13.5 43.8 13.5 33 L13.5 16.5 Z';
const SHIELD_GLOSS = 'M32 9.5 L50.5 16.5 L50.5 27 C42 31 22 31 13.5 27 L13.5 16.5 Z';
const FEATHERS = [
  'M13 22 C5 21 1 15 1 8 C7 13 11 14.5 15 15.5 Z',
  'M12 31 C4.5 31 0 25.5 -1 19.5 C5.5 23.5 9.5 24.5 13.5 24.5 Z',
  'M12.5 40 C5.5 40.5 1 36 -0.5 30.5 C5.5 33.5 9.5 34 13.5 33.5 Z',
];

// 쌓기나무 무늬가 들어간 방패 모양 티어 엠블럼
export function tierEmblem(tier, size = 40) {
  const t = tier || UNRANKED;
  const idx = TIERS.indexOf(t);
  const id = `tg${++gradId}`;
  const svg = svgEl('svg', { viewBox: '0 0 64 64', width: size, height: size, class: 'tier-emblem', 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  const face = svgEl('linearGradient', { id: `${id}f`, x1: '0', y1: '0', x2: '0.3', y2: '1' });
  face.appendChild(svgEl('stop', { offset: '0', 'stop-color': t.color }));
  face.appendChild(svgEl('stop', { offset: '1', 'stop-color': t.color2 }));
  const gold = svgEl('linearGradient', { id: `${id}g`, x1: '0', y1: '0', x2: '0', y2: '1' });
  gold.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#fff1a8' }));
  gold.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#f5a623' }));
  defs.append(face, gold);
  svg.appendChild(defs);

  // 날개: 에메랄드 이상 (높을수록 깃털이 많아짐)
  const feathers = idx < 0 ? 0 : idx === 0 ? 3 : idx <= 2 ? 2 : idx <= 4 ? 1 : 0;
  if (feathers) {
    const wing = svgEl('g', { fill: t.color, stroke: t.color2, 'stroke-width': '1', 'stroke-linejoin': 'round' });
    FEATHERS.slice(0, feathers).forEach((d) => wing.appendChild(svgEl('path', { d })));
    const mirror = wing.cloneNode(true);
    mirror.setAttribute('transform', 'matrix(-1 0 0 1 64 0)');
    svg.append(wing, mirror);
  }
  // 방패
  svg.appendChild(svgEl('path', { d: SHIELD_OUT, fill: t.color2 }));
  svg.appendChild(svgEl('path', { d: SHIELD_IN, fill: `url(#${id}f)`, stroke: 'rgba(255,255,255,0.55)', 'stroke-width': '1.2' }));
  svg.appendChild(svgEl('path', { d: SHIELD_GLOSS, fill: '#ffffff', opacity: '0.2' }));
  if (idx < 0) {
    svg.appendChild(svgEl('text', { x: '32', y: '42', 'text-anchor': 'middle', 'font-size': '24', 'font-family': 'Jua, sans-serif', fill: '#fff' }, '?'));
  } else {
    // 가운데 쌓기나무
    const cube = svgEl('g', { stroke: t.color2, 'stroke-width': '0.9', 'stroke-linejoin': 'round' });
    cube.appendChild(svgEl('path', { d: 'M32 21 L42.5 27 L32 33 L21.5 27 Z', fill: '#ffffff' }));
    cube.appendChild(svgEl('path', { d: 'M21.5 27 L32 33 L32 45 L21.5 39 Z', fill: '#ffffff', 'fill-opacity': '0.72' }));
    cube.appendChild(svgEl('path', { d: 'M42.5 27 L32 33 L32 45 L42.5 39 Z', fill: '#ffffff', 'fill-opacity': '0.45' }));
    svg.appendChild(cube);
  }
  // 아이언~실버: 리벳, 골드·플래티넘: 옆 보석
  if (idx >= 7) {
    for (const [cx, cy] of [[18, 19], [46, 19]]) svg.appendChild(svgEl('circle', { cx, cy, r: '1.8', fill: '#fff', opacity: '0.7' }));
  } else if (idx === 5 || idx === 6) {
    for (const x of [9, 55]) svg.appendChild(svgEl('path', { d: `M${x} 26 l3 4 -3 4 -3 -4 Z`, fill: '#fff', stroke: t.color2, 'stroke-width': '1' }));
  }
  // 왕관: 마스터 이상
  if (idx >= 0 && idx <= 2) {
    svg.appendChild(svgEl('path', {
      d: 'M21 10.5 L22.5 2.5 L27.5 7 L32 0 L36.5 7 L41.5 2.5 L43 10.5 Z',
      fill: `url(#${id}g)`, stroke: '#a16207', 'stroke-width': '1', 'stroke-linejoin': 'round',
    }));
    svg.appendChild(svgEl('circle', { cx: '32', cy: '7.2', r: '1.6', fill: idx === 0 ? '#3b6ff5' : t.color2 }));
  }
  // 반짝이: 챌린저
  if (idx === 0) {
    for (const [x, y, s] of [[5, 46, 3.2], [59, 46, 3.2], [54, 4, 2.4]]) {
      svg.appendChild(svgEl('path', { d: `M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z`, fill: '#ffd43b' }));
    }
  }
  return svg;
}

// 이름 첫 글자 아바타 (세 글자 이상 한글 이름은 성을 빼고 이름 첫 글자)
const AVATAR_COLORS = [
  ['#8aa2ff', '#4c6fff'], ['#ffa477', '#f2475a'], ['#4fe0a5', '#12a564'], ['#ffd25c', '#f08c00'],
  ['#c08bff', '#7b3fe4'], ['#52e0d6', '#0f9f9b'], ['#ff8fc0', '#e0457b'], ['#7fc7ff', '#2f7fd8'],
];
export function avatar(name, key, state) {
  const n = String(name || '?').trim();
  let hsh = 0;
  for (const ch of String(key || n)) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const [a1, a2] = AVATAR_COLORS[hsh % AVATAR_COLORS.length];
  const isHangul = /^[가-힣]+$/.test(n);
  const letter = isHangul && n.length >= 3 ? n[1] : n[0] || '?';
  return h('span', { class: 'avatar', style: { '--a1': a1, '--a2': a2 }, 'aria-hidden': 'true' },
    letter,
    state ? h('i', { class: `online-dot state-${state}` }) : null,
  );
}

export function tierBadge(standing, { size = 28, showName = true } = {}) {
  const tier = standing?.tier || UNRANKED;
  let label = tier.name;
  if (standing && !standing.ranked && standing.placementLeft != null) label = `배치고사 ${standing.games}/${standing.games + standing.placementLeft}`;
  return h('span', { class: `tier-badge tier-${tier.id}` }, tierEmblem(tier, size), showName ? h('span', { class: 'tier-name' }, label) : null);
}

// ───────── 시간 표시 ─────────
export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}분 ${String(r).padStart(2, '0')}초` : `${r}초`;
}

// 시각 표시: '오후 2:30'
export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ───────── 축하 효과 ─────────
export function confetti(n = 90) {
  const root = h('div', { class: 'confetti' });
  const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#a855f7', '#f472b6'];
  for (let i = 0; i < n; i++) {
    const p = h('i', {
      style: {
        left: Math.random() * 100 + 'vw',
        background: colors[i % colors.length],
        animationDelay: Math.random() * 0.6 + 's',
        animationDuration: 1.8 + Math.random() * 1.6 + 's',
        transform: `rotate(${Math.random() * 360}deg)`,
      },
    });
    root.appendChild(p);
  }
  document.body.appendChild(root);
  setTimeout(() => root.remove(), 4000);
}

// 큰 글씨로 잠깐 보여 주기 (예: "정답 도전!")
export function flash(text, kind = 'info', ms = 1400) {
  const el = h('div', { class: `flash flash-${kind}` }, text);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
