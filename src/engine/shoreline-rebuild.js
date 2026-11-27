/* =============================================================================
   Shoreline wave system — public descriptor (exposed as window.__SHORE)
   -----------------------------------------------------------------------------
   The live implementation is ./shore-waves.js. It replaced the camera-boxed
   shallow-water simulation with an analytic, deterministic surf model that holds
   on every beach, headland and rock of every island at any viewing distance:

     refraction   eikonal travel-time field from the shoreline (c = sqrt(g d)):
                  crests are its isochrones, so swell bends toward every shore,
                  wraps headlands and slows / crowds in shallow water; small
                  rocks let the swell pass instead of radiating rings
     shoaling     Green's law H ~ d^-1/4, peaked crests and flat troughs
     breaking     depth-limited, breaker index by Iribarren number
                  (spilling / plunging / surging), bar and reef breaks with
                  reformed waves in the trough, saturated bores, wave setup
     swash        Stockdon (2006) run-up per wave, ballistic uprush, stall and
                  accelerating backwash; later bores overrun earlier backwash
     variability  wave sets (beating trains), wave-to-wave scatter, peaks and
                  peeling sections along the coast, exposure and swell facing
     foam         rollers, plunging bursts, trailing whitewater, residual
                  patches, the uprush lip, stranded bubbles, rock bursts
     sand         moisture memory of the last four swashes, glossy backwash film
     beaches      Dean equilibrium seabed (h = A x^2/3) with a soft longshore
                  bar, and a 1:10–1:16 beach face rising to a 1.5–2.2 m berm

   Everything adapts live to the wave-height, storm and wind controls through
   uShH (shore swell height), uShT (period), uSwDir (swell direction), uStorm,
   uFoamGain and uWetDry.
============================================================================= */
import { SHORE_SEA_GLSL, SHORE_DFLOOR, SHORE_DCAP } from "./shore-waves.js";

export const SHORELINE_SHADER = SHORE_SEA_GLSL;

export const SHORELINE_CONFIG = {
  model: "analytic eikonal surf + ballistic swash",
  travelTime: { gravity: 9.81, depthFloor: SHORE_DFLOOR, depthCap: SHORE_DCAP },
  shoaling: { law: "Green", referenceDepth: 10 },
  breaking: { gammaSpilling: 0.72, gammaPlunging: 1.0, boreGamma: [0.42, 0.6] },
  swash: { runup: "Stockdon 2006", uprushFraction: 0.38, maxRunup: 2.6, memoryWaves: 4 },
  beach: { deanA: [0.105, 0.165], barOffset: [70, 130], faceSlope: [0.062, 0.102], berm: [1.5, 2.2] },
  coverage: "every coast of every island, any distance (no simulation box)",
};
