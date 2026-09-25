/*
 * Zamorak inferno: a wide, retro pixel blaze on every <canvas data-inferno>,
 * burning behind the footer's line of little fires.
 *
 * This is the well-known "Doom fire" technique. The bottom row is held at full
 * heat. Every frame, each cell takes the heat of the cell below it, cooled a
 * little and shifted sideways at random, and each heat level maps to one
 * colour of a short, banded palette. Cells are drawn as square pixels with a
 * thin gap between them.
 *
 * The blaze rises slowly when the canvas first scrolls into view (while the
 * little fires are being lit) and pauses while off screen. With reduced
 * motion, one settled frame is drawn and left.
 */
(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CELL = 6; // CSS px per pixel
  const GAP = 1; // CSS px between pixels
  const FPS = 30; // stepped on purpose; smooth motion would lose the retro feel
  const IGNITE = 3500; // ms for the blaze to reach full heat
  const REACH = 0.7; // average flame height, as a share of the canvas
  const LEVELS = 36; // heat levels; 0 is unlit
  const SHADES = 12; // distinct colours the levels share, for visible banding

  // Heat ramp from dying ember to Zamorak gold.
  const STOPS = [
    [0, [42, 6, 7]],
    [0.25, [104, 10, 12]],
    [0.5, [170, 20, 22]],
    [0.7, [222, 52, 26]],
    [0.86, [246, 122, 40]],
    [1, [255, 204, 102]],
  ];

  const PALETTE = Array.from({ length: LEVELS }, (_, heat) => {
    if (heat === 0) return [0, 0, 0, 0];
    const t = Math.round(((heat - 1) / (LEVELS - 2)) * (SHADES - 1)) / (SHADES - 1);
    let i = 1;
    while (i < STOPS.length - 1 && STOPS[i][0] < t) i++;
    const [t0, from] = STOPS[i - 1];
    const [t1, to] = STOPS[i];
    const k = (t - t0) / (t1 - t0);
    return [...from.map((c, j) => Math.round(c + (to[j] - c) * k)), 255];
  });

  class Inferno {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.buffer = document.createElement("canvas");
      this.bctx = this.buffer.getContext("2d");
      this.gaps = document.createElement("canvas");
      this.heat = null;
      this.lit = null;
      this.frame = 0;
      this.last = 0;
      this.tick = this.tick.bind(this);
    }

    start() {
      this.resize();
      new ResizeObserver(() => this.resize()).observe(this.canvas);
      if (reducedMotion) return;
      new IntersectionObserver(([entry]) => this.setVisible(entry.isIntersecting), {
        rootMargin: "80px 0px",
      }).observe(this.canvas);
    }

    // Everything is sized in device pixels so each pixel of the blaze is a
    // whole number of screen pixels and stays crisp.
    resize() {
      const { canvas } = this;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (!width || !height || (this.heat && width === canvas.width && height === canvas.height)) return;

      canvas.width = width;
      canvas.height = height;
      this.cell = Math.max(2, Math.round(CELL * dpr));
      this.gap = Math.max(1, Math.round(GAP * dpr));
      this.cols = Math.ceil(width / this.cell);
      this.rows = Math.ceil(height / this.cell);
      this.heat = new Uint8Array(this.cols * this.rows);
      this.buffer.width = this.cols;
      this.buffer.height = this.rows;
      this.image = this.bctx.createImageData(this.cols, this.rows);
      // Cooling per row is random in [0, spread); its mean sets the flame height.
      this.spread = ((LEVELS - 1) / (this.rows * REACH)) * 2 + 1;
      this.buildGaps();

      // Burn in, so a resized blaze (or the still frame) is already up.
      if (reducedMotion || this.lit !== null) {
        for (let i = 0; i < this.rows * 2; i++) this.step(LEVELS - 1);
      }
      this.paint();
    }

    // Grid lines, later cut out of each frame to separate the pixels.
    buildGaps() {
      const { cell, gap, cols, rows } = this;
      const { width, height } = this.canvas;
      this.gaps.width = width;
      this.gaps.height = height;
      const g = this.gaps.getContext("2d");
      const top = height - rows * cell;
      for (let i = 0; i <= cols; i++) g.fillRect(i * cell, 0, gap, height);
      for (let j = 0; j <= rows; j++) g.fillRect(0, top + j * cell, width, gap);
    }

    step(source) {
      const { cols, rows, heat, spread } = this;
      const bottom = (rows - 1) * cols;
      for (let x = 0; x < cols; x++) heat[bottom + x] = source;
      for (let y = 1; y < rows; y++) {
        const row = y * cols;
        for (let x = 0; x < cols; x++) {
          const h = heat[row + x];
          const nx = x + ((Math.random() * 3) | 0) - 1;
          const cool = (Math.random() * spread) | 0;
          heat[row - cols + (nx < 0 ? 0 : nx >= cols ? cols - 1 : nx)] = h > cool ? h - cool : 0;
        }
      }
    }

    paint() {
      const { ctx, canvas, heat, cell } = this;
      const data = this.image.data;
      for (let i = 0, p = 0; i < heat.length; i++, p += 4) {
        const c = PALETTE[heat[i]];
        data[p] = c[0];
        data[p + 1] = c[1];
        data[p + 2] = c[2];
        data[p + 3] = c[3];
      }
      this.bctx.putImageData(this.image, 0, 0);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.buffer, 0, canvas.height - this.rows * cell, this.cols * cell, this.rows * cell);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(this.gaps, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }

    setVisible(visible) {
      if (visible && this.lit === null) this.lit = performance.now();
      if (visible && !this.frame) this.frame = requestAnimationFrame(this.tick);
      if (!visible && this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    }

    tick(now) {
      this.frame = requestAnimationFrame(this.tick);
      const interval = 1000 / FPS;
      if (now - this.last < interval) return;
      this.last = now - ((now - this.last) % interval);
      const t = Math.min(1, (now - this.lit) / IGNITE);
      this.step(Math.round((LEVELS - 1) * t * (2 - t)));
      this.paint();
    }
  }

  if (!("ResizeObserver" in window) || !("IntersectionObserver" in window)) return;
  document.querySelectorAll("canvas[data-inferno]").forEach((canvas) => new Inferno(canvas).start());
})();
