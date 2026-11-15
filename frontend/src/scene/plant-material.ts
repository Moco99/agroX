import * as THREE from "three";

// ─────────────────────────────────────────
// Section: Plant shader patch (growth, reproductive organs, senescence, layer tint, wind)
// ─────────────────────────────────────────
//
// Stage changes animate by easing a handful of uniforms instead of rewriting thousands of
// instance matrices every frame; the same vertex patch runs in the shadow depth pass so the
// shadows match the drawn plants.

export interface PlantUniforms {
  uGrowth: { value: number };
  uRepro: { value: number };
  uSenescence: { value: number };
  uTintMix: { value: number };
  uWind: { value: number };
  uTime: { value: number };
  uLeaf: { value: THREE.Color };
  uSenescent: { value: THREE.Color };
  uTint: { value: THREE.Color };
}

export function createPlantUniforms(): PlantUniforms {
  return {
    uGrowth: { value: 0 },
    uRepro: { value: 0 },
    uSenescence: { value: 0 },
    uTintMix: { value: 0.45 },
    uWind: { value: 0 },
    uTime: { value: 0 },
    uLeaf: { value: new THREE.Color("#4E8A2F") },
    uSenescent: { value: new THREE.Color("#C8AE6A") },
    uTint: { value: new THREE.Color("#ffffff") },
  };
}

const VERTEX_HEADER = /* glsl */ `
uniform float uGrowth;
uniform float uRepro;
uniform float uWind;
uniform float uTime;
attribute float aRepro;
attribute vec3 aPartColor;
varying float vRepro;
varying vec3 vPartColor;
`;

// Runs after <begin_vertex>: `transformed` is still in the plant's own space
const VERTEX_BODY = /* glsl */ `
vRepro = aRepro;
vPartColor = aPartColor;
float g = max(uGrowth, 0.0001);
// Young plants are shorter and narrower; organs fold into the stem axis until they appear
transformed.y *= g;
transformed.xz *= mix(0.55, 1.0, g) * mix(1.0, uRepro, aRepro);
#ifdef USE_INSTANCING
  float phase = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 2.3;
#else
  float phase = 0.0;
#endif
// Sway grows with height squared so bases stay planted
float sway = sin(uTime * 1.7 + phase) * uWind * transformed.y * transformed.y;
transformed.x += sway;
transformed.z += sway * 0.6;
`;

const FRAGMENT_HEADER = /* glsl */ `
uniform float uSenescence;
uniform float uTintMix;
uniform vec3 uLeaf;
uniform vec3 uSenescent;
uniform vec3 uTint;
varying float vRepro;
varying vec3 vPartColor;
`;

// Runs after <color_fragment>: diffuseColor carries the per-instance variation (instanceColor)
const FRAGMENT_BODY = /* glsl */ `
vec3 canopy = mix(uLeaf, uSenescent, uSenescence);
vec3 organ = mix(vPartColor, uSenescent * 0.85, uSenescence * 0.6);
vec3 natural = mix(canopy, organ, vRepro) * diffuseColor.rgb;
diffuseColor.rgb = mix(natural, uTint, uTintMix);
`;

function patchVertex(shader: { vertexShader: string }) {
  shader.vertexShader = VERTEX_HEADER + shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
}

export function createPlantMaterials(uniforms: PlantUniforms): { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.78, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchVertex(shader);
    shader.fragmentShader =
      FRAGMENT_HEADER + shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_BODY}`);
  };
  // Keep one compiled program per patch, not per material instance
  material.customProgramCacheKey = () => "agrox-plant-v1";

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // The depth shader has no colour varyings: declare them so the shared vertex body compiles
    patchVertex(shader);
  };
  depth.customProgramCacheKey = () => "agrox-plant-depth-v1";
  return { material, depth };
}
