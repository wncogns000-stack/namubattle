// 데이터 저장소. Firebase Realtime Database 또는 체험 모드(localStorage) 중 하나를 같은 방법으로 씁니다.
//
//   db.get(path)                 값 읽기
//   db.set(path, value)          값 쓰기 (null이면 지우기)
//   db.update(path, {a/b: v})    여러 곳 한꺼번에 쓰기
//   db.remove(path)
//   db.transaction(path, fn)     읽고-고치고-쓰기를 한 번에 (fn이 undefined를 돌려주면 취소)
//   db.on(path, cb) → 끄기 함수  값이 바뀔 때마다 cb(value)
//   db.newKey()                  시간 순서로 정렬되는 새 키
//   db.now()                     (가능하면 서버 기준) 현재 시각 ms

import { firebaseConfig } from './firebase-config.js';

export let db = null;

function isConfigured(cfg) {
  return !!(cfg && cfg.apiKey && cfg.databaseURL);
}

export async function initDB() {
  const params = new URLSearchParams(location.search);
  const emu = params.get('emulator'); // 개발용: ?emulator=127.0.0.1:9000
  if (emu || isConfigured(firebaseConfig)) {
    db = await createFirebaseAdapter(firebaseConfig, emu);
  } else {
    db = createLocalAdapter();
  }
  return db;
}

