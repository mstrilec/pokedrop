import type * as Three from 'three';
import { token } from './tokens';

export type ShowcaseCard = { image: string; holo: boolean };

export type PackShowcaseOptions = {
  cards: ShowcaseCard[];
  cover: string;
  logo: string;
  packName: string;
  compact: boolean;
  onReady: () => void;
  onFallback: (reason: string) => void;
};

export type PackShowcaseHandle = {
  /** 0 sealed … 1 fanned out; the page owns the scroll and maps it here. */
  setProgress(progress: number): void;
  setCompact(compact: boolean): void;
  dispose(): void;
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const seg = (p: number, a: number, b: number) => ease(clamp((p - a) / (b - a)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

type PackColours = { energy: string; end: string; shade: string; ink: string; rarity: string };

// The booster wrapper as components/packs/booster-pack.tsx draws it at size lg,
// scaled to a 512 px texture.
function drawPack(
  g: CanvasRenderingContext2D,
  cover: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  packName: string,
  c: PackColours,
) {
  const W = 512;
  const H = 820;
  const k = W / 220;
  const a = (165 * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const L = Math.abs(W * dx) + Math.abs(H * dy);
  const grad = g.createLinearGradient(
    W / 2 - (dx * L) / 2,
    H / 2 - (dy * L) / 2,
    W / 2 + (dx * L) / 2,
    H / 2 + (dy * L) / 2,
  );
  grad.addColorStop(0.1, c.energy);
  grad.addColorStop(0.95, c.end);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = c.shade;
  g.fillRect(0, 0, W, H / 16);
  g.fillRect(0, H - H / 16, W, H / 16);
  const px = 16 * k;
  const py = 20 * k;
  const logoH = 48 * k;
  g.fillStyle = c.ink;
  g.textAlign = 'center';
  if (logo) {
    const s = Math.min((W - 2 * px) / logo.width, logoH / logo.height);
    g.drawImage(
      logo,
      (W - logo.width * s) / 2,
      py + (logoH - logo.height * s) / 2,
      logo.width * s,
      logo.height * s,
    );
  } else {
    g.font = `800 ${13 * k}px Geist, system-ui, sans-serif`;
    g.fillText(packName.toUpperCase(), W / 2, py + logoH / 2 + 5 * k);
  }
  const ww = W - 2 * px;
  const wh = (ww * 3) / 4;
  const wy = (H - wh) / 2;
  const r = 13 * k;
  g.save();
  g.beginPath();
  g.roundRect(px, wy, ww, wh, r);
  g.clip();
  g.fillStyle = grad;
  g.fillRect(px, wy, ww, wh);
  if (cover) {
    const s = Math.max(ww / cover.width, wh / cover.height);
    const iw = cover.width * s;
    const ih = cover.height * s;
    g.drawImage(cover, px + (ww - iw) / 2, wy + (wh - ih) * 0.15, iw, ih);
  }
  g.restore();
  g.lineWidth = 2 * k;
  g.strokeStyle = c.rarity;
  g.beginPath();
  g.roundRect(px + k, wy + k, ww - 2 * k, wh - 2 * k, r);
  g.stroke();
  g.fillStyle = c.ink;
  g.font = `800 ${15 * k}px Geist, system-ui, sans-serif`;
  g.fillText(packName, W / 2, H - py - 4 * k);
}

const VERT = `
varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz;
  vec4 mv = viewMatrix * w; vView = -mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

const PACK_FRAG = `
precision highp float;
uniform sampler2D uMap; uniform float uOpacity; uniform float uPart; uniform float uTearV; uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying vec3 vWorld;
void main(){
  float tri = abs(fract(vUv.x / 0.036) - 0.5) * 2.0;
  if (vUv.y < 0.0114 * tri || 1.0 - vUv.y < 0.0114 * tri) discard;
  float zig = uTearV + 0.014 * (abs(fract(vUv.x / 0.05) - 0.5) * 2.0 - 0.5);
  if (uPart < 0.5 && vUv.y > zig) discard;
  if (uPart > 0.5 && vUv.y < zig) discard;
  vec3 n = normalize(vN); vec3 v = normalize(vView);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + ndv * 1.8 + vUv.y * 0.5 + uTime * 0.02));
  vec3 col;
  if (gl_FrontFacing) {
    col = texture2D(uMap, vUv).rgb + irid * 0.08 + irid * pow(1.0 - ndv, 2.0) * 0.55;
  } else {
    col = mix(vec3(0.62, 0.65, 0.72), irid, 0.3) * (0.55 + 0.45 * ndv);
  }
  float s = smoothstep(0.16, 0.0, abs(vUv.x + vUv.y * 0.35 - fract(uTime * 0.18) * 2.2 + 0.4));
  col += s * 0.22;
  gl_FragColor = vec4(col, uOpacity);
}`;

// The back's two colours mirror --card-back, a gradient a shader cannot read.
const CARD_FRAG = `
precision highp float;
uniform sampler2D uMap; uniform float uHolo; uniform float uSweep; uniform float uOpacity; uniform float uTime; uniform vec3 uRarity;
varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying vec3 vWorld;
float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 p = (vUv - 0.5) * vec2(0.716, 1.0);
  float d = rbox(p, vec2(0.358, 0.5), 0.034);
  if (d > 0.0) discard;
  vec3 col;
  if (gl_FrontFacing) {
    col = texture2D(uMap, vUv).rgb;
    float ndv = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vUv.x + vUv.y * 0.6 + ndv * 2.0 + uTime * 0.05));
    float art = smoothstep(0.08, 0.11, vUv.x) * smoothstep(0.92, 0.89, vUv.x) * smoothstep(0.50, 0.53, vUv.y) * smoothstep(0.91, 0.88, vUv.y);
    col += irid * uHolo * (0.05 + 0.24 * art);
    col += uRarity * smoothstep(-0.02, 0.0, d) * uHolo * 0.8;
  } else {
    vec2 q = vUv - 0.5;
    col = mix(vec3(0.137, 0.188, 0.337), vec3(0.071, 0.090, 0.165), vUv.y * 0.6 + vUv.x * 0.4);
    float ring = smoothstep(0.012, 0.0, abs(length(q * vec2(0.716, 1.0)) - 0.15));
    float disc = smoothstep(0.13, 0.12, length(q * vec2(0.716, 1.0)));
    col = mix(col, uRarity, disc * 0.85) + ring * 0.25;
    col += smoothstep(-0.03, -0.022, d) * 0.12;
  }
  float s = smoothstep(0.35, 0.0, abs(vWorld.x * 0.22 + vWorld.y * 0.08 - uSweep));
  col += s * 0.45;
  gl_FragColor = vec4(col, uOpacity);
}`;

const FLASH_FRAG = `
precision highp float;
uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv;
void main(){ float r = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(mix(uColor, vec3(1.0), a * a) * a * uOpacity, 1.0); }`;

/**
 * The booster pouch in 3D: shakes, tears at the top, and fans its cards out in
 * an arc as `setProgress` goes from 0 to 1, in either direction.
 */
export async function init(
  container: HTMLElement,
  opts: PackShowcaseOptions,
): Promise<PackShowcaseHandle> {
  const { cards, cover, logo, packName, onReady, onFallback } = opts;
  let compact = opts.compact;

  let disposed = false;
  let raf = 0;
  let visible = true;
  let progress = 0;
  let ready = false;
  let renderer: Three.WebGLRenderer | null = null;
  const owned: { dispose(): void }[] = [];
  const cleanups: (() => void)[] = [];
  const handle: PackShowcaseHandle = { dispose, setProgress, setCompact };

  function fail(reason: string) {
    if (disposed) return;
    dispose();
    onFallback(reason);
  }

  let THREE: typeof Three;
  try {
    THREE = await import('three');
  } catch {
    onFallback('load-failed');
    return handle;
  }
  if (disposed) return handle;

  const [coverImg, logoImg] = await Promise.all([loadImage(cover), loadImage(logo)]);
  const cardTex = await Promise.all(
    cards.map(
      (card) =>
        new Promise<Three.Texture | null>((resolve) => {
          const loader = new THREE.TextureLoader();
          loader.setCrossOrigin('anonymous');
          loader.load(card.image, resolve, undefined, () => resolve(null));
        }),
    ),
  );
  if (disposed || cardTex.some((t) => !t)) {
    cardTex.forEach((t) => t?.dispose());
    if (!disposed) onFallback('texture-failed');
    return handle;
  }
  const textures = cardTex as Three.Texture[];
  owned.push(...textures);

  const packCanvas = document.createElement('canvas');
  packCanvas.width = 512;
  packCanvas.height = 820;
  const g = packCanvas.getContext('2d');
  if (!g) {
    onFallback('no-2d');
    return handle;
  }
  const energy = token('--e-fire');
  const rarity = token('--c-rare');
  drawPack(g, coverImg, logoImg, packName, {
    energy,
    rarity,
    end: token('--card-face-end'),
    shade: token('--booster-shade'),
    ink: token('--booster-ink'),
  });

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    onFallback('no-webgl');
    return handle;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity .6s ease;pointer-events:none;';
  container.appendChild(canvas);
  const onLost = (event: Event) => {
    event.preventDefault();
    fail('context-lost');
  };
  canvas.addEventListener('webglcontextlost', onLost);
  cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

  // Pack: a body and a tear strip, both pillowed planes.
  const PW = 2.2;
  const PH = 3.52;
  const TEAR = 0.9;
  const ZIG = 0.02;
  const packTex = new THREE.CanvasTexture(packCanvas);
  packTex.anisotropy = 4;
  owned.push(packTex);
  const pouch = (v0: number, v1: number, sx: number, sy: number) => {
    const geo = new THREE.PlaneGeometry(PW, PH * (v1 - v0), sx, sy);
    const pos = geo.attributes.position!;
    const uv = geo.attributes.uv!;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = v0 + uv.getY(i) * (v1 - v0);
      uv.setY(i, v);
      pos.setZ(
        i,
        0.14 * Math.pow(Math.sin(Math.PI * u), 0.6) * Math.pow(Math.sin(Math.PI * v), 0.5),
      );
    }
    geo.computeVertexNormals();
    owned.push(geo);
    return geo;
  };
  const packMat = (part: number) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: PACK_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: packTex },
        uOpacity: { value: 1 },
        uPart: { value: part },
        uTearV: { value: TEAR },
        uTime: { value: 0 },
      },
    });
    owned.push(m);
    return m;
  };
  const pack = new THREE.Group();
  const bodyMat = packMat(0);
  const stripMat = packMat(1);
  const bodyH = PH * (TEAR + ZIG);
  const body = new THREE.Mesh(pouch(0, TEAR + ZIG, 24, 36), bodyMat);
  body.position.y = -PH / 2 + bodyH / 2;
  pack.add(body);
  const stripH = PH * (1 - TEAR + ZIG);
  const hinge = new THREE.Group();
  hinge.position.set(-PW / 2, -PH / 2 + PH * (TEAR - ZIG), 0.001);
  const strip = new THREE.Mesh(pouch(TEAR - ZIG, 1, 24, 4), stripMat);
  strip.position.set(PW / 2, stripH / 2, 0);
  hinge.add(strip);
  pack.add(hinge);
  scene.add(pack);

  const flashGeo = new THREE.PlaneGeometry(4, 4);
  owned.push(flashGeo);
  const flashMat = new THREE.ShaderMaterial({
    vertexShader:
      'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: FLASH_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(energy) } },
  });
  owned.push(flashMat);
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.set(0, PH / 2 - 0.3, 0.3);
  scene.add(flash);

  // Cards
  const CW = 1.62;
  const CH = CW / 0.716;
  const cardGeo = new THREE.PlaneGeometry(CW, CH, 1, 1);
  owned.push(cardGeo);
  const rarityColour = new THREE.Color(rarity);
  const cardMeshes = textures.map((texture, i) => {
    texture.anisotropy = 4;
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: CARD_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: texture },
        uHolo: { value: cards[i]!.holo ? 1 : 0 },
        uSweep: { value: -3 },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uRarity: { value: rarityColour },
      },
    });
    owned.push(m);
    const mesh = new THREE.Mesh(cardGeo, m);
    scene.add(mesh);
    return mesh;
  });

  const frameCamera = () => {
    if (!renderer) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const needW = compact ? 5.0 : 8.2;
    const needH = compact ? 5.6 : 5.0;
    camera.position.set(0, 0.2, Math.max(needH / (2 * t), needW / (2 * t * camera.aspect)));
    camera.updateProjectionMatrix();
  };
  frameCamera();
  const ro = new ResizeObserver(() => {
    frameCamera();
    start();
  });
  ro.observe(container);
  cleanups.push(() => ro.disconnect());

  function pose(p: number, time: number) {
    const n = cardMeshes.length;
    const shake = seg(p, 0.03, 0.08) * (1 - seg(p, 0.1, 0.14));
    const tear = seg(p, 0.1, 0.3);
    const exit = seg(p, 0.42, 0.64);
    pack.rotation.z = Math.sin(p * 260) * 0.035 * shake;
    pack.rotation.y = -0.18 * (1 - seg(p, 0, 0.12));
    pack.position.set(0, -0.15 - exit * 2.6, 0);
    pack.scale.setScalar(1 - exit * 0.25);
    hinge.rotation.z = tear * 0.65;
    hinge.rotation.y = -tear * 1.25;
    hinge.position.x = -PW / 2 - tear * 0.4;
    hinge.position.y = -PH / 2 + PH * (TEAR - ZIG) + tear * 0.7;
    stripMat.uniforms.uOpacity!.value = 1 - seg(p, 0.24, 0.36);
    bodyMat.uniforms.uOpacity!.value = 1 - seg(p, 0.5, 0.64);
    flashMat.uniforms.uOpacity!.value = seg(p, 0.18, 0.27) * (1 - seg(p, 0.27, 0.42)) * 1.2;
    pack.visible = p < 0.66;
    hinge.visible = p < 0.37;
    // Rise out of the pouch, then fan into an arc and flip face-up.
    const rise = seg(p, 0.26, 0.5);
    const spread = compact ? 0.12 : 0.2;
    const R = compact ? 5.5 : 6.2;
    const sweep = lerp(-2.2, 2.6, seg(p, 0.8, 0.97));
    cardMeshes.forEach((mesh, i) => {
      const fan = seg(p, 0.46 + i * 0.025, 0.72 + i * 0.025);
      const flip = seg(p, 0.56 + i * 0.035, 0.78 + i * 0.035);
      const th = (i - (n - 1) / 2) * spread;
      const sx = (i - (n - 1) / 2) * 0.02;
      const sy = lerp(-1.1, 0.7, rise) + i * 0.012;
      const tx = R * Math.sin(th);
      const ty = 0.1 + R * Math.cos(th) - R + (compact ? 0.2 : 0.35);
      mesh.position.set(
        lerp(sx, tx, fan),
        lerp(sy, ty, fan),
        lerp(-0.06 - (n - i) * 0.012, i * 0.03, fan),
      );
      mesh.rotation.set(0, Math.PI * (1 - flip), lerp(0, -th, fan));
      mesh.visible = p > 0.22;
      const uniforms = (mesh.material as Three.ShaderMaterial).uniforms;
      uniforms.uSweep!.value = sweep;
      uniforms.uTime!.value = time;
    });
    bodyMat.uniforms.uTime!.value = time;
    stripMat.uniforms.uTime!.value = time;
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) start();
      else stop();
    },
    { rootMargin: '100px' },
  );
  io.observe(container);
  cleanups.push(() => io.disconnect());
  const onVisibility = () => (document.hidden ? stop() : visible && start());
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const t0 = performance.now();
  function frame(now: number) {
    raf = 0;
    pose(progress, (now - t0) / 1000);
    renderer?.render(scene, camera);
    if (!ready) {
      ready = true;
      canvas.style.opacity = '1';
      onReady();
    }
    start();
  }
  function start() {
    if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  start();

  function setProgress(p: number) {
    progress = clamp(p);
    start();
  }
  function setCompact(next: boolean) {
    compact = next;
    frameCamera();
    start();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    cleanups.forEach((cleanup) => cleanup());
    owned.forEach((o) => o.dispose());
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  }
  return handle;
}
