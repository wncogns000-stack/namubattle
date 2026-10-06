// 새 버전 확인
//  1) 서비스 워커(sw.js)를 등록해서, 게임을 열 때마다 최신 파일을 쓰게 합니다.
//  2) version.json과 이 파일의 APP_VERSION을 비교해서, 예전 파일로 열린 화면이면 새로 고칩니다.
//     이미 켜져 있는 화면도 몇 분마다, 그리고 태블릿 화면이 다시 켜질 때 확인합니다.
//
// ※ 게임을 고쳐서 올릴 때는 APP_VERSION과 version.json의 version을 똑같이 바꿔 주세요.
import { h } from './ui.js';

export const APP_VERSION = '2026-10-06.1';

const RELOAD_KEY = 'namubattle-reloaded-for';
const SAFE_ROUTES = ['login', 'lobby', 'ranking', 'history'];

async function latestVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

async function swReady() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 3000))]);
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => {
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
        setTimeout(r, 3000);
      });
    }
  } catch { /* 무시 */ }
}

function showBanner() {
  if (document.getElementById('update-banner')) return;
  document.body.appendChild(h('div', { id: 'update-banner', class: 'update-banner' },
    h('span', null, '✨ 새 버전이 나왔어요.'),
    h('button', { class: 'btn btn-small btn-primary', onclick: () => location.reload() }, '새로고침'),
  ));
}

export function startUpdates(getRouteName) {
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('서비스 워커 등록 실패', e));
  }

  let checking = false;
  let pending = null; // 대결 중이라 미뤄 둔 새 버전
  const apply = async (v) => {
    // 같은 버전 때문에 계속 새로 고치지 않도록 한 번만
    let already = null;
    try { already = sessionStorage.getItem(RELOAD_KEY); } catch { /* 무시 */ }
    const safe = SAFE_ROUTES.includes(getRouteName()) && !document.querySelector('.modal');
    if (safe && already !== v) {
      try { sessionStorage.setItem(RELOAD_KEY, v); } catch { /* 무시 */ }
      await swReady();
      location.reload();
    } else {
      pending = v;
      showBanner();
    }
  };
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const v = await latestVersion();
      if (v && v !== APP_VERSION) await apply(v);
    } finally {
      checking = false;
    }
  };

  check();
  setInterval(check, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  // 대결이 끝나고 로비 등으로 돌아오면 미뤄 둔 새 버전을 바로 적용
  window.addEventListener('hashchange', () => {
    if (pending) setTimeout(() => apply(pending), 300);
  });
}
