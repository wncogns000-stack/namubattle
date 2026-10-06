// 항상 최신 게임 파일로 열리게 하는 서비스 워커
//
// - 게임 파일(html, js, css, json, 그림)은 열 때마다 서버에 "바뀌었나요?"를 먼저 물어봅니다.
//   바뀌지 않았으면 다시 내려받지 않으므로(304 응답) 느려지지 않아요.
// - 브라우저가 메모리에 들고 있는 예전 파일을 그대로 다시 쓰지 않도록,
//   돌려주는 파일에 "쓰기 전에 항상 확인" 표시(Cache-Control: no-cache)를 붙입니다.
// - 글꼴(vendor/fonts)은 거의 바뀌지 않으므로 브라우저 캐시를 그대로 씁니다.
// - Firebase 등 다른 주소로 가는 요청은 건드리지 않습니다.
// - 인터넷이 끊겼을 때는 브라우저가 가진 파일을 그대로 씁니다.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function fresh(req) {
  const cache = req.cache === 'no-store' || req.cache === 'reload' ? req.cache : 'no-cache';
  let res;
  try {
    res = await fetch(new Request(req, { cache }));
  } catch {
    return fetch(req);
  }
  if (res.type !== 'basic' || res.status !== 200) return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/vendor/fonts/')) return;
  event.respondWith(fresh(req));
});
