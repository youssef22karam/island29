import { useEffect, useRef } from "react";
import wetlandsUrl from "../assets/wetlands.jpg";

/**
 * Lite mode: used when the browser cannot create a WebGL context at all.
 * It needs nothing but Canvas 2D: a slow camera drift over the wetlands photo
 * with an animated, rippling water reflection.
 */
export default function LiteScene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const img = new Image();
    img.src = wetlandsUrl;
    let raf = 0;
    let last = 0;
    let alive = true;

    const draw = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      if (now - last < 40 || !img.complete || !img.naturalWidth) return; // ~25 fps
      last = now;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const W = Math.round(canvas.clientWidth * dpr);
      const H = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const t = now / 1000;
      // cover-fit with a gentle drift
      const zoom = 1.06 + Math.sin(t * 0.07) * 0.02;
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      const dx = (W - dw) / 2 + Math.sin(t * 0.11) * W * 0.012;
      const dy = (H - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);

      // ripple the water: the photo's waterline sits roughly 66% down the image
      const horizon = dy + dh * 0.66;
      const step = Math.max(2, Math.round(3 * dpr));
      const sh = img.naturalHeight / dh; // source px per canvas px
      for (let y = Math.max(0, Math.floor(horizon)); y < H; y += step) {
        const depth = (y - horizon) / Math.max(1, H - horizon); // 0 at horizon, 1 at bottom
        const amp = (0.6 + depth * 3.2) * dpr;
        const off = Math.sin(y * 0.045 + t * 1.3) * amp + Math.sin(y * 0.021 - t * 0.7) * amp * 0.6;
        // mirrored source row (reflection) and the original row
        const my = horizon - (y - horizon) * 0.9;
        const sy = (my - dy) * sh;
        if (sy >= 0 && sy < img.naturalHeight) {
          ctx.globalAlpha = 0.3;
          ctx.drawImage(img, 0, sy, img.naturalWidth, Math.max(1, step * sh), dx + off, y, dw, step);
        }
        // shimmer
        const g = Math.max(0, Math.sin(y * 0.09 - t * 1.9 + Math.sin(t * 0.3) * 2)) * 0.05;
        if (g > 0.01) {
          ctx.globalAlpha = g;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, y, W, step);
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", zIndex: 0, pointerEvents: "none" }}
    />
  );
}
