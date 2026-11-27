        ve(e.foamB, re(0.6 - 0.0185 * (e.hs - 10), 0.3, 0.6), k),
        e.foamS,
        e.foamC,
      ),
      (o.uFog.value = (16e-5 + 0.0018 * R + 12e-5 * k) * e.fog * 2),
      (o.uRain.value = ne(0.35, 0.8, R)));
    let G = (n.direction * Math.PI) / 180,
      U = (n.windSpeed / 19) * (0.42 + R * 0.25);
    (o.uWind.value.set(Math.cos(G) * U, Math.sin(G) * U),
      (o.uWindAmt.value = 0.12 + (n.windSpeed / 19) * 0.6 + R * 0.5),
      o.uWD.value.set(Math.cos(G), Math.sin(G)),
      (o.uHs.value = Math.max(e.hs, 0.3)));
    let K = (i.direction * Math.PI) / 180,
      X = Math.cos(K) * 0.65 + Math.cos(G) * 0.35,
      J = Math.sin(K) * 0.65 + Math.sin(G) * 0.35,
      se = Math.hypot(X, J) || 1;
    o.uSwDir.value.set(X / se, J / se);
    let te = Math.min(e.hs, 5);
    ((o.uShT.value = 6.4 + 1.15 * te),
      (o.uShH.value = Math.max(
        0.45,
        4.6 * Math.tanh((e.hs * 1.05 * e.shore) / 4.6),
      )),
      o.uRainCol.value.setRGB(0.8, 0.85, 0.95).multiplyScalar(0.1 + 0.9 * V),
      r.material.color.copy(o.uBody.value).multiplyScalar(V * ve(1, 0.4, R)));
  }
  let g = 6,
    M = [],
    w = 0;
  function E(k) {
    let R = a();
    if (R > 0.6 && (g -= k) <= 0) {
      let H = 0;
      ((M = Array.from(
        { length: 2 + Math.floor(Math.random() * 3) },
        () => (H += 0.05 + Math.random() * 0.12),
      )),
        (w = 0),
        (g = (6 + Math.random() * 11) * (1.6 - R * 0.7)));
    }
    ((f = 0),
      M.length &&
        ((w += k),
        M.forEach((H) => (f = Math.max(f, 1 - Math.abs(w - H) / 0.06))),
        w > M[M.length - 1] + 0.1 && (M = [])),
      (o.uFlash.value = f = re(f, 0, 1)));
  }
  return { updateSky: b, updateLightning: E };
}
var di = (o) => o * o * o * (o * (o * 6 - 15) + 10);
export { _r, di, sa };
