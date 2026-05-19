import { useEffect, useRef, useState } from "react";
import { useGenerationStore } from "../../stores/generationStore";
import type { CameraConfig } from "../../types";

// ---------------------------------------------------------------------------
// CDN loader — Three.js r128 (loaded once per page)
// ---------------------------------------------------------------------------
let threeStatus: "idle" | "loading" | "ready" = "idle";
const threeQueue: Array<() => void> = [];

function ensureThree(cb: () => void): void {
  if (threeStatus === "ready") { cb(); return; }
  threeQueue.push(cb);
  if (threeStatus === "loading") return;
  threeStatus = "loading";
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  s.onload = () => {
    threeStatus = "ready";
    threeQueue.forEach((fn) => fn());
    threeQueue.length = 0;
  };
  s.onerror = () => { threeStatus = "idle"; threeQueue.length = 0; };
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Snap constants — co 15° dla rotacji, co 5 dla forward, co 0.2 dla tilt
// ---------------------------------------------------------------------------
const ROTATE_STEPS = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90] as const;
const FORWARD_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const TILT_STEPS = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1] as const;

function snapNearest(val: number, steps: readonly number[]): number {
  return steps.reduce((a, b) => (Math.abs(b - val) < Math.abs(a - val) ? b : a));
}

function snapRotation(deg: number): number {
  const clamped = Math.max(-90, Math.min(90, deg));
  return snapNearest(clamped, ROTATE_STEPS);
}

// Live overlay text (continuous values during drag) — synchronizowane z buildCameraPrompt.
function liveText(rot: number, fwd: number, tilt: number): string {
  const parts: string[] = [];

  // Rotacja — granularne opisy co 15°
  const absR = Math.abs(rot);
  if (absR >= 0.5) {
    const dir = rot > 0 ? "lewo" : "prawo";
    let mag = "";
    if (absR <= 20) mag = "lekko w";
    else if (absR <= 40) mag = "umiarkowanie w";
    else if (absR <= 60) mag = "mocno w";
    else if (absR <= 80) mag = "bardzo mocno w";
    else mag = "skrajnie w";
    parts.push(`${mag} ${dir} ${Math.round(absR)}°`);
  }

  // Forward — granularne opisy
  if (fwd >= 9) parts.push("bardzo bliskie zbliżenie");
  else if (fwd >= 7) parts.push("zbliżenie");
  else if (fwd >= 5) parts.push("ujęcie z bliska");
  else if (fwd >= 3) parts.push("średnia odległość");
  else if (fwd >= 1) parts.push("z większej odległości");
  else parts.push("z daleka, ujęcie uliczne");

  // Tilt — granularne opisy
  if (tilt <= -0.7) parts.push("widok ptasi (mocno z góry)");
  else if (tilt <= -0.3) parts.push("widok lekko z góry");
  else if (tilt >= 0.7) parts.push("widok żabi (mocno z dołu)");
  else if (tilt >= 0.3) parts.push("widok lekko z dołu");

  return parts.join(" • ") || "widok frontalny";
}

