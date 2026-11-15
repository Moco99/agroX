// Detect WebGL once at mount: without it the S3 canvas falls back to the equivalent 2D map
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return gl !== null;
  } catch {
    return false;
  }
}