// ───────────────────────── Firebase ─────────────────────────
async function createFirebaseAdapter(cfg, emulator) {
  const fb = await import('../vendor/firebase.js');
  const config = emulator
    ? { apiKey: 'demo-key', projectId: 'demo-namubattle', databaseURL: `http://${emulator}?ns=demo-namubattle` }
    : cfg;
  const app = fb.initializeApp(config);
  const auth = fb.getAuth(app);
  const database = fb.getDatabase(app);
  if (emulator) {
    const [host, port] = emulator.split(':');
    fb.connectDatabaseEmulator(database, host, Number(port));
    fb.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  }
  await fb.signInAnonymously(auth);

  let offset = 0;
  fb.onValue(fb.ref(database, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  const r = (p) => (p ? fb.ref(database, p) : fb.ref(database));

  return {
    mode: 'firebase',
    now: () => Date.now() + offset,
    // get() 대신 한 번만 듣는 리스너를 씁니다(같은 경로에 리스너가 있을 때 get()이 가끔 멈추는 문제를 피하려고).
    get: (p) => new Promise((resolve, reject) => {
      fb.onValue(r(p), (s) => resolve(s.val()), reject, { onlyOnce: true });
    }),
    set: (p, v) => fb.set(r(p), v ?? null),
    update: (p, v) => fb.update(r(p), v),
    remove: (p) => fb.remove(r(p)),
    newKey: () => fb.push(fb.ref(database, 'keys')).key,
    transaction: async (p, fn) => {
      const res = await fb.runTransaction(r(p), fn, { applyLocally: true });
      return { committed: res.committed, value: res.snapshot.val() };
    },
    on: (p, cb) => fb.onValue(r(p), (s) => cb(s.val()), (err) => console.error('listen error', p, err)),
    onDisconnectRemove: (p) => fb.onDisconnect(r(p)).remove(),
    cancelOnDisconnect: (p) => fb.onDisconnect(r(p)).cancel(),
  };
}

// ───────────────────────── 체험 모드 (localStorage) ─────────────────────────
// 한 브라우저의 여러 탭이 함께 쓰도록, 데이터를 작은 묶음(문서)으로 나눠 각각 다른 키에 저장합니다.
// (한 키에 전부 넣으면 두 탭이 동시에 저장할 때 서로의 변경을 덮어쓸 수 있어요.)
const LOCAL_PREFIX = 'namubattle-demo:';
const DOC_DEPTH = { builds: 3, invites: 3, history: 3 }; // 나머지는 2단계 (예: users/uid, games/gid)

export function createLocalAdapter() {
  const listeners = new Set();
  let notifyScheduled = false;

  const keysOf = (p) => String(p || '').split('/').filter(Boolean);
  const depthOf = (keys) => DOC_DEPTH[keys[0]] || 2;
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

  // Firebase처럼 null 값과 빈 객체는 저장하지 않음
  function normalize(v) {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) {
      const obj = {};
      v.forEach((x, i) => { const n = normalize(x); if (n !== null) obj[i] = n; });
      return Object.keys(obj).length ? obj : null;
    }
    if (typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const n = normalize(x);
        if (n !== null) out[k] = n;
      }
      return Object.keys(out).length ? out : null;
    }
    return v;
  }

  function readDoc(docPath) {
    try {
      const raw = localStorage.getItem(LOCAL_PREFIX + docPath);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function writeDoc(docPath, v) {
    const n = normalize(v);
    if (n === null) localStorage.removeItem(LOCAL_PREFIX + docPath);
    else localStorage.setItem(LOCAL_PREFIX + docPath, JSON.stringify(n));
  }
  function docPathsUnder(prefixKeys) {
    const pre = LOCAL_PREFIX + (prefixKeys.length ? prefixKeys.join('/') + '/' : '');
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pre)) out.push(k.slice(LOCAL_PREFIX.length));
    }
    return out;
  }
  function descend(v, keys) {
    let cur = v;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[k];
    }
    return cur === undefined ? null : cur;
  }
  function setIn(obj, keys, v) {
    if (!keys.length) return normalize(v);
    const root = obj && typeof obj === 'object' ? obj : {};
    let cur = root;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = v;
    return normalize(root);
  }

  function getAt(p) {
    const keys = keysOf(p);
    const d = keys.length ? depthOf(keys) : 2;
    if (keys.length >= d) return clone(descend(readDoc(keys.slice(0, d).join('/')), keys.slice(d)));
    // 여러 문서를 모아 하나의 객체로
    let out = null;
    for (const dp of docPathsUnder(keys)) {
      const rest = keysOf(dp).slice(keys.length);
      out = setIn(out, rest, readDoc(dp));
    }
    return out;
  }

  function setAt(p, value) {
    const keys = keysOf(p);
    const d = keys.length ? depthOf(keys) : 2;
    if (keys.length >= d) {
      const docPath = keys.slice(0, d).join('/');
      const rest = keys.slice(d);
      writeDoc(docPath, rest.length ? setIn(readDoc(docPath), rest, value) : value);
      return;
    }
    // 문서보다 위쪽 경로: 아래 문서를 모두 지우고 새로 씀
    for (const dp of docPathsUnder(keys)) localStorage.removeItem(LOCAL_PREFIX + dp);
    const v = normalize(value);
    if (v === null || typeof v !== 'object') return;
    for (const [k, child] of Object.entries(v)) setAt([...keys, k].join('/'), child);
  }

  function notifyAll() {
    notifyScheduled = false;
    for (const l of [...listeners]) {
      if (!listeners.has(l)) continue;
      const v = getAt(l.path);
      const s = JSON.stringify(v);
      if (s !== l.last) {
        l.last = s;
        try { l.cb(v); } catch (e) { console.error(e); }
      }
    }
  }
  function scheduleNotify() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    setTimeout(notifyAll, 0);
  }
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key.startsWith(LOCAL_PREFIX)) scheduleNotify();
  });

  let lastKeyTime = 0, keySeq = 0;
  return {
    mode: 'local',
    now: () => Date.now(),
    get: async (p) => getAt(p),
    set: async (p, v) => { setAt(p, v); scheduleNotify(); },
    update: async (p, obj) => {
      for (const [k, v] of Object.entries(obj)) setAt([p, k].filter(Boolean).join('/'), v);
      scheduleNotify();
    },
    remove: async (p) => { setAt(p, null); scheduleNotify(); },
    newKey: () => {
      const t = Date.now();
      keySeq = t === lastKeyTime ? keySeq + 1 : 0;
      lastKeyTime = t;
      return 'k' + t.toString(36) + keySeq.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);
    },
    transaction: async (p, fn) => {
      const cur = getAt(p);
      const next = fn(clone(cur));
      if (next === undefined) return { committed: false, value: cur };
      setAt(p, next);
      scheduleNotify();
      return { committed: true, value: getAt(p) };
    },
    on: (p, cb) => {
      const l = { path: p, cb, last: undefined };
      listeners.add(l);
      setTimeout(() => {
        if (!listeners.has(l) || l.last !== undefined) return;
        const v = getAt(p);
        l.last = JSON.stringify(v);
        cb(v);
      }, 0);
      return () => listeners.delete(l);
    },
    onDisconnectRemove: () => {},
    cancelOnDisconnect: () => {},
  };
}

export function resetLocalDemo() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LOCAL_PREFIX)) localStorage.removeItem(k);
  }
}