// ---------------------------------------------------------------------------
// Three.js scene initialisation (runs after CDN load)
// ---------------------------------------------------------------------------
function initThreeScene(
  container: HTMLDivElement,
  initial: CameraConfig,
  onSnap: (cam: CameraConfig) => void
): { cleanup: () => void; sync: (cam: CameraConfig) => void } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const THREE: any = (window as any).THREE;

  const w = container.clientWidth || 400;
  const h = container.clientHeight || 320;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  const cam3d = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
  cam3d.position.set(4, 3, 4);
  cam3d.lookAt(0, 0.75, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Prompt overlay
  const promptEl = document.createElement("div");
  promptEl.style.cssText =
    "position:absolute;bottom:10px;left:50%;transform:translateX(-50%);" +
    "background:rgba(0,0,0,0.82);padding:5px 14px;border-radius:6px;" +
    "font-family:monospace;font-size:11px;color:#4CAF50;white-space:nowrap;" +
    "z-index:10;pointer-events:none;max-width:90%;overflow:hidden;text-overflow:ellipsis;";
  container.appendChild(promptEl);

  // Legend overlay
  const legendEl = document.createElement("div");
  legendEl.style.cssText =
    "position:absolute;top:10px;left:10px;background:rgba(0,0,0,0.7);" +
    "padding:7px 11px;border-radius:8px;font-family:system-ui;font-size:11px;" +
    "color:#fff;z-index:10;line-height:1.8;pointer-events:none;";
  legendEl.innerHTML =
    '<span style="color:#4CAF50">●</span> Rotacja (←→)<br>' +
    '<span style="color:#E91E8C">●</span> Pochylenie (↑↓)<br>' +
    '<span style="color:#FF6B00">●</span> Odległość';
  container.appendChild(legendEl);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);
  scene.add(new THREE.GridHelper(6, 12, 0x333333, 0x222222));

  // Scene geometry constants
  const CENTER = new THREE.Vector3(0, 0.75, 0);
  const BASE_DIST = 2.0;
  const ROT_R = 2.2;
  const TILT_R = 1.6;

  // Live drag state (snapped to store only on release)
  let rotDeg: number = initial.rotateDeg;
  let fwd: number    = initial.moveForward;
  let tilt: number   = initial.verticalTilt;

  // Sign placeholder
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.0),
    new THREE.MeshBasicMaterial({ color: 0x3a4a5a, side: THREE.DoubleSide })
  );
  signMesh.position.copy(CENTER);
  scene.add(signMesh);

  // Camera model: box body + cylinder lens (no CapsuleGeometry — r128 only)
  const camGroup = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6699cc, metalness: 0.5, roughness: 0.3 });
  camGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.35), bodyMat));
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.16, 16),
    new THREE.MeshStandardMaterial({ color: 0x6699cc, metalness: 0.5, roughness: 0.3 })
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.24;
  camGroup.add(lens);
  scene.add(camGroup);

  // Rotation arc + handle — green #4CAF50
  const rotArcPts: any[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = THREE.MathUtils.degToRad(-90 + (180 * i) / 32);
    rotArcPts.push(new THREE.Vector3(ROT_R * Math.sin(a), 0.05, ROT_R * Math.cos(a)));
  }
  scene.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rotArcPts), 32, 0.035, 8, false),
      new THREE.MeshStandardMaterial({ color: 0x4caf50, emissive: 0x4caf50, emissiveIntensity: 0.3 })
    )
  );
  const rotHandle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x4caf50, emissive: 0x4caf50, emissiveIntensity: 0.5 })
  );
  rotHandle.userData.type = "rotation";
  scene.add(rotHandle);

  // Tilt arc + handle — pink #E91E8C
  const tiltArcPts: any[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = THREE.MathUtils.degToRad(-45 + (90 * i) / 32);
    tiltArcPts.push(new THREE.Vector3(-0.7, TILT_R * Math.sin(a) + CENTER.y, TILT_R * Math.cos(a)));
  }
  scene.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tiltArcPts), 32, 0.035, 8, false),
      new THREE.MeshStandardMaterial({ color: 0xe91e8c, emissive: 0xe91e8c, emissiveIntensity: 0.3 })
    )
  );
  const tiltHandle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xe91e8c, emissive: 0xe91e8c, emissiveIntensity: 0.5 })
  );
  tiltHandle.userData.type = "tilt";
  scene.add(tiltHandle);

  // Distance line + handle — orange #FF6B00
  const distGeo = new THREE.BufferGeometry();
  scene.add(new THREE.Line(distGeo, new THREE.LineBasicMaterial({ color: 0xff6b00 })));
  const distHandle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xff6b00, emissive: 0xff6b00, emissiveIntensity: 0.5 })
  );
  distHandle.userData.type = "distance";
  scene.add(distHandle);

  const handles = [rotHandle, tiltHandle, distHandle];

  // Update all 3D positions from current rotDeg/fwd/tilt values
  function updatePositions() {
    const rotRad  = THREE.MathUtils.degToRad(-rotDeg);
    const dist    = BASE_DIST - (fwd / 10) * 1.0;
    const tiltAng = -tilt * 35;
    const tiltRad = THREE.MathUtils.degToRad(tiltAng);

    const cx = dist * Math.sin(rotRad) * Math.cos(tiltRad);
    const cy = dist * Math.sin(tiltRad) + CENTER.y;
    const cz = dist * Math.cos(rotRad) * Math.cos(tiltRad);

    camGroup.position.set(cx, cy, cz);
    camGroup.lookAt(CENTER);

    rotHandle.position.set(ROT_R * Math.sin(rotRad), 0.05, ROT_R * Math.cos(rotRad));

    const thr = THREE.MathUtils.degToRad(tiltAng);
    tiltHandle.position.set(-0.7, TILT_R * Math.sin(thr) + CENTER.y, TILT_R * Math.cos(thr));

    const hd = dist - 0.4;
    distHandle.position.set(
      hd * Math.sin(rotRad) * Math.cos(tiltRad),
      hd * Math.sin(tiltRad) + CENTER.y,
      hd * Math.cos(rotRad) * Math.cos(tiltRad)
    );
    distGeo.setFromPoints([camGroup.position.clone(), CENTER.clone()]);
    promptEl.textContent = liveText(rotDeg, fwd, tilt);
  }

  // ---------------------------------------------------------------------------
  // Drag / pointer handling
  // ---------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const intersection = new THREE.Vector3();
  let dragging = false;
  let dragTarget: any = null;
  const dragStart = new THREE.Vector2();
  let dragStartFwd = 0;
  const canvas = renderer.domElement;

  function ndc(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * 2 - 1,
      y: -((clientY - r.top) / r.height) * 2 + 1,
    };
  }

  function pointerDown(clientX: number, clientY: number) {
    const { x, y } = ndc(clientX, clientY);
    mouse.set(x, y);
    raycaster.setFromCamera(mouse, cam3d);
    const hits = raycaster.intersectObjects(handles);
    if (!hits.length) return;
    dragging = true;
    dragTarget = hits[0].object;
    dragTarget.material.emissiveIntensity = 1.0;
    dragTarget.scale.setScalar(1.3);
    dragStart.set(x, y);
    dragStartFwd = fwd;
    canvas.style.cursor = "grabbing";
  }

  function pointerMove(clientX: number, clientY: number) {
    const { x, y } = ndc(clientX, clientY);
    mouse.set(x, y);

    if (dragging && dragTarget) {
      raycaster.setFromCamera(mouse, cam3d);
      const type = dragTarget.userData.type;

      if (type === "rotation") {
        const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
        if (raycaster.ray.intersectPlane(pl, intersection)) {
          const ang = THREE.MathUtils.radToDeg(Math.atan2(intersection.x, intersection.z));
          rotDeg = THREE.MathUtils.clamp(-ang, -90, 90);
        }
      } else if (type === "tilt") {
        const pl = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0.7);
        if (raycaster.ray.intersectPlane(pl, intersection)) {
          const ang = THREE.MathUtils.radToDeg(Math.atan2(intersection.y - CENTER.y, intersection.z));
          tilt = THREE.MathUtils.clamp(-ang / 35, -1, 1);
        }
      } else if (type === "distance") {
        fwd = THREE.MathUtils.clamp(dragStartFwd + (y - dragStart.y) * 12, 0, 10);
      }
      updatePositions();
    } else {
      raycaster.setFromCamera(mouse, cam3d);
      const hits = raycaster.intersectObjects(handles);
      handles.forEach((h) => { h.material.emissiveIntensity = 0.5; h.scale.setScalar(1); });
      if (hits.length) {
        hits[0].object.material.emissiveIntensity = 0.8;
        hits[0].object.scale.setScalar(1.1);
        canvas.style.cursor = "grab";
      } else {
        canvas.style.cursor = "default";
      }
    }
  }

  function pointerUp() {
    if (!dragTarget) return;
    const released = dragTarget;
    released.material.emissiveIntensity = 0.5;
    released.scale.setScalar(1);
    dragging = false;
    dragTarget = null;
    canvas.style.cursor = "default";

    // Snap to nearest step with cubic-out easing, 200ms
    const tRot  = snapRotation(rotDeg);
    const tFwd  = snapNearest(fwd, FORWARD_STEPS);
    const tTilt = snapNearest(tilt, TILT_STEPS);

    const sR = rotDeg, sF = fwd, sT = tilt;
    const t0 = Date.now();

    function anim() {
      const t = Math.min((Date.now() - t0) / 200, 1);
      const e = 1 - Math.pow(1 - t, 3); // cubic-out
      rotDeg = sR + (tRot - sR) * e;
      fwd    = sF + (tFwd - sF) * e;
      tilt   = sT + (tTilt - sT) * e;
      updatePositions();
      if (t < 1) {
        requestAnimationFrame(anim);
      } else {
        rotDeg = tRot; fwd = tFwd; tilt = tTilt;
        updatePositions();
        onSnap({ rotateDeg: tRot, moveForward: tFwd, verticalTilt: tTilt });
      }
    }
    anim();
  }

  const onMD = (e: MouseEvent)  => pointerDown(e.clientX, e.clientY);
  const onMM = (e: MouseEvent)  => pointerMove(e.clientX, e.clientY);
  const onTS = (e: TouchEvent)  => { e.preventDefault(); const t = e.touches[0]; pointerDown(t.clientX, t.clientY); };
  const onTM = (e: TouchEvent)  => { e.preventDefault(); const t = e.touches[0]; pointerMove(t.clientX, t.clientY); };
  const onTE = (e: TouchEvent)  => { e.preventDefault(); pointerUp(); };

  canvas.addEventListener("mousedown",  onMD);
  canvas.addEventListener("mousemove",  onMM);
  canvas.addEventListener("mouseup",    pointerUp);
  canvas.addEventListener("mouseleave", pointerUp);
  canvas.addEventListener("touchstart",  onTS, { passive: false });
  canvas.addEventListener("touchmove",   onTM, { passive: false });
  canvas.addEventListener("touchend",    onTE, { passive: false });
  canvas.addEventListener("touchcancel", onTE, { passive: false });

  updatePositions();

  // Render loop
  let alive = true;
  function renderLoop() {
    if (!alive) return;
    requestAnimationFrame(renderLoop);
    renderer.render(scene, cam3d);
  }
  renderLoop();

  // Resize observer
  const ro = new ResizeObserver(() => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;
    cam3d.aspect = cw / ch;
    cam3d.updateProjectionMatrix();
    renderer.setSize(cw, ch);
  });
  ro.observe(container);

  // External sync (from sliders tab or store changes)
  function sync(config: CameraConfig) {
    rotDeg = config.rotateDeg;
    fwd    = config.moveForward;
    tilt   = config.verticalTilt;
    updatePositions();
  }

  function cleanup() {
    alive = false;
    ro.disconnect();
    canvas.removeEventListener("mousedown",  onMD);
    canvas.removeEventListener("mousemove",  onMM);
    canvas.removeEventListener("mouseup",    pointerUp);
    canvas.removeEventListener("mouseleave", pointerUp);
    canvas.removeEventListener("touchstart",  onTS);
    canvas.removeEventListener("touchmove",   onTM);
    canvas.removeEventListener("touchend",    onTE);
    canvas.removeEventListener("touchcancel", onTE);
    renderer.dispose();
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  return { cleanup, sync };
}

