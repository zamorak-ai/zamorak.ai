/*
 * Zamorak halftone.
 *
 * Draws the white partyhat mark as a dot matrix (one dot per grid cell, sized
 * by the brightness of the mark beneath it) over a faint red matrix, on every
 * <canvas data-halftone>:
 *
 *   data-halftone="hero"    hat fitted inside the [data-halftone-stage]
 *                           element that shares the canvas's parent; with no
 *                           stage, only the empty matrix is drawn
 *   data-src                the mark to sample: light artwork on transparency
 *
 * The dots assemble when a canvas first scrolls into view, a small glint
 * sparkles somewhere on the hat every few seconds, and a mouse lights up and
 * nudges the dots near it. With reduced motion, the finished hat is drawn once.
 *
 * If the image can't be read (browsers block pixel reads on pages opened from
 * file://), the canvas's parent gets the class "halftone-failed", which the
 * stylesheet uses to show the plain fallback image instead.
 */
(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const INK = "241, 239, 233"; // the hat's dots: partyhat white
  const GRID = "196, 36, 32"; // the empty matrix: Zamorak red
  const GLOW = "255, 90, 60"; // the matrix around the mouse: --ember
  const TIERS = [0.4, 0.6, 0.8, 1]; // dot opacity, dimmest to brightest
  const INTRO = 1700; // ms for the hat to assemble
  const SPARKLE_EVERY = [2600, 6000]; // ms between sparkles, at random within this range
  const SPARKLE_LENGTH = 1100; // ms for a sparkle to swell and fade
  const SPARKLE_ARM = 4; // cells each arm of a sparkle reaches
  const POINTER_RADIUS = 120; // px

  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const VARIANTS = {
    hero: {
      pitch: (width) => (width < 640 ? 6 : width < 1100 ? 7 : 8),
      gridAlpha: 0.16,
      // Vignette: full strength in the middle, gone at the corners.
      gridFade: (x, y, w, h) => {
        const dx = (x / w - 0.5) * 1.7;
        const dy = (y / h - 0.55) * 1.8;
        return 1 - smoothstep(0.3, 1.05, Math.hypot(dx, dy));
      },
      strength: 1,
      place(canvas, aspect) {
        const stage = canvas.parentElement.querySelector("[data-halftone-stage]");
        if (!stage) return null;
        const c = canvas.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        const h = Math.min(s.height, s.width / aspect);
        const w = h * aspect;
        return { x: s.left - c.left + (s.width - w) / 2, y: s.top - c.top + (s.height - h) / 2, w, h };
      },
    },
  };

  class Halftone {
    constructor(canvas, image) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.image = image;
      this.aspect = image.naturalWidth / image.naturalHeight;
      this.variant = VARIANTS[canvas.dataset.halftone] || VARIANTS.hero;
      this.stage = canvas.parentElement.querySelector("[data-halftone-stage]");
      this.grid = document.createElement("canvas");
      this.dots = [];
      this.introStart = null;
      this.visible = false;
      this.animating = false;
      this.sparkles = [];
      this.nextSparkle = INTRO + 800; // ms after the intro starts
      this.dirty = true;
      this.frame = 0;
      this.pending = 0;
      this.pointer = { x: 0, y: 0, tx: 0, ty: 0, presence: 0, target: 0 };
      this.tick = this.tick.bind(this);
    }

    start() {
      try {
        this.build();
      } catch {
        fail(this.canvas);
        return;
      }

      const resize = new ResizeObserver(() => this.schedule());
      resize.observe(this.canvas);
      if (this.stage) resize.observe(this.stage);

      if (reducedMotion) {
        this.draw(0);
        return;
      }

      new IntersectionObserver(([entry]) => this.setVisible(entry.isIntersecting), {
        rootMargin: "80px 0px",
      }).observe(this.canvas);

      if (finePointer) {
        const host = this.canvas.parentElement;
        host.addEventListener("pointermove", (event) => {
          const rect = this.canvas.getBoundingClientRect();
          const p = this.pointer;
          p.tx = event.clientX - rect.left;
          p.ty = event.clientY - rect.top;
          if (p.presence === 0) {
            p.x = p.tx;
            p.y = p.ty;
          }
          p.target = 1;
        });
        host.addEventListener("pointerleave", () => {
          this.pointer.target = 0;
        });
      }
    }

    // Size the backing store, lay out the grid and sample the hat into dots.
    build() {
      const { canvas, variant } = this;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      this.dots = [];
      if (!width || !height) return;

      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = width;
      this.height = height;
      this.pitch = variant.pitch(width);
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);

      this.buildGrid();
      const rect = variant.place(canvas, this.aspect);
      if (rect && rect.w > 0 && rect.h > 0) this.dots = this.sample(rect);
      this.dirty = true;
    }

    // The empty matrix never changes, so it is drawn once per size.
    buildGrid() {
      const { width, height, pitch, variant } = this;
      const levels = 6;
      const paths = Array.from({ length: levels }, () => new Path2D());
      const r = Math.max(0.7, pitch * 0.12);
      for (let y = pitch / 2; y < height; y += pitch) {
        for (let x = pitch / 2; x < width; x += pitch) {
          const fade = variant.gridFade(x, y, width, height);
          if (fade < 0.05) continue;
          const path = paths[Math.min(levels - 1, Math.floor(fade * levels))];
          path.moveTo(x + r, y);
          path.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      this.grid.width = this.canvas.width;
      this.grid.height = this.canvas.height;
      const g = this.grid.getContext("2d");
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      paths.forEach((path, i) => {
        g.fillStyle = `rgba(${GRID}, ${(variant.gridAlpha * (i + 1)) / levels})`;
        g.fill(path);
      });
    }

    // Average the mark's brightness over each grid cell that it covers.
    sample(rect) {
      const { pitch, width, height } = this;
      const S = 3; // samples per cell, per axis
      const i0 = Math.max(0, Math.floor(rect.x / pitch));
      const j0 = Math.max(0, Math.floor(rect.y / pitch));
      const cols = Math.min(Math.ceil(width / pitch), Math.ceil((rect.x + rect.w) / pitch)) - i0;
      const rows = Math.min(Math.ceil(height / pitch), Math.ceil((rect.y + rect.h) / pitch)) - j0;
      if (cols <= 0 || rows <= 0) return [];

      const off = document.createElement("canvas");
      off.width = cols * S;
      off.height = rows * S;
      const o = off.getContext("2d", { willReadFrequently: true });
      o.imageSmoothingQuality = "high";
      const k = S / pitch;
      o.drawImage(this.image, (rect.x - i0 * pitch) * k, (rect.y - j0 * pitch) * k, rect.w * k, rect.h * k);
      const data = o.getImageData(0, 0, off.width, off.height).data;

      const dots = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          let sum = 0;
          for (let v = 0; v < S; v++) {
            for (let u = 0; u < S; u++) {
              const p = ((j * S + v) * off.width + i * S + u) * 4;
              sum += (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) * data[p + 3];
            }
          }
          const value = sum / (S * S * 255 * 255);
          if (value < 0.04) continue;

          const x = (i0 + i + 0.5) * pitch;
          const y = (j0 + j + 0.5) * pitch;
          const nx = (x - rect.x) / rect.w;
          const ny = (y - rect.y) / rect.h;
          const angle = Math.random() * Math.PI * 2;
          const spread = pitch * (3 + Math.random() * 5);
          dots.push({
            x,
            y,
            value,
            delay: ((1 - ny) * 0.5 + nx * 0.2 + Math.random() * 0.3) * INTRO * 0.55,
            ox: Math.cos(angle) * spread,
            oy: Math.sin(angle) * spread + pitch * 4,
          });
        }
      }
      return dots;
    }

    schedule() {
      if (this.pending) return;
      this.pending = requestAnimationFrame(() => {
        this.pending = 0;
        try {
          this.build();
        } catch {
          return;
        }
        if (reducedMotion) this.draw(0);
      });
    }

    setVisible(visible) {
      this.visible = visible;
      if (visible && this.introStart === null) this.introStart = performance.now() + 120;
      if (visible && !this.frame) this.frame = requestAnimationFrame(this.tick);
      if (!visible && this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    }

    // A glint on one of the hat's brightest dots; now and then, a second soon after.
    sparkle(t) {
      const bright = this.dots.filter((dot) => dot.value > 0.7);
      const at = () => bright[(Math.random() * bright.length) | 0];
      if (bright.length) {
        this.sparkles.push({ ...at(), start: t });
        if (Math.random() < 0.3) this.sparkles.push({ ...at(), start: t + 260 });
      }
      const [min, max] = SPARKLE_EVERY;
      this.nextSparkle = t + min + Math.random() * (max - min);
    }

    tick(now) {
      this.frame = requestAnimationFrame(this.tick);
      const p = this.pointer;
      p.presence += (p.target - p.presence) * 0.12;
      if (Math.abs(p.target - p.presence) < 0.01) p.presence = p.target;
      p.x += (p.tx - p.x) * 0.25;
      p.y += (p.ty - p.y) * 0.25;

      const t = now - this.introStart;
      if (t >= this.nextSparkle) this.sparkle(t);
      this.sparkles = this.sparkles.filter((s) => t - s.start < SPARKLE_LENGTH);
      const animating = t < INTRO || this.sparkles.length > 0 || p.presence > 0;
      // One extra frame after motion stops settles every dot at rest.
      if (animating || this.animating || this.dirty) this.draw(t);
      this.animating = animating;
      this.dirty = false;
    }

    draw(t) {
      const { ctx, dpr, pitch, pointer } = this;
      if (!this.width) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.grid, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const lit = pointer.presence > 0;
      if (lit) this.drawGlow();

      const settle = INTRO * 0.45;
      const maxR = pitch * 0.48;
      const reach = POINTER_RADIUS * POINTER_RADIUS;
      const strength = this.variant.strength;
      const paths = TIERS.map(() => new Path2D());

      for (const dot of this.dots) {
        let p = reducedMotion ? 1 : (t - dot.delay) / settle;
        if (p <= 0) continue;
        if (p > 1) p = 1;
        const e = 1 - (1 - p) ** 3;
        let x = dot.x + dot.ox * (1 - e);
        let y = dot.y + dot.oy * (1 - e);
        let b = dot.value * 0.95;
        if (lit) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < reach) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / POINTER_RADIUS) ** 2 * pointer.presence;
            x += (dx / d) * f * pitch * 1.2;
            y += (dy / d) * f * pitch * 1.2;
            b += f * 0.35;
          }
        }

        b = Math.min(1, b * strength);
        const r = maxR * Math.sqrt(b) * e;
        if (r < 0.4) continue;
        const path = paths[Math.min(TIERS.length - 1, Math.floor(b * TIERS.length))];
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, Math.PI * 2);
      }

      paths.forEach((path, i) => {
        ctx.fillStyle = `rgba(${INK}, ${TIERS[i]})`;
        ctx.fill(path);
      });

      for (const sparkle of this.sparkles) this.drawSparkle(sparkle, t);
    }

    // A four-point star of dots on the grid, with a faint halo: it swells, then fades.
    drawSparkle(sparkle, t) {
      const { ctx, pitch } = this;
      const k = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - sparkle.start) / SPARKLE_LENGTH)));
      if (k <= 0) return;
      const path = new Path2D();
      const add = (i, j, weight) => {
        const r = pitch * (0.16 + 0.44 * weight) * k;
        if (r < 0.4) return;
        const x = sparkle.x + i * pitch;
        const y = sparkle.y + j * pitch;
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, Math.PI * 2);
      };
      add(0, 0, 1);
      for (let d = 1; d <= SPARKLE_ARM; d++) {
        const weight = 1 - d / (SPARKLE_ARM + 1);
        add(d, 0, weight);
        add(-d, 0, weight);
        add(0, d, weight);
        add(0, -d, weight);
      }
      for (let d = 1; d <= 2; d++) {
        const weight = 0.5 * (1 - d / 3);
        add(d, d, weight);
        add(-d, d, weight);
        add(d, -d, weight);
        add(-d, -d, weight);
      }
      const reach = pitch * 3.5;
      const halo = ctx.createRadialGradient(sparkle.x, sparkle.y, 0, sparkle.x, sparkle.y, reach);
      halo.addColorStop(0, `rgba(255, 255, 255, ${0.22 * k})`);
      halo.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(sparkle.x - reach, sparkle.y - reach, reach * 2, reach * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * k})`;
      ctx.fill(path);
    }

    // Lights up the empty matrix around the pointer.
    drawGlow() {
      const { ctx, pitch, pointer, width, height } = this;
      const R = POINTER_RADIUS;
      const levels = 3;
      const paths = Array.from({ length: levels }, () => new Path2D());
      const r = Math.max(0.7, pitch * 0.12);
      const i0 = Math.max(0, Math.floor((pointer.x - R) / pitch));
      const i1 = Math.min(Math.ceil(width / pitch), Math.ceil((pointer.x + R) / pitch));
      const j0 = Math.max(0, Math.floor((pointer.y - R) / pitch));
      const j1 = Math.min(Math.ceil(height / pitch), Math.ceil((pointer.y + R) / pitch));
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const x = (i + 0.5) * pitch;
          const y = (j + 0.5) * pitch;
          const f = (1 - Math.hypot(x - pointer.x, y - pointer.y) / R) * pointer.presence;
          if (f <= 0) continue;
          const path = paths[Math.min(levels - 1, Math.floor(f * levels))];
          const rr = r * (1 + f * 0.8);
          path.moveTo(x + rr, y);
          path.arc(x, y, rr, 0, Math.PI * 2);
        }
      }
      paths.forEach((path, i) => {
        ctx.fillStyle = `rgba(${GLOW}, ${(0.45 * (i + 1)) / levels})`;
        ctx.fill(path);
      });
    }
  }

  const fail = (canvas) => canvas.parentElement.classList.add("halftone-failed");

  const canvases = document.querySelectorAll("canvas[data-halftone]");
  if (!("ResizeObserver" in window) || !("IntersectionObserver" in window)) {
    canvases.forEach(fail);
    return;
  }

  const images = new Map();
  const load = (src) => {
    if (!images.has(src)) {
      images.set(
        src,
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        })
      );
    }
    return images.get(src);
  };

  // Laying out before the web fonts arrive would place the hat against the
  // fallback font's line heights, then jump when the fonts swap in.
  const fontsReady = document.fonts
    ? Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))])
    : Promise.resolve();

  canvases.forEach((canvas) => {
    Promise.all([load(canvas.dataset.src), fontsReady])
      .then(([image]) => new Halftone(canvas, image).start())
      .catch(() => fail(canvas));
  });
})();
