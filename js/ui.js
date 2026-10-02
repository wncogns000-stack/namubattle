// 화면 공통 도우미
import { TIERS, UNRANKED } from './config.js';

// h('div', {class: 'x', onclick: fn}, '글자', child, [children])
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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
export function tierEmblem(tier, size = 40) {
  const t = tier || UNRANKED;
  const idx = TIERS.indexOf(t);
  const id = `tg${++gradId}`;
  const svg = svgEl('svg', { viewBox: '0 0 64 64', width: size, height: size, class: 'tier-emblem', 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.appendChild(svgEl('stop', { offset: '0', 'stop-color': t.color }));
  grad.appendChild(svgEl('stop', { offset: '1', 'stop-color': t.color2 }));
  defs.appendChild(grad);
  svg.appendChild(defs);
  // 높은 티어일수록 날개/왕관 장식
  if (idx >= 0 && idx <= 3) {
    svg.appendChild(svgEl('path', { d: 'M6 26 L14 18 L16 34 Z M58 26 L50 18 L48 34 Z', fill: t.color, opacity: '0.85' }));
  }
  if (idx >= 0 && idx <= 2) {
    svg.appendChild(svgEl('path', { d: 'M20 12 L24 4 L28 10 L32 2 L36 10 L40 4 L44 12 Z', fill: '#fde047', stroke: '#a16207', 'stroke-width': '1.2' }));
  }
  svg.appendChild(svgEl('path', {
    d: 'M32 8 L52 16 L52 34 C52 46 42 54 32 60 C22 54 12 46 12 34 L12 16 Z',
    fill: `url(#${id})`, stroke: '#ffffff', 'stroke-width': '2.5',
  }));
  if (idx < 0) {
    svg.appendChild(svgEl('text', { x: '32', y: '43', 'text-anchor': 'middle', 'font-size': '24', 'font-weight': '700', fill: '#fff' }, '?'));
  } else {
    // 가운데 쌓기나무 모양 보석
    svg.appendChild(svgEl('path', { d: 'M32 20 L43 26 L32 32 L21 26 Z', fill: '#ffffff', opacity: '0.95' }));
    svg.appendChild(svgEl('path', { d: 'M21 26 L32 32 L32 45 L21 39 Z', fill: '#ffffff', opacity: '0.6' }));
    svg.appendChild(svgEl('path', { d: 'M43 26 L32 32 L32 45 L43 39 Z', fill: '#ffffff', opacity: '0.35' }));
  }
  return svg;
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
