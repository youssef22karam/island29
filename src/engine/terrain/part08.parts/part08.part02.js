                  0.07,
                  0.23,
                  0.3,
                  0.52,
                )
              : nt > -0.9 &&
                nt < 0.8 &&
                dt < 0.82 &&
                b(
                  "snag",
                  (L() * 8) | 0,
                  V,
                  Y,
                  st - 0.2,
                  0.85 + L() * 0.5,
                  0.85 + L() * 0.55,
                  0.85 + L() * 0.5,
                  L() * y,
                  (L() - 0.5) * 0.15,
                  (L() - 0.5) * 0.15,
                  0.82,
                  0.8,
                  0.74,
                );
      } else {
        let openBank = nt < 2.2 ? 0.38 : nt < 4.4 ? 0.62 : 0.78;
        if (nt > 2.15 && dt < J * (0.12 + ft * 0.24) * openBank) {
          L() < 0.26
            ? v(
                "treefern",
                L() * 8,
                V,
                Y,
                st - 0.2,
                0.76 + L() * 0.72,
                0.035,
                0.23 + L() * 0.025,
                0.32,
                0.5,
              )
            : v(
                "broadleaf",
                L() * 8,
                V,
                Y,
                st - 0.24,
                0.74 + L() * 0.82,
                0.035,
                0.23 + L() * 0.025,
                0.25,
                0.57,
              );
        } else if (nt > -0.25 && nt < 1.35 && dt < J * 0.14) {
          let rs = 0.55 + L() * 1.45,
            [rc, gc, bc] = z(V, Y, !0);
          b(
            L() < 0.45 ? "slab" : "rock",
            (L() * 12) | 0,
            V,
            Y,
            st - rs * 0.18,
            rs * (1.1 + L() * 0.35),
            rs * (0.46 + L() * 0.36),
            rs * (0.9 + L() * 0.3),
            L() * y,
            (L() - 0.5) * 0.22,
            (L() - 0.5) * 0.22,
            rc,
            gc,
            bc,
          );
        } else if (nt > 1.05 && dt < J * 0.34 * (0.45 + 0.65 * ft)) {
          v(
            "shrub",
            L() * 6,
            V,
            Y,
            st - 0.12,
            0.78 + L() * 0.72,
            0.06,
            0.24,
            0.28,
            0.56,
          );
        }
      }
    }
    (Math.floor((q + f) / Z) & 15) === 0 &&
      (yield { label: "Growing the river corridors", p: 1 });
  }
  scatterKarstAndCoastalProps(o, l, e);
  return { defs: e, out: l };
}
export { Bn };
