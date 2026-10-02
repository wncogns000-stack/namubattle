// 3D 쌓기나무 놀이판 (Three.js)
// 높이 지도 h[y*n + x] 를 그대로 보여 주고, 눌러서 쌓거나 뺄 수 있습니다.
//   월드 좌표: x → 오른쪽, y(three) → 위, z → 앞쪽(보는 사람 쪽). 격자 y=0(앞줄)이 z가 가장 큰 쪽.
import * as THREE from '../vendor/three.js';
import { emptyHeights } from './puzzle.js';

const EDGE_COLOR = 0x8a4a1f;

const VIEW_DIRS = {
  home: [0.85, 0.95, 1.35],
  top: [0, 1, 0.0001],
  front: [0, 0.0001, 1],
  side: [1, 0.0001, 0],
  back: [-0.85, 0.95, -1.35],
};

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

// '앞'·'옆' 표지 (Jua 글꼴이 늦게 불러와지면 다시 그림)
function labelTexture(text, bg, fg, onUpdate) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const draw = () => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(30, 35, 64, 0.18)';
    g.beginPath();
    g.arc(64, 68, 56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(64, 62, 56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = bg;
    g.beginPath();
    g.arc(64, 62, 48, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fg;
    g.font = '52px "Jua", "Pretendard Variable", "Malgun Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 66);
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (document.fonts?.load) {
    document.fonts.load('52px "Jua"', text).then(() => { draw(); tex.needsUpdate = true; onUpdate && onUpdate(); }).catch(() => {});
  }
  return tex;
}

// 나무결 무늬 (교과서 쌓기나무처럼)
let woodCanvas = null;
function woodTexture() {
  if (!woodCanvas) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#ffbe7d');
    grad.addColorStop(1, '#f6a25a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      g.strokeStyle = `rgba(178, 92, 34, ${0.12 + (i % 3) * 0.05})`;
      const y0 = 14 + i * 25;
      g.beginPath();
      for (let x = 0; x <= 256; x += 8) {
        const y = y0 + Math.sin(x / 38 + i * 1.7) * 5 + Math.sin(x / 11 + i) * 1.2;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // 가장자리: 안쪽은 밝게, 바깥은 살짝 어둡게 (모서리가 둥글어 보이도록)
    g.strokeStyle = 'rgba(255, 236, 214, 0.6)';
    g.lineWidth = 12;
    g.strokeRect(8, 8, 240, 240);
    g.strokeStyle = 'rgba(150, 70, 20, 0.28)';
    g.lineWidth = 5;
    g.strokeRect(2.5, 2.5, 251, 251);
    woodCanvas = c;
  }
  const tex = new THREE.CanvasTexture(woodCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Builder3D {
  constructor(container, { n, rows, heights, editable = true, onChange = null, markers = true } = {}) {
    this.container = container;
    this.n = n;
    this.rows = rows || n;
    this.h = heights ? [...heights] : emptyHeights(n);
    this.editable = editable;
    this.onChange = onChange;
    this.mode = 'add';
    this.ok = webglAvailable();
    this._disposers = [];
    if (!this.ok) {
      container.appendChild(Object.assign(document.createElement('div'), {
        className: 'no-webgl',
        textContent: '이 기기에서는 3D 화면을 쓸 수 없어요. 아래 "위에서 본 모양에 수 쓰기"로 만들어 주세요.',
      }));
      return;
    }
    this._init(markers);
  }

  _init(markers) {
    const { n } = this;
    const scene = (this.scene = new THREE.Scene());
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = 'builder-canvas';
    this.container.appendChild(renderer.domElement);

    const camera = (this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200));
    this.target = new THREE.Vector3(0, Math.min(this.rows, 3) * 0.35, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xf0dcc0, 1.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-2, 10, 6);
    scene.add(sun);

    // 바닥 판 (나무 쟁반 위의 격자)
    this.floorTiles = [];
    const tileGeo = new THREE.PlaneGeometry(1, 1);
    const tileMat = new THREE.MeshLambertMaterial({ color: 0xfffaf1 });
    const tileMatAlt = new THREE.MeshLambertMaterial({ color: 0xf8ecd8 });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const m = new THREE.Mesh(tileGeo, (x + y) % 2 ? tileMatAlt : tileMat);
        m.rotation.x = -Math.PI / 2;
        const p = this._worldOf(x, y);
        m.position.set(p.x, 0, p.z);
        m.userData = { floor: true, x, y };
        scene.add(m);
        this.floorTiles.push(m);
      }
    }
    // 칸 사이 선
    const half = n / 2;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i - half;
      pts.push(-half, 0.004, t, half, 0.004, t, t, 0.004, -half, t, 0.004, half);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xdcbf96 })));
    const trayGeo = new THREE.BoxGeometry(n + 0.5, 0.3, n + 0.5);
    const tray = new THREE.Mesh(trayGeo, new THREE.MeshLambertMaterial({ color: 0xe2bd8c }));
    tray.position.y = -0.152;
    scene.add(tray);
    const trayEdges = new THREE.LineSegments(new THREE.EdgesGeometry(trayGeo), new THREE.LineBasicMaterial({ color: 0xb98b55 }));
    trayEdges.position.copy(tray.position);
    scene.add(trayEdges);

    if (markers) {
      const rerender = () => this.render();
      const front = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('앞', '#f6d76b', '#6b4f00', rerender), depthTest: false }));
      front.position.set(0, 0.3, n / 2 + 1);
      front.scale.set(0.85, 0.85, 1);
      scene.add(front);
      const side = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('옆', '#f8a9c4', '#7d1840', rerender), depthTest: false }));
      side.position.set(n / 2 + 1, 0.3, 0);
      side.scale.set(0.85, 0.85, 1);
      scene.add(side);
    }

    this.blockGeo = new THREE.BoxGeometry(1, 1, 1);
    this.edgeGeo = new THREE.EdgesGeometry(this.blockGeo);
    this.blockMat = new THREE.MeshLambertMaterial({ map: woodTexture(), color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.75 });
    this.blocks = new THREE.Group();
    scene.add(this.blocks);

    // 마우스를 올렸을 때 보이는 반투명 블록
    this.ghost = new THREE.Mesh(this.blockGeo, new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.42, depthWrite: false }));
    this.ghost.visible = false;
    scene.add(this.ghost);

    const controls = (this.controls = new THREE.OrbitControls(camera, renderer.domElement));
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.minZoom = 0.5;
    controls.maxZoom = 2.5;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.copy(this.target);
    controls.addEventListener('change', () => this.render());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    const el = renderer.domElement;
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button }; };
    const onUp = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      const btn = down.button;
      down = null;
      if (moved < 7 && quick && this.editable) this._pick(e, btn === 2 ? 'remove' : this.mode);
    };
    const onMove = (e) => {
      if (e.pointerType !== 'mouse' || !this.editable) return;
      this._hover(e);
    };
    const onLeave = () => { this.ghost.visible = false; this._unhighlight(); this.render(); };
    const onCtx = (e) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('contextmenu', onCtx);
    this._disposers.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('contextmenu', onCtx);
    });

    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(this.container);
    this._rebuild();
    this.setView('home', false);
    this._resize();
  }

  _worldOf(x, y) {
    const off = (this.n - 1) / 2;
    return { x: x - off, z: off - y };
  }

  _resize() {
    if (!this.renderer) return;
    const w = Math.max(10, this.container.clientWidth);
    const hgt = Math.max(10, this.container.clientHeight);
    this.renderer.setSize(w, hgt, false);
    const aspect = w / hgt;
    const s = Math.max(this.n, this.rows) * 1.45 + 1;
    // 화면이 세로로 길면(휴대폰) 가로 폭에 맞춰 판 전체가 보이도록
    const halfW = aspect >= 1 ? (s * aspect) / 2 : s / 2;
    const halfH = aspect >= 1 ? s / 2 : s / (2 * aspect);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (!this.renderer || this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      if (this.renderer) this.renderer.render(this.scene, this.camera);
    });
  }

  _rebuild() {
    if (!this.ok) return;
    const { n } = this;
    for (const c of [...this.blocks.children]) this.blocks.remove(c);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = this.h[y * n + x];
        const p = this._worldOf(x, y);
        for (let z = 0; z < v; z++) {
          const m = new THREE.Mesh(this.blockGeo, this.blockMat);
          m.position.set(p.x, z + 0.5, p.z);
          m.userData = { x, y, z };
          const e = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
          m.add(e);
          this.blocks.add(m);
        }
      }
    }
    this._highlighted = null;
    this.render();
  }

  _ray(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.blocks.children, ...this.floorTiles], false);
    return hits[0] || null;
  }

  // 클릭한 곳 → 쌓을/뺄 칸
  _targetOf(hit, mode) {
    if (!hit) return null;
    const ud = hit.object.userData;
    if (ud.floor) return mode === 'add' ? { x: ud.x, y: ud.y } : null;
    if (mode === 'remove') return { x: ud.x, y: ud.y };
    const nrm = hit.face.normal;
    if (nrm.y > 0.5) return { x: ud.x, y: ud.y };
    if (nrm.y < -0.5) return null;
    const nx = ud.x + Math.round(nrm.x);
    const ny = ud.y - Math.round(nrm.z); // 앞쪽(+z) 면을 누르면 한 줄 앞(y-1)
    if (nx < 0 || ny < 0 || nx >= this.n || ny >= this.n) return null;
    return { x: nx, y: ny };
  }

  _pick(e, mode) {
    const t = this._targetOf(this._ray(e), mode);
    if (!t) return;
    this.bump(t.x, t.y, mode === 'add' ? 1 : -1);
  }

  _unhighlight() {
    if (this._highlighted) {
      this._highlighted.material = this.blockMat;
      this._highlighted = null;
    }
  }

  _hover(e) {
    const t = this._targetOf(this._ray(e), this.mode);
    this._unhighlight();
    this.ghost.visible = false;
    if (t) {
      const v = this.h[t.y * this.n + t.x];
      if (this.mode === 'add' && v < this.rows) {
        const p = this._worldOf(t.x, t.y);
        this.ghost.position.set(p.x, v + 0.5, p.z);
        this.ghost.visible = true;
      } else if (this.mode === 'remove' && v > 0) {
        const top = this.blocks.children.find((m) => m.userData.x === t.x && m.userData.y === t.y && m.userData.z === v - 1);
        if (top) {
          if (!this._removeMat) this._removeMat = new THREE.MeshLambertMaterial({ color: 0xf2475a, transparent: true, opacity: 0.78 });
          top.material = this._removeMat;
          this._highlighted = top;
        }
      }
    }
    this.render();
  }

  // 한 칸의 높이를 delta만큼 바꾸기
  bump(x, y, delta) {
    const i = y * this.n + x;
    const v = this.h[i] + delta;
    if (v < 0) return false;
    if (v > this.rows) {
      this.container.dispatchEvent(new CustomEvent('builder-limit', { bubbles: true }));
      return false;
    }
    this.h[i] = v;
    this.ghost && (this.ghost.visible = false);
    this._rebuild();
    this.onChange && this.onChange(this.getHeights());
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    if (this.ghost) this.ghost.visible = false;
    this._unhighlight();
    this.render();
  }

  getHeights() {
    return [...this.h];
  }

  setHeights(h, silent = true) {
    this.h = [...h];
    this._rebuild();
    if (!silent && this.onChange) this.onChange(this.getHeights());
  }

  clear() {
    this.setHeights(emptyHeights(this.n), false);
  }

  setView(name, animate = true) {
    if (!this.ok) return;
    const d = VIEW_DIRS[name] || VIEW_DIRS.home;
    const dir = new THREE.Vector3(...d).normalize();
    const dist = 30;
    const to = this.target.clone().add(dir.multiplyScalar(dist));
    const from = this.camera.position.clone();
    const zoomFrom = this.camera.zoom;
    const zoomTo = 1;
    if (!animate || from.lengthSq() === 0) {
      this.camera.position.copy(to);
      this.camera.zoom = zoomTo;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(this.target);
      this.controls.update();
      this.render();
      return;
    }
    // 구면을 따라 부드럽게 이동
    const start = performance.now();
    const dur = 450;
    const a = from.clone().sub(this.target);
    const b = to.clone().sub(this.target);
    const step = (now) => {
      if (!this.renderer) return;
      const k = Math.min(1, (now - start) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const v = a.clone().lerp(b, e);
      if (v.lengthSq() < 1e-6) v.set(0.01, 1, 0.01);
      v.setLength(dist);
      this.camera.position.copy(this.target).add(v);
      this.camera.zoom = zoomFrom + (zoomTo - zoomFrom) * e;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(this.target);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  rotate(deg) {
    if (!this.ok) return;
    const off = this.camera.position.clone().sub(this.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
    this.camera.position.copy(this.target).add(off);
    this.controls.update();
    this.render();
  }

  dispose() {
    if (!this.renderer) return;
    this._disposers.forEach((f) => f());
    this.ro && this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { m.map && m.map.dispose(); m.dispose(); });
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
    this.renderer = null;
  }
}
