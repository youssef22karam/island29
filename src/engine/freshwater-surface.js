import { SWAMP_SHADER } from "./swamp-water.js";

export const FRESHWATER_VERTEX = /* glsl */ `
attribute vec4 aWater;
attribute float aEdge, aRiver, aMask;
attribute vec2 aSwamp;
uniform sampler2D uWakeTexture;
uniform vec4 uWakeBox;
varying vec3 vP;
varying vec2 vFlow, vSwamp;
varying float vDepth, vSed, vLevel, vWake;
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.)).xyz;
  vLevel = p.y;
  vFlow = aWater.xy;
  vDepth = aWater.z;
  vSed = aWater.w;
  vSwamp = aSwamp;
  vec2 uv = (p.xz - uWakeBox.xy) / max(uWakeBox.z, .001);
  float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.) * uWakeBox.w;
  vec4 wake = texture2D(uWakeTexture, clamp(uv, .001, .999));
  vWake = wake.b * inside;
  p.y += wake.r * inside * smoothstep(.02, .4, aWater.z);
  vP = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;

export function freshwaterFragment(common) {
  return common + /* glsl */ `
uniform sampler2D uReflection, uRefraction, uWaterTex, uWakeTexture, uFreshBed;
uniform mat4 uReflectionMatrix, uRefractionMatrix;
uniform vec3 uFreshBounds;
uniform vec4 uWakeBox;
uniform vec2 uWind;
uniform float uReflectionActive, uReflectionLevel, uRefractionActive;
uniform float uFog, uWindAmt, uRain, uWakeCell, uPx;
varying vec3 vP;
varying vec2 vFlow, vSwamp;
varying float vDepth, vSed, vLevel, vWake;
${SWAMP_SHADER}

