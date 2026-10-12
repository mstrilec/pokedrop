import type * as Three from 'three';
import { token } from './tokens';

export type HeroCardOptions = {
  image: string;
  /** The element whose pointer movement tilts the card. */
  pointerTarget: HTMLElement;
  onReady: () => void;
  onFallback: (reason: string) => void;
};

export type HeroCardHandle = { dispose(): void };

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

const FRAG = `
precision highp float;
uniform sampler2D uMap;
uniform vec2 uTilt;
uniform float uTime;
uniform vec3 uEnergy;
varying vec2 vUv;
float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 p = (vUv - 0.5) * vec2(0.716, 1.0);
  float d = rbox(p, vec2(0.358, 0.5), 0.032);
  float a = 1.0 - smoothstep(-0.002, 0.002, d);
  if (a <= 0.0) discard;
  vec3 tex = texture2D(uMap, vUv).rgb;
  float lum = dot(tex, vec3(0.299, 0.587, 0.114));
  float h = vUv.x * 1.1 + vUv.y * 0.7 + uTilt.x * 1.4 - uTilt.y * 1.1 + uTime * 0.02;
  vec3 holo = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
  // Base Set art window sits roughly at x .09-.91, y .52-.90 (uv y up)
  float art = smoothstep(0.08, 0.11, vUv.x) * smoothstep(0.92, 0.89, vUv.x) * smoothstep(0.50, 0.53, vUv.y) * smoothstep(0.91, 0.88, vUv.y);
  vec3 col = tex + holo * (0.06 + 0.26 * art) * (0.35 + lum);
  vec2 g = vec2(0.5 + uTilt.x * 0.85, 0.5 - uTilt.y * 0.85);
  col += exp(-pow(length((vUv - g) * vec2(1.0, 0.72)) * 3.0, 2.0)) * 0.42;
  float s = vUv.x + vUv.y * 0.55 - (0.78 + uTilt.x * 0.9 + sin(uTime * 0.4) * 0.15);
  col += smoothstep(0.09, 0.0, abs(s)) * 0.16 * (0.5 + art);
  col += uEnergy * smoothstep(-0.02, 0.0, d) * 0.6;
  gl_FragColor = vec4(col, a);
}`;

/**
 * The hero's Charizard as a 3D holo card that tilts toward the pointer. Loads
 * three.js itself; the caller has already decided the device can take it.
 */
export async function init(container: HTMLElement, opts: HeroCardOptions): Promise<HeroCardHandle> {
  const { image, pointerTarget, onReady, onFallback } = opts;

  let disposed = false;
  let raf = 0;
  let renderer: Three.WebGLRenderer | null = null;
  let geometry: Three.PlaneGeometry | null = null;
  let material: Three.ShaderMaterial | null = null;
  let texture: Three.Texture | null = null;
  const cleanups: (() => void)[] = [];
  const handle: HeroCardHandle = { dispose };

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
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);

  texture = await new Promise<Three.Texture | null>((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(image, resolve, undefined, () => resolve(null));
  });
  if (disposed) return handle;
  if (!texture) {
    fail('texture-failed');
    return handle;
  }
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const W = 2.5;
  const H = 2.5 / 0.716;
  geometry = new THREE.PlaneGeometry(W, H, 1, 1);
  material = new THREE.ShaderMaterial({
    name: 'hero-holo',
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    uniforms: {
      uMap: { value: texture },
      uTilt: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uEnergy: { value: new THREE.Color(token('--e-fire')) },
    },
  });
  const card = new THREE.Mesh(geometry, material);
  scene.add(card);

  const resize = () => {
    if (!renderer) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, 0, Math.max((H * 1.3) / (2 * t), (W * 1.5) / (2 * t * camera.aspect)));
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  cleanups.push(() => ro.disconnect());

  const target = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  const move = (event: PointerEvent) => {
    const r = container.getBoundingClientRect();
    target.x = Math.max(-1, Math.min(1, ((event.clientX - r.left) / r.width) * 2 - 1));
    target.y = Math.max(-1, Math.min(1, ((event.clientY - r.top) / r.height) * 2 - 1));
  };
  const leave = () => {
    target.x = 0;
    target.y = 0;
  };
  pointerTarget.addEventListener('pointermove', move, { passive: true });
  pointerTarget.addEventListener('pointerleave', leave);
  cleanups.push(() => {
    pointerTarget.removeEventListener('pointermove', move);
    pointerTarget.removeEventListener('pointerleave', leave);
  });

  let visible = true;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    if (visible) start();
    else stop();
  });
  io.observe(container);
  cleanups.push(() => io.disconnect());
  const onVisibility = () => (document.hidden ? stop() : visible && start());
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const t0 = performance.now();
  let first = true;
  const uniforms = material.uniforms;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    tilt.x += (target.x - tilt.x) * 0.08;
    tilt.y += (target.y - tilt.y) * 0.08;
    card.rotation.y = tilt.x * 0.42;
    card.rotation.x = tilt.y * 0.32;
    card.position.y = Math.sin(t * 1.05) * 0.07;
    (uniforms.uTilt!.value as Three.Vector2).set(tilt.x, tilt.y);
    uniforms.uTime!.value = t;
    renderer?.render(scene, camera);
    if (first) {
      first = false;
      canvas.style.opacity = '1';
      onReady();
    }
  }
  function start() {
    if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  start();

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    cleanups.forEach((cleanup) => cleanup());
    geometry?.dispose();
    material?.dispose();
    texture?.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  }
  return handle;
}