// ---------------------------------------------------------------------------
// Sliders fallback tab
// ---------------------------------------------------------------------------
interface SlidersTabProps {
  camera: CameraConfig;
  onChange: (cam: CameraConfig) => void;
}

function SlidersTab({ camera, onChange }: SlidersTabProps) {
  const tiltIdx = TILT_STEPS.indexOf(snapNearest(camera.verticalTilt, TILT_STEPS as unknown as readonly number[]) as (typeof TILT_STEPS)[number]);

  const rotLabel  = camera.rotateDeg > 0 ? `+${camera.rotateDeg}°` : `${camera.rotateDeg}°`;
  const fwdLabel  = `${camera.moveForward}/10`;
  const tiltVal   = Math.round(camera.verticalTilt * 10) / 10;
  const tiltLabel = tiltVal < -0.1 ? `ptasi ${Math.round(Math.abs(tiltVal) * 100)}%` : tiltVal > 0.1 ? `żabi ${Math.round(tiltVal * 100)}%` : "poziomo";

  return (
    <div className="p-4 space-y-6">
      {/* Rotacja — krok 15° */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Rotacja</span>
          <span className="text-gray-300 font-mono">{rotLabel}</span>
        </div>
        <input
          type="range" min={-90} max={90} step={15} value={camera.rotateDeg}
          onChange={(e) => onChange({ ...camera, rotateDeg: +e.target.value })}
          className="w-full cursor-pointer accent-green-500"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>−90°</span><span>−45°</span><span>0°</span><span>+45°</span><span>+90°</span>
        </div>
      </div>

      {/* Odległość — 11 kroków (0..10) */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Odległość</span>
          <span className="text-gray-300 font-mono">{fwdLabel}</span>
        </div>
        <input
          type="range" min={0} max={10} step={1} value={camera.moveForward}
          onChange={(e) => onChange({ ...camera, moveForward: +e.target.value })}
          className="w-full cursor-pointer accent-orange-500"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>Daleko</span><span>Średnio</span><span>Blisko</span>
        </div>
      </div>

      {/* Pochylenie — 11 pozycji (−1..1 co 0.2) */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Pochylenie</span>
          <span className="text-gray-300 font-mono">{tiltLabel}</span>
        </div>
        <input
          type="range" min={0} max={10} step={1} value={tiltIdx >= 0 ? tiltIdx : 5}
          onChange={(e) => onChange({ ...camera, verticalTilt: TILT_STEPS[+e.target.value] })}
          className="w-full cursor-pointer accent-pink-500"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>Ptasi</span><span>Poziomo</span><span>Żabi</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — accepts optional controlled mode via value/onChange
// ---------------------------------------------------------------------------
interface CameraWidgetProps {
  value?: CameraConfig;
  onChange?: (cam: CameraConfig) => void;
}

export function CameraWidget({ value, onChange }: CameraWidgetProps = {}) {
  const { camera: storeCamera, setCamera: storeSetCamera } = useGenerationStore();
  const camera = value !== undefined ? value : storeCamera;
  const setCamera = onChange !== undefined ? onChange : storeSetCamera;
  const [tab, setTab] = useState<"3d" | "suwaki">("3d");

  const containerRef = useRef<HTMLDivElement>(null);
  const syncRef      = useRef<((cam: CameraConfig) => void) | null>(null);
  // Keep latest camera in a ref so the async CDN callback always reads current value
  const cameraRef    = useRef(camera);
  useEffect(() => { cameraRef.current = camera; }, [camera]);

  // Initialize Three.js scene once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cleanupFn: (() => void) | null = null;
    let cancelled = false;

    ensureThree(() => {
      if (cancelled) return;
      const { cleanup, sync } = initThreeScene(container, cameraRef.current, setCamera);
      cleanupFn  = cleanup;
      syncRef.current = sync;
    });

    return () => {
      cancelled = true;
      cleanupFn?.();
      syncRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync store → scene on every camera change (e.g. slider tab changes)
  useEffect(() => {
    syncRef.current?.(camera);
  }, [camera]);

  return (
    <section className="bg-[#1a1a1a] rounded-lg overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-800 h-10">
        {(["3d", "suwaki"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 h-full text-xs font-medium transition-colors border-b-2 ${
              tab === t
                ? "text-white border-blue-500"
                : "text-gray-400 border-transparent hover:text-gray-200"
            }`}
          >
            {t === "3d" ? "Widok 3D" : "Suwaki"}
          </button>
        ))}
        <span className="ml-auto pr-3 text-[10px] text-gray-400 uppercase tracking-widest">
          Kamera
        </span>
      </div>

      {/* Three.js container — always mounted so the scene persists; hidden via CSS when on Suwaki tab */}
      <div
        ref={containerRef}
        className="relative"
        style={{ height: 320, display: tab === "3d" ? "block" : "none" }}
      />

      {/* Sliders fallback */}
      {tab === "suwaki" && <SlidersTab camera={camera} onChange={setCamera} />}
    </section>
  );
}
