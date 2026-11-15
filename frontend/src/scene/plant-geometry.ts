import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GrowthForm } from "../lib/crop-visuals";
import { seededRandom } from "../lib/geo";

// ─────────────────────────────────────────
// Section: Procedural low-poly plant archetypes (no assets; deterministic)
// ─────────────────────────────────────────
//
// Every vertex carries two extra attributes read by the plant shader (plant-material.ts):
// - aRepro: 1 for reproductive organs (tassel, ear, pods, heads, flowers), so the shader can grow them in by stage
// - aPartColor: the organ's own colour; vegetative parts use white, meaning "take the stage canopy colour"
// Heights are in scene units and deliberately exaggerated for legibility; they are not agronomic values.

const LEAF = new THREE.Color("#ffffff");

function part(geometry: THREE.BufferGeometry, repro: 0 | 1, color: THREE.Color = LEAF): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.deleteAttribute("uv");
  const n = g.attributes.position?.count ?? 0;
  g.setAttribute("aRepro", new THREE.Float32BufferAttribute(new Float32Array(n).fill(repro), 1));
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) colors.set([color.r, color.g, color.b], i * 3);
  g.setAttribute("aPartColor", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

// A strap leaf: a thin strip bent outward and drooping at the tip, attached at (0, y, 0)
function strapLeaf(length: number, width: number, y: number, yaw: number, lift: number, droop: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, length, 1, 4);
  // Plane spans Y; move its base to the origin then curve it outward along +X
  g.translate(0, length / 2, 0);
  const p = g.attributes.position;
  if (p) {
    for (let i = 0; i < p.count; i += 1) {
      const t = p.getY(i) / length;
      const out = Math.sin(lift) * t * length;
      const up = Math.cos(lift) * t * length - droop * t * t * length;
      // Taper the leaf towards the tip
      p.setXYZ(i, out, up, p.getX(i) * (1 - 0.8 * t));
    }
  }
  g.rotateY(yaw);
  g.translate(0, y, 0);
  g.computeVertexNormals();
  return g;
}

function cornLike(headColor: string, earColor: string | null): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const height = 0.55;
  parts.push(part(new THREE.CylinderGeometry(0.006, 0.011, height, 5).translate(0, height / 2, 0), 0));
  // Alternating, rising leaves as on a grass stalk
  for (let i = 0; i < 6; i += 1) {
    const y = 0.06 + i * 0.075;
    const len = 0.24 - i * 0.022;
    parts.push(part(strapLeaf(len, 0.035, y, i * Math.PI * 0.97 + 0.3, 0.75 + i * 0.05, 0.55), 0));
  }
  // Tassel / panicle on top
  const head = new THREE.Color(headColor);
  parts.push(part(new THREE.ConeGeometry(0.018, 0.09, 5).translate(0, height + 0.04, 0), 1, head));
  for (let i = 0; i < 3; i += 1) {
    const spike = new THREE.CylinderGeometry(0.003, 0.003, 0.06, 3).translate(0, 0.03, 0);
    spike.rotateZ(0.7);
    spike.rotateY((i * Math.PI * 2) / 3);
    spike.translate(0, height + 0.01, 0);
    parts.push(part(spike, 1, head));
  }
  if (earColor) {
    const ear = new THREE.CylinderGeometry(0.014, 0.01, 0.075, 6).translate(0, 0.037, 0);
    ear.rotateZ(-0.35);
    ear.translate(0.012, height * 0.45, 0);
    parts.push(part(ear, 1, new THREE.Color(earColor)));
  }
  return merge(parts);
}

function bush(podColor: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = seededRandom(11);
  // Trifoliate canopy approximated by a few faceted clumps
  const lobes: [number, number, number, number][] = [
    [0, 0.12, 0, 0.075],
    [0.05, 0.09, 0.03, 0.06],
    [-0.045, 0.085, -0.035, 0.06],
    [0.01, 0.07, -0.055, 0.05],
    [-0.03, 0.17, 0.02, 0.05],
  ];
  for (const [x, y, z, r] of lobes) {
    const lobe = new THREE.IcosahedronGeometry(r, 0);
    lobe.scale(1, 0.75, 1);
    lobe.rotateY(rand() * Math.PI);
    lobe.translate(x, y, z);
    parts.push(part(lobe, 0));
  }
  parts.push(part(new THREE.CylinderGeometry(0.006, 0.008, 0.1, 4).translate(0, 0.05, 0), 0));
  // Pods hang under the outer clumps
  const pod = new THREE.Color(podColor);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.CapsuleGeometry(0.008, 0.03, 2, 4);
    g.rotateZ(0.5);
    g.translate(Math.cos(a) * 0.07, 0.07 + (i % 2) * 0.03, Math.sin(a) * 0.07);
    parts.push(part(g, 1, pod));
  }
  return merge(parts);
}

