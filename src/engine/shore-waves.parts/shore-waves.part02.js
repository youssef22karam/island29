  const Hs = Hn * Math.pow(10 / clamp(dd, 0.05, 10), 0.25);
  const Hl = Math.min(Hs, (gB + (gS - gB) * smooth(dB, dB * 0.55, dd)) * dd);
  const bi = Hs / (gB * dd), steep = smooth(0.4, 1, bi) * (1 - smooth(dB * 1.04, dB * 0.8, dd));
  const fr = Math.max(0.06, 0.5 - 0.3 * steep), np = 1 + 2.2 * steep;
  const u = ph < 1 - fr ? (0.5 * ph) / (1 - fr) : 0.5 + (0.5 * (ph - (1 - fr))) / fr;
  const cu = 0.5 + 0.5 * Math.cos(Math.PI * 2 * u);
  const setup = 0.15 * Math.min(Hn * 1.3, gB * dB) * (1 - clamp(dd / dB, 0, 1));
  const etaS = Hl * (Math.pow(cu, np) - 1 / Math.sqrt(Math.PI * (np + 0.25))) + setup;
  // swash level
  const bS = clamp(beta, 0.015, 0.6), thS = (t + tau * smooth(2, 8, tau)) / T + phA + 0.08, nS = Math.floor(thS);
  let zf = -9;
  for (let kk = 0; kk < 4; kk++) {
    const nk = nS - kk, tp = (thS - nk) * T, Hk = H0 * samp(nk);
    const Rk = runup(Hk, L0, bS) * (1 + 0.15 * storm) + 0.06 * Hk * storm, zr = -0.05 - 0.12 * Hk;
    const Tsw = clamp((1.15 * Math.sqrt(2 * SHORE_G * Math.max(Rk - zr, 0.01))) / (SHORE_G * bS), 0.45 * T, 2 * T);
    const Tu = 0.38 * Tsw, Tb = 0.62 * Tsw;
    let zz = zr;
    if (tp < Tu) { const s = tp / Tu; zz = zr + (Rk - zr) * (1 - (1 - s) * (1 - s)); }
    else if (tp < Tsw) { const s = (tp - Tu) / Tb; zz = zr + (Rk - zr) * (1 - s * s); }
    zf = Math.max(zf, zz);
  }
  const hSw = Math.max(zf - bed, 0) * 0.32;
  const etaSw = zf > bed ? bed + Math.max(hSw, 0.006) : bed;
  const wsw = 1 - smooth(0, Math.max(0.14 + 0.22 * Hn, 0.1), d);
  const sWt = clamp(calm * Math.max(1 - smooth(12, 26, d), 1 - smooth(40, 110, sdist)), 0, 1);
  const eta = (etaS + (etaSw - etaS) * wsw) * sWt;
  const floor = Math.max(bed, -12), hh = Math.max(eta - floor, 0);
  const vel = clamp(etaS * Math.sqrt(SHORE_G / Math.max(dd, 0.25)), -2.5, 3.5) * (1 - wsw) * sWt;
  return { eta: floor + hh, h: hh, u: dx * vel, v: dz * vel, ok: true };
}
