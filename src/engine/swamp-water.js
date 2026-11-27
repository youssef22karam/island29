export const SWAMP_CONFIG = {
  visibility: 1.6,
  sedimentBase: 0.18,
  vegetationDensity: 0.28,
  floatingDebris: 0.08,
  fogBase: 0.06,
};

// Suspended organic matter scatters light instead of multiplying it to black.
export const SWAMP_SHADER = /* glsl */ `
vec3 swampBody(float depth, float sediment) {
  vec3 shallows = vec3(.205, .258, .130);
  vec3 channel = vec3(.070, .156, .112);
  vec3 pool = vec3(.041, .103, .083);
  vec3 body = mix(shallows, channel, 1. - exp(-depth * .78));
  body = mix(body, pool, smoothstep(2.2, 6.5, depth));
  return mix(body, vec3(.160, .179, .104), sediment * .38);
}
vec3 swampExtinction(float sediment) {
  return mix(vec3(1.10, .72, 1.38), vec3(1.65, 1.16, 1.72), sediment);
}
`;
