// ─────────────────────────────────────────
// Section: GLSL for the realistic globe (day/night blend, ocean specular, rim scattering, atmosphere)
// ─────────────────────────────────────────

export const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Textures are sRGB-decoded by three on sampling; the output goes through tone mapping + colour space
// includes so the globe matches the lighting pipeline of the built-in materials (clouds, marker).
export const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D specMap;
  uniform sampler2D normalMap;
  uniform vec3 sunDir;
  uniform float nightStrength;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Tangent frame of the sphere from the geographic normal (east = up × n)
    vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), n));
    vec3 b = cross(n, t);
    vec3 nm = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    vec3 np = normalize(t * nm.x * 0.6 + b * nm.y * 0.6 + n * 1.4);

    float ndl = dot(np, sunDir);
    float ndlGeo = dot(n, sunDir);
    float day = smoothstep(-0.10, 0.22, ndlGeo);
    float lit = max(ndl, 0.0);

    vec3 dayCol = texture2D(dayMap, vUv).rgb;
    vec3 nightCol = texture2D(nightMap, vUv).rgb;
    float ocean = texture2D(specMap, vUv).r;

    // Diffuse with a soft, warm terminator band
    vec3 twilight = vec3(1.0, 0.72, 0.45);
    float band = smoothstep(-0.18, 0.08, ndlGeo) * (1.0 - smoothstep(0.08, 0.4, ndlGeo));
    vec3 color = dayCol * (lit * 1.25 + 0.015) * mix(vec3(1.0), twilight, band * 0.55);

    // Night lights fade in as the terminator passes; kept subtle so the dark side stays dark
    color += nightCol * (1.0 - day) * nightStrength;

    // Sun glint on water only
    vec3 h = normalize(sunDir + viewDir);
    float glint = pow(max(dot(np, h), 0.0), 60.0) * ocean * day;
    color += vec3(1.0, 0.95, 0.85) * glint * 0.7;

    // Thin rim of in-scattered sky light, stronger on the lit side
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.2);
    color += vec3(0.32, 0.56, 1.0) * fres * (0.12 + 0.55 * day);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vNormalW;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Back-face halo: brightest at the limb, tinted towards the sun, additive over the star field
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 glowColor;
  varying vec3 vNormalV;
  varying vec3 vNormalW;
  void main() {
    float rim = pow(clamp(0.72 - dot(vNormalV, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
    float sun = 0.25 + 0.75 * smoothstep(-0.35, 0.35, dot(vNormalW, sunDir));
    gl_FragColor = vec4(glowColor * rim * sun * 1.35, rim * sun);
  }
`;
