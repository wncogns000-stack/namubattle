# vendor

학교망에서 외부 CDN이 막혀도 동작하도록 라이브러리를 묶어서 넣어 둔 파일입니다. 직접 고치지 마세요.

| 파일 | 원본 | 버전 | 라이선스 |
|---|---|---|---|
| `three.js` | [three](https://www.npmjs.com/package/three) + `examples/jsm/controls/OrbitControls.js` | 0.186.1 | MIT |
| `firebase.js` | [firebase](https://www.npmjs.com/package/firebase) (app, auth, database) | 12.19.0 | Apache-2.0 |

만든 방법 (esbuild):

```js
// three-entry.js
export { Scene, Color, OrthographicCamera, WebGLRenderer, BoxGeometry, PlaneGeometry, EdgesGeometry, CircleGeometry,
  LineSegments, LineBasicMaterial, Mesh, MeshLambertMaterial, MeshBasicMaterial, AmbientLight, DirectionalLight,
  HemisphereLight, Group, Raycaster, Vector2, Vector3, CanvasTexture, SpriteMaterial, Sprite, SRGBColorSpace, DoubleSide,
  BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// fb-entry.js
export { initializeApp } from 'firebase/app';
export { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
export { getDatabase, ref, get, set, update, remove, push, runTransaction, onValue, onDisconnect, connectDatabaseEmulator } from 'firebase/database';
```

```
npx esbuild three-entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=vendor/three.js
npx esbuild fb-entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=vendor/firebase.js
```