function smallGrain(headColor: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = seededRandom(23);
  const head = new THREE.Color(headColor);
  // A tuft of tillers: narrow blades plus stems carrying spikes
  for (let i = 0; i < 7; i += 1) {
    parts.push(part(strapLeaf(0.12 + rand() * 0.04, 0.012, 0, (i / 7) * Math.PI * 2, 0.45 + rand() * 0.3, 0.4), 0));
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + rand();
    const tilt = 0.12 + rand() * 0.12;
    const h = 0.2 + rand() * 0.04;
    const stem = new THREE.CylinderGeometry(0.0025, 0.0035, h, 3).translate(0, h / 2, 0);
    stem.rotateZ(tilt);
    stem.rotateY(a);
    parts.push(part(stem, 0));
    const spike = new THREE.CylinderGeometry(0.008, 0.006, 0.05, 4).translate(0, h + 0.02, 0);
    spike.rotateZ(tilt);
    spike.rotateY(a);
    parts.push(part(spike, 1, head));
  }
  return merge(parts);
}

function sunflower(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const height = 0.5;
  parts.push(part(new THREE.CylinderGeometry(0.008, 0.012, height, 5).translate(0, height / 2, 0), 0));
  for (let i = 0; i < 5; i += 1) {
    const leaf = new THREE.CircleGeometry(0.05, 6);
    leaf.scale(1, 0.7, 1);
    leaf.rotateX(-Math.PI / 2 + 0.5);
    leaf.translate(0, 0, 0.05);
    leaf.rotateY(i * 2.4);
    leaf.translate(0, 0.08 + i * 0.075, 0);
    parts.push(part(leaf, 0));
  }
  // Head faces sideways and slightly down, as mature heads do
  const disc = new THREE.CylinderGeometry(0.045, 0.045, 0.014, 10);
  disc.rotateZ(Math.PI / 2 - 0.4);
  disc.translate(0.02, height + 0.02, 0);
  parts.push(part(disc, 1, new THREE.Color("#5A3B1C")));
  const petals = new THREE.TorusGeometry(0.05, 0.016, 3, 12);
  petals.rotateY(Math.PI / 2);
  petals.rotateZ(-0.4);
  petals.translate(0.024, height + 0.022, 0);
  parts.push(part(petals, 1, new THREE.Color("#F2C230")));
  return merge(parts);
}

function cover(flowerColor: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mat = new THREE.IcosahedronGeometry(0.08, 0);
  mat.scale(1.3, 0.45, 1.3);
  mat.translate(0, 0.03, 0);
  parts.push(part(mat, 0));
  const flower = new THREE.Color(flowerColor);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(part(new THREE.OctahedronGeometry(0.012, 0).translate(Math.cos(a) * 0.06, 0.07, Math.sin(a) * 0.06), 1, flower));
  }
  return merge(parts);
}

// Organ colours are visual choices for recognisability (tassel straw, pods tan, grain heads golden)
export function plantGeometry(form: GrowthForm, cropId: string): THREE.BufferGeometry {
  switch (form) {
    case "tall_grass":
      return cropId === "sorghum" ? cornLike("#8C3B22", null) : cornLike("#D8C27A", "#C9D68A");
    case "bush":
      return bush("#9C8A50");
    case "small_grain":
      return smallGrain("#D9BE62");
    case "sunflower":
      return sunflower();
    case "cover":
      return cover("#8E6BC9");
  }
}

// Canopy colours per archetype (white vertex colour parts are tinted with these in the shader)
export function canopyColors(form: GrowthForm): { leaf: string; senescent: string } {
  switch (form) {
    case "tall_grass":
      return { leaf: "#4E8A2F", senescent: "#C8AE6A" };
    case "bush":
      return { leaf: "#5F9E3A", senescent: "#B8923E" };
    case "small_grain":
      return { leaf: "#7FA845", senescent: "#D6BC6E" };
    case "sunflower":
      return { leaf: "#4C8833", senescent: "#8C7445" };
    case "cover":
      return { leaf: "#3F7D3A", senescent: "#8F8350" };
  }
}
