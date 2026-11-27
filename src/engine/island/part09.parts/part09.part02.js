                  U,
                  se - 0.2,
                  0.85 + D() * 0.5,
                  0.85 + D() * 0.55,
                  0.85 + D() * 0.5,
                  D() * f,
                  (D() - 0.5) * 0.15,
                  (D() - 0.5) * 0.15,
                  0.82,
                  0.8,
                  0.74,
                );
      } else {
        // Set riparian canopy further back from immediate riverbanks & create scenic open meadows + rocky/pebbly shoreline shelves
        let openBank = te < 2.2 ? 0.38 : te < 4.4 ? 0.62 : 0.78;
        if (te > 2.15 && Z < K * (0.12 + $ * 0.24) * openBank) {
          D() < 0.26
            ? b(
                "treefern",
                D() * 8,
                G,
                U,
                se - 0.2,
                0.76 + D() * 0.72,
                0.035,
                0.23 + D() * 0.025,
                0.32,
                0.5,
              )
            : b(
                "broadleaf",
                D() * 8,
                G,
                U,
                se - 0.24,
                0.74 + D() * 0.82,
                0.035,
                0.23 + D() * 0.025,
                0.25,
                0.57,
              );
        } else if (te > -0.25 && te < 1.35 && Z < K * 0.14) {
          // River-smoothed boulders & flat mossy shore slabs accenting natural banks
          let rs = 0.55 + D() * 1.45,
            [rc, gc, bc] = R(G, U, !0);
          v(
            D() < 0.45 ? "slab" : "rock",
            (D() * 12) | 0,
            G,
            U,
            se - rs * 0.18,
            rs * (1.1 + D() * 0.35),
            rs * (0.46 + D() * 0.36),
            rs * (0.9 + D() * 0.3),
            D() * f,
            (D() - 0.5) * 0.22,
            (D() - 0.5) * 0.22,
            rc,
            gc,
            bc,
          );
        } else if (te > 1.05 && Z < K * 0.34 * (0.45 + 0.65 * $)) {
          b(
            "shrub",
            D() * 6,
            G,
            U,
            se - 0.12,
            0.78 + D() * 0.72,
            0.06,
            0.24,
            0.28,
            0.56,
          );
        }
      }
    }
    (Math.floor((N + c) / q) & 15) === 0 &&
      (yield { label: "Growing the river corridors", p: 1 });
  }
  scatterKarstAndCoastalProps(o, n, t);
  return { defs: t, out: n };
}
export { wr };
