import { Html, OrbitControls, Stars, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ComponentRef } from "react";
type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
import { es, fmt } from "../../i18n/es";
import { latLonToVector, parseIsoDate, subsolarPoint } from "../../lib/solar";
import { useStageStore } from "../../store/stage-store";
import { useTwinStore } from "../../store/twin-store";
import { color as tokens } from "../../styles/tokens";
import { ATMOSPHERE_FRAGMENT, ATMOSPHERE_VERTEX, EARTH_FRAGMENT, EARTH_VERTEX } from "./earth-shaders";

// ─────────────────────────────────────────
// Section: Realistic globe (stage 1) with camera flight towards the pilot farm
// ─────────────────────────────────────────

// Pilot farm centroid (Story County, Iowa); the marker and the flight target use it
export const PILOT_LAT = 42.028951;
export const PILOT_LON = -93.490654;
const EARTH_RADIUS_KM = 6371;
// Camera distances in Earth radii from the centre
const START_DISTANCE = 2.95;
const ARRIVE_DISTANCE = 1.14;
const LOCATE_DISTANCE = 1.7;
const FLIGHT_MS = 3800;
const TEXTURES = {
  day: "/textures/earth/earth-day-4k.jpg",
  night: "/textures/earth/earth-night-2k.jpg",
  clouds: "/textures/earth/earth-clouds-2k.jpg",
  normal: "/textures/earth/earth-normal-1k.jpg",
  specular: "/textures/earth/earth-specular-1k.jpg",
};