vec2 turn(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
vec4 waterNoise(vec2 p, vec2 velocity, float scale, float angle) {
  float phase = uTime * .12;
  float a = fract(phase), b = fract(phase + .5);
  float blend = 1. - abs(a * 2. - 1.);
  vec2 qa = turn(p - velocity * a * 8.333, angle) / scale;
  vec2 qb = turn(p - velocity * b * 8.333, angle) / scale + vec2(.37, .61);
  return mix(texture2D(uWaterTex, qb), texture2D(uWaterTex, qa), blend);
}
vec2 waterRings(vec2 p, float pixel) {
  vec2 grid = floor(p * .38), q = fract(p * .38) - .5;
  float seed = h12(grid);
  vec2 center = vec2(h12(grid + 3.), h12(grid + 7.)) * .48 - .24;
  vec2 delta = q - center;
  float radius = length(delta);
  float age = fract(uTime * (.16 + seed * .11) + seed * 17.);
  float wave = (radius - age * .48) * 65.;
  float pulse = sin(wave) * exp(-abs(wave) * .22) * pow(1. - age, 2.);
  return delta / max(radius, .001) * pulse * smoothstep(0., .08, age)
    * (1. - smoothstep(.03, .24, pixel)) * step(seed, .22 + uRain * .6);
}
float frameEdge(vec2 uv) {
  vec2 edge = smoothstep(vec2(.001), vec2(.025), uv)
    * (1. - smoothstep(vec2(.975), vec2(.999), uv));
  return edge.x * edge.y;
}

void main() {
  vec2 uv = (vP.xz - uFreshBounds.xy) / (uFreshBounds.z * 2.) + .5;
  float bed = texture2D(uFreshBed, vec2(uv.x * .5, uv.y)).r;
  float rawMask = texture2D(uFreshBed, vec2(uv.x * .5 + .5, uv.y)).r;
  float coverage = smoothstep(.28, .90, rawMask);
  float depth = max(vLevel - bed, 0.);
  if (coverage < .001 || depth < .0002) discard;
  vec3 eye = cameraPosition - vP;
  float distanceToEye = length(eye);
  vec3 V = eye / max(distanceToEye, .001);
  float speed = length(vFlow);
  float lake = clamp(vSwamp.y, 0., 1.);
  float swamp = smoothstep(.10, .72, vSwamp.x) * (1. - lake * .96);
  float river = smoothstep(.04, .34, speed) * (1. - lake * .85) * (1. - swamp * .8);
  float sediment = clamp(vSed * .5 + uRain * .36 + uStorm * .16, 0., 1.);
  float pixel = max(length(fwidth(vP.xz)), .0001);
  float detail = 1. - smoothstep(.10, 1.2, pixel);
  vec2 wind = normalize(uWind + vec2(.001));
  vec2 drift = vFlow * (.5 + river) + wind * mix(.13, .025, swamp);
  vec4 n0 = waterNoise(vP.xz, drift, 10.6, .48);
  vec4 n1 = waterNoise(vP.xz, drift * 1.37, 3.83, -1.14);
  vec4 n2 = waterNoise(vP.xz, drift * .72 - wind * .04, 1.29, 1.91);
  vec2 slope = turn((n0.rg * 2. - 1.) * 8. / 10.6, -.48) * .74
    + turn((n1.rg * 2. - 1.) * 8. / 3.83, 1.14) * .42 * detail
    + turn((n2.rg * 2. - 1.) * 8. / 1.29, -1.91) * .13 * detail;
  float gust = smoothstep(.32, .8, vn(vP.xz * .028 - wind * uTime * .025));
  slope *= mix(.70 + gust * .65 + river * .8, .66 + gust * .38, swamp) * (.6 + uWindAmt * .6);
  slope += wind * cos(dot(vP.xz, wind) * 1.6 - uTime * 1.1) * .005 * swamp * detail;
  slope += waterRings(vP.xz, pixel) * (.018 * swamp + .042 * uRain);
  slope *= smoothstep(.006, .18, depth);
  vec2 wakeUV = (vP.xz - uWakeBox.xy) / max(uWakeBox.z, .001);
  if (uWakeBox.w > .5 && vWake > .0001 && frameEdge(wakeUV) > .5) {
    float e = uWakeCell / max(uWakeBox.z, .001);
    float c = texture2D(uWakeTexture, wakeUV).r;
    slope += vec2(texture2D(uWakeTexture, wakeUV + vec2(e, 0.)).r - c,
      texture2D(uWakeTexture, wakeUV + vec2(0., e)).r - c) / max(uWakeCell, .01);
  }
  vec3 N = normalize(vec3(-slope.x, 1., -slope.y));
  float nv = clamp(dot(N, V), .025, 1.);
  float fresnel = .0204 + .9796 * pow(1. - nv, 5.);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 reflection = sky(R);
  if (uReflectionActive > .5) {
    vec4 q = uReflectionMatrix * vec4(vP.x, vLevel, vP.z, 1.);
    vec2 ruv = q.xy / max(q.w, .001) + N.xz * .013 / (1. + distanceToEye * .003);
    float valid = frameEdge(ruv) * step(0., q.w) * exp(-abs(vLevel - uReflectionLevel));
    vec2 texel = 1. / vec2(textureSize(uReflection, 0));
    vec3 reflected = texture2D(uReflection, clamp(ruv, .002, .998)).rgb * .5;
    reflected += texture2D(uReflection, clamp(ruv + texel * vec2(.65, .65), .002, .998)).rgb * .25;
    reflected += texture2D(uReflection, clamp(ruv - texel * vec2(.65, .65), .002, .998)).rgb * .25;
    reflection = mix(reflection, reflected, valid);
  }
  float light = max(uLight, .025) * (1. - uStorm * .32);
  vec3 lakeBody = mix(vec3(.075, .285, .295), vec3(.016, .085, .122), 1. - exp(-depth * .18));
  vec3 riverBody = mix(vec3(.095, .295, .245), vec3(.028, .135, .128), 1. - exp(-depth * .30));
  vec3 body = mix(mix(lakeBody, riverBody, river), swampBody(depth, sediment), swamp);
  vec3 extinction = mix(mix(vec3(.38, .17, .15), vec3(.52, .26, .27), river), swampExtinction(sediment), swamp);
  extinction *= 1. + uRain * .45;
  float path = min(depth, 32.) / max(nv, .32);
  vec3 transmission = exp(-extinction * path);
  float transmittance = dot(transmission, vec3(.25, .5, .25));
  vec3 inScatter = body * light * (1. - transmission);
  vec3 color = reflection * fresnel + inScatter * (1. - fresnel);

  // Frustum-based validity avoids the old screen-space refraction cutoff ring.
  float refraction = 0.;
  if (uRefractionActive > .5) {
    vec4 q = uRefractionMatrix * vec4(vP.x, vLevel, vP.z, 1.);
    vec2 baseUV = q.xy / max(q.w, .001);
    vec2 bend = N.xz * min(depth, 2.5) * .005 * smoothstep(.03, .4, depth);
    vec2 ruv = clamp(baseUV + bend, .001, .999);
    refraction = frameEdge(baseUV) * step(0., q.w);
    vec3 through = texture2D(uRefraction, ruv).rgb;
    color += through * transmission * (1. - fresnel) * refraction;
  }
  float alpha = 1. - transmittance * (1. - fresnel) * (1. - refraction);
  vec3 H = normalize(uSun + V);
  float sunVisibility = smoothstep(.01, .16, uSun.y) * (1. - uStorm * .83);
  float roughness = mix(.062, .038, swamp) + pixel * .018 + uRain * .06;
  float exponent = 2. / max(roughness * roughness, .001);
  float spec = pow(max(dot(N, H), 0.), exponent) * min(exponent * .0008, 1.8);
  float sheen = pow(max(dot(N, H), 0.), 85.) * .065;
  color += uSunCol * (spec + sheen) * sunVisibility;
  float nearBed = (1. - smoothstep(.3, 3.5, depth)) * (1. - swamp * .8) * detail;
  float caustic = pow(1. - abs(n1.b * 2. - 1.), 8.) * pow(1. - abs(n2.b * 2. - 1.), 3.);
  color += vec3(.11, .15, .09) * caustic * nearBed * sunVisibility * (1. - fresnel);

  // Sparse bank-biased duckweed leaves with open channels, not a luminous blanket.
  if (swamp > .1) {
    vec2 p = vP.xz + vec2(vn(vP.xz * .034), vn(vP.xz * .034 + 8.)) * 10.;
    float clusters = vn(p * .10) * .65 + vn(p * .29 + 3.7) * .35;
    float bank = 1. - smoothstep(.35, 2.4, depth);
    float raft = smoothstep(.64 - bank * .08, .77 - bank * .06, clusters);
    vec2 leafCell = floor(vP.xz * 6.2);
    vec2 leafOffset = (vec2(h12(leafCell + 3.7), h12(leafCell + 9.1)) - .5) * .44;
    vec2 leafUV = fract(vP.xz * 6.2) - .5 - leafOffset;
    float leafSeed = h12(leafCell + 5.9);
    float leafRadius = mix(.11, .22, leafSeed);
    float leaf = (1. - smoothstep(leafRadius * .65, leafRadius + max(pixel * 2., .015), length(leafUV)))
      * smoothstep(.12, .22, leafSeed);
    float vegetation = raft * mix(.48, leaf, detail) * swamp * (1. - river) * .78;
    vec3 green = mix(vec3(.105, .205, .043), vec3(.241, .334, .088), n2.b);
    vec3 plants = green * (hzSoft() * light * .42 + uSunCol * max(uSun.y, 0.) * .37);
    color = mix(color, plants, vegetation);
    alpha = mix(alpha, 1., vegetation);
  }
  float foam = vWake * .45;
  foam += river * smoothstep(.38, .85, speed) * (1. - smoothstep(.08, .7, depth))
    * smoothstep(.62, .84, n1.b) * detail * .32;
  color = mix(color, vec3(.66, .73, .64) * light, clamp(foam, 0., .6));
  alpha = mix(alpha, 1., clamp(foam, 0., .6));
  float fog = 1. - exp(-distanceToEye * uFog);
  color = mix(color, horizon(), fog);
  alpha = mix(alpha, 1., fog);

  // Absorption controls clarity; coverage only feathers the actual contact line.
  float contactAA = max(fwidth(depth) * .55, .001);
  float shore = smoothstep(0., contactAA + .003, depth);
  gl_FragColor = vec4(color / max(alpha, .001), alpha * coverage * shore);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
}