import { Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from "@react-three/postprocessing";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { color as tokens } from "../styles/tokens";
import { useQuality } from "./quality-context";
import type { Extent } from "./props";

// ─────────────────────────────────────────
// Section: Sky backdrop (screen-space gradient; keeps the dark app theme, adds a horizon haze)
// ─────────────────────────────────────────
//
// A sky dome does not work with an orthographic camera (the view rays hit the far side of the
// sphere, below the horizon), so the sky is a full-screen quad drawn at the far plane. Being at
// maximum depth it is ignored by the ambient occlusion pass and never occludes the diorama.

const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
varying vec2 vUv;
void main() {
  // Vertical gradient plus a soft glow low on the screen, as if light scattered behind the slab
  float t = smoothstep(0.0, 1.0, vUv.y);
  vec3 c = mix(uHorizon, uZenith, t);
  float d = distance(vUv, vec2(0.5, 0.28));
  c += uGlow * (1.0 - smoothstep(0.0, 0.75, d)) * 0.55;
  gl_FragColor = vec4(c, 1.0);
}
`;

export function SceneBackdrop() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Color(tokens.bg.app) },
          uHorizon: { value: new THREE.Color("#152536") },
          uGlow: { value: new THREE.Color("#1E3A46") },
        },
        vertexShader: BACKDROP_VERTEX,
        fragmentShader: BACKDROP_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useLayoutEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

// ─────────────────────────────────────────
// Section: Sun, sky fill and image-based light (all local: no HDR download)
// ─────────────────────────────────────────

// Sun direction (unit-less): high afternoon sun from the south-west, so rows cast readable shadows
const SUN_DIR = new THREE.Vector3(-0.55, 1, 0.42).normalize();

export function SceneLights({ extent }: { extent: Extent }) {
  const quality = useQuality();
  const sun = useRef<THREE.DirectionalLight>(null);
  const cx = (extent.minX + extent.maxX) / 2;
  const cz = (extent.minZ + extent.maxZ) / 2;
  // Shadow frustum fitted to the slab: a default 10-unit box would clip the farm
  const half = Math.max(extent.maxX - extent.minX, extent.maxZ - extent.minZ) / 2 + 1.5;

  useLayoutEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.position.set(cx + SUN_DIR.x * 30, SUN_DIR.y * 30, cz + SUN_DIR.z * 30);
    light.target.position.set(cx, 0, cz);
    // The target is not in the scene graph, so its matrix must be refreshed by hand
    light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 70;
    cam.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }, [cx, cz, half]);

  return (
    <>
      <hemisphereLight args={["#CFE0FF", "#3A2C1E", 0.55]} />
      <directionalLight
        ref={sun}
        castShadow={quality.shadows}
        intensity={2.6}
        color="#FFF1DC"
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        // PCF spreads its taps by this radius: the cheap way to soft shadows since r187 dropped PCFSoft
        shadow-radius={3}
      />
      {/* Cool rim from the opposite side keeps shadowed faces from going flat black */}
      <directionalLight position={[cx + 12, 8, cz - 14]} intensity={0.35} color="#9CC3FF" />
      <Environment resolution={64} frames={1} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={1.6} color="#DDEBFF" scale={[30, 30, 1]} position={[0, 12, 0]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={0.9} color="#FFE2B8" scale={[20, 6, 1]} position={[-10, 4, 6]} rotation-y={Math.PI / 2.5} />
        <Lightformer form="rect" intensity={0.35} color="#5E4A34" scale={[30, 30, 1]} position={[0, -6, 0]} rotation-x={-Math.PI / 2} />
      </Environment>
    </>
  );
}

// ─────────────────────────────────────────
// Section: Post-processing (subtle; disabled on low tier)
// ─────────────────────────────────────────

export function SceneEffects() {
  const q = useQuality();
  if (!q.ambientOcclusion && !q.bloom && !q.vignette) return null;
  return (
    <EffectComposer multisampling={q.ambientOcclusion ? 0 : q.multisampling} enableNormalPass={false}>
      {/* Contact AO grounds the plants and props; half resolution keeps it laptop friendly */}
      {q.ambientOcclusion && <N8AO aoRadius={0.35} distanceFalloff={0.6} intensity={2.2} quality="medium" halfRes />}
      {/* N8AO needs multisampling off, so SMAA restores clean edges */}
      {q.ambientOcclusion && <SMAA />}
      {q.bloom && <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />}
      {q.vignette && <Vignette offset={0.32} darkness={0.55} eskil={false} />}
    </EffectComposer>
  );
}