export interface GlobeSceneProps {
  // Monotonic counters: each change requests one step (positive = zoom in)
  zoomSignal: { n: number; dir: number };
  locateSignal: number;
  onDistance?: (km: number) => void;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function vec(v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

// Sun placed for the selected season date at 19:30 UTC so the Americas are lit on the first frame
function sunFor(iso: string | undefined): THREE.Vector3 {
  const date = parseIsoDate(iso ?? "2024-07-15", 19);
  date.setUTCMinutes(30);
  const p = subsolarPoint(date);
  return vec(latLonToVector(p.lat, p.lon)).normalize();
}

// ─────────────────────────────────────────
// Section: Earth, clouds, atmosphere
// ─────────────────────────────────────────

function Earth({ sunDir }: { sunDir: THREE.Vector3 }) {
  const textures = useTexture(TEXTURES);
  useMemo(() => {
    textures.day.colorSpace = THREE.SRGBColorSpace;
    textures.night.colorSpace = THREE.SRGBColorSpace;
    textures.day.anisotropy = 8;
    for (const t of Object.values(textures)) {
      t.wrapS = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
    }
  }, [textures]);
  const uniforms = useMemo(
    () => ({
      dayMap: { value: textures.day },
      nightMap: { value: textures.night },
      specMap: { value: textures.specular },
      normalMap: { value: textures.normal },
      sunDir: { value: sunDir.clone() },
      nightStrength: { value: 1.35 },
    }),
    [textures, sunDir],
  );
  const atmoUniforms = useMemo(
    () => ({ sunDir: { value: sunDir.clone() }, glowColor: { value: new THREE.Color("#5aa9ff") } }),
    [sunDir],
  );
  const clouds = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    // Clouds drift slightly faster than the ground so the planet reads as alive even when the camera rests
    if (clouds.current) clouds.current.rotation.y += dt * 0.004;
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[1, 128, 96]} />
        <shaderMaterial vertexShader={EARTH_VERTEX} fragmentShader={EARTH_FRAGMENT} uniforms={uniforms} />
      </mesh>
      <mesh ref={clouds} renderOrder={1}>
        <sphereGeometry args={[1.012, 96, 72]} />
        <meshLambertMaterial alphaMap={textures.clouds} color="#ffffff" transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh scale={1.075} renderOrder={2}>
        <sphereGeometry args={[1, 64, 48]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERTEX}
          fragmentShader={ATMOSPHERE_FRAGMENT}
          uniforms={atmoUniforms}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// Graticule every 15° — the "Límites" layer of the globe stage
function Graticule() {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    const push = (lat: number, lon: number) => pts.push(...latLonToVector(lat, lon, 1.004));
    for (let lat = -75; lat <= 75; lat += 15) {
      for (let lon = -180; lon < 180; lon += 3) {
        push(lat, lon);
        push(lat, lon + 3);
      }
    }
    for (let lon = -180; lon < 180; lon += 15) {
      for (let lat = -90; lat < 90; lat += 3) {
        push(lat, lon);
        push(lat + 3, lon);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={tokens.accent.bright} transparent opacity={0.16} depthWrite={false} />
    </lineSegments>
  );
}

// ─────────────────────────────────────────
// Section: Pilot marker (pulsing halo + label with the active layer values)
// ─────────────────────────────────────────

function Marker({ portal }: { portal: React.RefObject<HTMLElement> }) {
  const mapLayers = useTwinStore((s) => s.mapLayers);
  const region = useTwinStore((s) => s.region);
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const position = useMemo(() => vec(latLonToVector(PILOT_LAT, PILOT_LON, 1.003)), []);
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    return q;
  }, [position]);
  // Marker colour follows the layer that is "on": precipitation (blue), temperature (orange), else NDVI green
  const markerColor = mapLayers.precipitation ? "#5AA9E6" : mapLayers.temperature ? "#F19728" : tokens.accent.bright;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = (t * 0.6) % 1;
    if (ring.current) {
      ring.current.scale.setScalar(1 + pulse * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.7;
    }
    if (ring2.current) {
      const p2 = (pulse + 0.5) % 1;
      ring2.current.scale.setScalar(1 + p2 * 2.2);
      (ring2.current.material as THREE.MeshBasicMaterial).opacity = (1 - p2) * 0.5;
    }
  });
  const chips: string[] = [];
  if (region) {
    if (mapLayers.ndvi && region.ndvi.value !== null) chips.push(`NDVI ${fmt(region.ndvi.value, 2)}`);
    if (mapLayers.precipitation && region.precipitation.value !== null) chips.push(`${fmt(region.precipitation.value, 0)} mm`);
    if (mapLayers.temperature && region.temperature.value !== null) chips.push(`${fmt(region.temperature.value, 1)} °C`);
  }
  return (
    <group position={position} quaternion={quaternion}>
      <mesh ref={ring}>
        <ringGeometry args={[0.012, 0.016, 48]} />
        <meshBasicMaterial color={markerColor} transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2}>
        <ringGeometry args={[0.012, 0.016, 48]} />
        <meshBasicMaterial color={markerColor} transparent opacity={0.4} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.008, 32]} />
        <meshBasicMaterial color={markerColor} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <circleGeometry args={[0.02, 32]} />
        <meshBasicMaterial color={markerColor} transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <Html position={[0, 0.03, 0]} center zIndexRange={[20, 0]} portal={portal} occlude={false}>
        <div className="globe-label">
          <strong>{es.globe.marker}</strong>
          {chips.length > 0 && <span>{chips.join(" · ")}</span>}
        </div>
      </Html>
    </group>
  );
}

// ─────────────────────────────────────────
// Section: Camera flight / idle rotation / zoom commands
// ─────────────────────────────────────────

interface Flight {
  fromDir: THREE.Vector3;
  toDir: THREE.Vector3;
  fromDist: number;
  toDist: number;
  start: number;
  ms: number;
  // Only the stage flight notifies the store; manual "locate" flights do not
  notify: boolean;
}

function CameraRig({ zoomSignal, locateSignal, onDistance, controls }: GlobeSceneProps & { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera);
  const phase = useStageStore((s) => s.phase);
  const autopilot = useStageStore((s) => s.autopilot);
  const arrived = useStageStore((s) => s.arrived);
  const flight = useRef<Flight | null>(null);
  const targetDist = useRef<number | null>(null);
  const lastReport = useRef(0);
  const pilotDir = useMemo(() => vec(latLonToVector(PILOT_LAT, PILOT_LON)).normalize(), []);

  const startFlight = (toDir: THREE.Vector3, toDist: number, ms: number, notify: boolean) => {
    flight.current = {
      fromDir: camera.position.clone().normalize(),
      toDir,
      fromDist: camera.position.length(),
      toDist,
      start: performance.now(),
      ms,
      notify,
    };
  };

  // Stage transition: the store flips to "flying" and the rig takes the camera down to Iowa
  useEffect(() => {
    if (phase === "flying") startFlight(pilotDir, ARRIVE_DISTANCE, FLIGHT_MS, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (zoomSignal.n === 0) return;
    const d = targetDist.current ?? camera.position.length();
    targetDist.current = THREE.MathUtils.clamp(d * (zoomSignal.dir > 0 ? 0.78 : 1.28), 1.12, 4.5);
  }, [zoomSignal, camera]);

  useEffect(() => {
    if (locateSignal === 0) return;
    startFlight(pilotDir, LOCATE_DISTANCE, 1600, false);
  }, [locateSignal, pilotDir]);

  useFrame((_, dt) => {
    const f = flight.current;
    if (f) {
      const t = Math.min(1, (performance.now() - f.start) / f.ms);
      const e = easeInOutCubic(t);
      // Slerp the direction on the sphere and ease the distance separately: the camera "arcs" down
      const q = new THREE.Quaternion().setFromUnitVectors(f.fromDir, f.toDir);
      const dir = f.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(q, e)).normalize();
      // Distance follows an ease-in curve so most of the descent happens over the target
      const distE = t * t * (3 - 2 * t);
      const dist = THREE.MathUtils.lerp(f.fromDist, f.toDist, Math.pow(distE, 1.35));
      camera.position.copy(dir.multiplyScalar(dist));
      camera.lookAt(0, 0, 0);
      targetDist.current = null;
      if (t >= 1) {
        flight.current = null;
        if (f.notify) arrived();
      }
    } else {
      if (targetDist.current !== null) {
        const cur = camera.position.length();
        const next = THREE.MathUtils.damp(cur, targetDist.current, 6, dt);
        camera.position.setLength(next);
        if (Math.abs(next - targetDist.current) < 0.002) targetDist.current = null;
      }
      // Idle autopilot: a slow westward drift, cancelled as soon as the user grabs the globe
      if (autopilot && phase === "idle") {
        camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.035);
        camera.lookAt(0, 0, 0);
      }
    }
    controls.current?.update();
    const now = performance.now();
    if (onDistance && now - lastReport.current > 250) {
      lastReport.current = now;
      onDistance((camera.position.length() - 1) * EARTH_RADIUS_KM);
    }
  });
  return null;
}

// ─────────────────────────────────────────
// Section: Scene root
// ─────────────────────────────────────────

export default function GlobeScene(props: GlobeSceneProps) {
  const date = useTwinStore((s) => s.baseline?.zones[0]?.states[s.dayIndex]?.date);
  const boundaries = useTwinStore((s) => s.mapLayers.boundaries);
  const phase = useStageStore((s) => s.phase);
  const cancelAutopilot = useStageStore((s) => s.cancelAutopilot);
  const quality = useStageStore((s) => s.quality);
  const sunDir = useMemo(() => sunFor(date), [date]);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const labelsRef = useRef<HTMLDivElement>(null!);
  const start = useMemo(() => vec(latLonToVector(22, -78)).normalize().multiplyScalar(START_DISTANCE), []);

  return (
    <div className="globe-root" onPointerDown={cancelAutopilot}>
      <div ref={labelsRef} className="diorama-labels" />
      <Canvas
        dpr={quality === "high" ? [1, 2] : 1}
        camera={{ position: [start.x, start.y, start.z], fov: 38, near: 0.01, far: 100 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, powerPreference: "high-performance" }}
        style={{ background: "#02040a" }}
      >
        <color attach="background" args={["#02040a"]} />
        <Stars radius={60} depth={30} count={quality === "high" ? 6000 : 2500} factor={3} saturation={0.1} fade speed={0.2} />
        <ambientLight intensity={0.06} />
        <directionalLight position={sunDir.clone().multiplyScalar(10).toArray()} intensity={2.4} color="#fff4e0" />
        <Earth sunDir={sunDir} />
        {boundaries && <Graticule />}
        <Marker portal={labelsRef} />
        <CameraRig {...props} controls={controls} />
        <OrbitControls
          ref={controls}
          makeDefault
          enabled={phase !== "flying"}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.45}
          zoomSpeed={0.6}
          minDistance={1.12}
          maxDistance={4.5}
          onStart={cancelAutopilot}
        />
      </Canvas>
    </div>
  );
}
