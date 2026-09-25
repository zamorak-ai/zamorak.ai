/*
 * Zamorak fires: a line of little fires on every <canvas data-flames>, as if
 * someone had been training Firemaking along the bottom of the page.
 *
 * Each fire is drawn low-poly, like Old School RuneScape's: translucent gold
 * flames that change shape at a choppy, game-like frame rate, orange embers
 * drifting up, and underneath, a small star of dark, flat-shaded logs. They
 * rest on a strip of Wilderness: near-black ground scattered with pebbles and
 * a few dead trees, with a channel of lava behind it, from which the blaze
 * behind the canvas appears to rise. When
 * the canvas first scrolls into view the fires are lit one at a time from
 * right to left (a firemaker steps west after each log). Each fire burns for
 * a while, dies down to ashes, and is later laid and lit again.
 *
 * The fires pause while off screen. With reduced motion, every fire is drawn
 * burning, once, without embers.
 */
(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FPS = 30; // redraws per second
  const FLICKER = 8; // new flame shapes per second
  const LIGHT_EVERY = 260; // ms between lighting one fire and the next
  const IGNITE = 600; // ms for a fire to catch
  const BURN = [25000, 60000]; // ms a fire burns, at random within this range
  const DIE = 2500; // ms for a fire to die down
  const ASHES = [8000, 15000]; // ms the ashes sit before new logs are laid
  const RELIGHT = 900; // ms from laying new logs to lighting them
  const GROUND_TOP = 26; // px: depth of the ground's top face, as seen
  const GROUND_FRONT = 14; // px: height of the ground's front face
  const LAVA = 15; // px: depth of the lava channel behind the ground

  // The camera looks down at the ground at about 30 degrees; the light comes
  // from the upper left. World axes: x right, y up, z towards the viewer.
  const TILT = 0.52;
  const COS = Math.cos(TILT);
  const SIN = Math.sin(TILT);
  const TOWARD_VIEWER = [0, SIN, COS];
  const LIGHT = normalize([-0.5, 0.8, 0.45]);

  const LOG = [52, 43, 10]; // the game's dark olive fire logs, kept dim
  const ASH = [166, 160, 154]; // pale grey, like the game's ashes
  const GROUND_TOP_SHADES = [
    [36, 35, 37],
    [42, 41, 43],
    [31, 30, 32],
  ];
  const GROUND_FRONT_SHADES = [
    [17, 16, 18],
    [21, 20, 22],
  ];
  const PEBBLES = [
    [96, 94, 98],
    [74, 72, 76],
    [120, 118, 122],
  ];
  const TREE_LIT = [160, 150, 106]; // the Wilderness's dead trees: pale khaki
  const TREE_SHADE = [118, 110, 74];
  const FLAMES = [
    [252, 226, 128],
    [248, 210, 92],
    [244, 190, 56],
    [238, 170, 40],
  ];
  const EMBERS = [
    [232, 137, 78],
    [240, 160, 100],
    [226, 118, 62],
  ];

  function normalize(v) {
    const length = Math.hypot(...v);
    return v.map((c) => c / length);
  }

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const between = ([min, max]) => min + Math.random() * (max - min);
  const pick = (list) => list[(Math.random() * list.length) | 0];
  const rgb = (c, alpha = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
  const shade = (c, normal, ambient) => {
    const k = ambient + 0.7 * Math.max(0, dot(normal, LIGHT));
    return rgb(c.map((v) => Math.min(255, Math.round(v * k))));
  };

  // To screen offsets (y down) and nearness, for a point in world units.
  const project = ([x, y, z]) => [x, z * SIN - y * COS];
  const nearness = ([, y, z]) => y * SIN + z * COS;

  // Visible faces of a convex solid, projected and shaded.
  const visible = (faces, colour, ambient) =>
    faces
      .filter((face) => dot(face.normal, TOWARD_VIEWER) > 0)
      .map((face) => ({ points: face.points.map(project), fill: shade(colour, face.normal, ambient) }));

  // Five hexagonal logs radiating from the centre. Units are fractions of the
  // fire's width; the solids are listed far to near, for painting in order.
  function logPile(rotation) {
    const logs = [];
    for (let k = 0; k < 5; k++) {
      const angle = rotation + (k * 2 * Math.PI) / 5 + (Math.random() - 0.5) * 0.25;
      const axis = [Math.cos(angle), 0, Math.sin(angle)];
      const side = [-Math.sin(angle), 0, Math.cos(angle)];
      const r = 0.06;
      const ring = (d) =>
        Array.from({ length: 6 }, (_, i) => {
          const c = Math.cos((i * Math.PI) / 3);
          const s = Math.sin((i * Math.PI) / 3);
          return [axis[0] * d + r * side[0] * c, r + r * s, axis[2] * d + r * side[2] * c];
        });
      const from = 0.05;
      const to = from + between([0.25, 0.31]);
      const inner = ring(from);
      const outer = ring(to);
      const faces = [
        { points: outer, normal: axis },
        { points: inner, normal: axis.map((c) => -c) },
      ];
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        const phi = ((i + 0.5) * Math.PI) / 3;
        faces.push({
          points: [inner[i], inner[j], outer[j], outer[i]],
          normal: [side[0] * Math.cos(phi), Math.sin(phi), side[2] * Math.cos(phi)],
        });
      }
      const middle = axis.map((c) => (c * (from + to)) / 2);
      logs.push({ nearness: nearness(middle), faces: visible(faces, LOG, 0.4) });
    }
    return logs.sort((a, b) => a.nearness - b.nearness).flatMap((log) => log.faces);
  }

  // A low, lumpy cone of ash.
  function ashPile(rotation) {
    const peak = [0, 0.09, 0];
    const rim = Array.from({ length: 7 }, (_, i) => {
      const angle = rotation + (i * 2 * Math.PI) / 7;
      const reach = 0.24 * between([0.85, 1.15]);
      return [Math.cos(angle) * reach, 0, Math.sin(angle) * reach];
    });
    const faces = rim.map((p, i) => {
      const q = rim[(i + 1) % rim.length];
      let normal = normalize(cross(minus(q, peak), minus(p, peak)));
      if (normal[1] < 0) normal = normal.map((c) => -c);
      return { points: [p, q, peak], normal, nearness: nearness([(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2]) };
    });
    faces.sort((a, b) => a.nearness - b.nearness);
    return visible(faces, ASH, 0.55);
  }

  // A forked, leafless tree, standing at (x, y): each segment tapers and is
  // split lengthwise into a lit half and a shaded half. Units are CSS px.
  function deadTree(x, y, height) {
    const faces = [];
    const lit = rgb(TREE_LIT);
    const shaded = rgb(TREE_SHADE);
    const grow = (x0, y0, angle, length, width, depth) => {
      const a = angle + (Math.random() - 0.5) * 0.35;
      const x1 = x0 + Math.sin(a) * length;
      const y1 = y0 - Math.cos(a) * length;
      const end = depth === 0 ? 0.4 : width * 0.62;
      const [px, py] = [(Math.cos(angle) * width) / 2, (Math.sin(angle) * width) / 2];
      const [qx, qy] = [(Math.cos(a) * end) / 2, (Math.sin(a) * end) / 2];
      faces.push({ points: [[x0 - px, y0 - py], [x0, y0], [x1, y1], [x1 - qx, y1 - qy]], fill: lit });
      faces.push({ points: [[x0, y0], [x0 + px, y0 + py], [x1 + qx, y1 + qy], [x1, y1]], fill: shaded });
      if (depth === 0) return;
      const forks = depth === 3 || Math.random() < 0.6 ? 2 : 3;
      for (let i = 0; i < forks; i++) {
        const spread = (i - (forks - 1) / 2) * between([0.5, 0.8]);
        grow(x1, y1, a + spread, length * between([0.55, 0.75]), end, depth - 1);
      }
    };
    grow(x, y, (Math.random() - 0.5) * 0.2, height * 0.4, height * 0.09, 3);
    return faces;
  }

  // Everything behind and under the fires, in CSS px: a lava channel, then the
  // ground in front of it (an uneven top face in facets of three shades, over
  // a darker front face) scattered with pebbles, and dead trees along its far edge.
  function wilderness(width, height) {
    const front = height - GROUND_FRONT;
    const back = front - GROUND_TOP;
    const step = 36;
    const count = Math.ceil(width / step) + 1;
    const backEdge = Array.from({ length: count }, (_, i) => [i * step, back + (Math.random() - 0.5) * 4]);
    const frontEdge = Array.from({ length: count }, (_, i) => [i * step + step / 2, front + (Math.random() - 0.5) * 2]);
    frontEdge.unshift([0, front]);

    const ground = [];
    for (let i = 0; i < count - 1; i++) {
      ground.push({ points: [backEdge[i], backEdge[i + 1], frontEdge[i + 1]], fill: rgb(pick(GROUND_TOP_SHADES)) });
      ground.push({ points: [backEdge[i], frontEdge[i + 1], frontEdge[i]], fill: rgb(pick(GROUND_TOP_SHADES)) });
    }
    for (let i = 0; i < frontEdge.length - 1; i++) {
      const [a, b] = [frontEdge[i], frontEdge[i + 1]];
      ground.push({ points: [a, b, [b[0], height], [a[0], height]], fill: rgb(pick(GROUND_FRONT_SHADES)) });
    }

    const pebbles = Array.from({ length: Math.round((width * GROUND_TOP) / 260) }, () => {
      const x = Math.random() * width;
      const y = back + 3 + Math.random() * (GROUND_TOP + GROUND_FRONT - 5);
      const r = between([1, 2.4]);
      const a = Math.random() * Math.PI;
      const corner = (k) => [x + r * Math.cos(a + (k * 2 * Math.PI) / 3), y + r * 0.7 * Math.sin(a + (k * 2 * Math.PI) / 3)];
      return { points: [corner(0), corner(1), corner(2)], fill: rgb(pick(PEBBLES), 0.8) };
    });

    const lavaTop = back - LAVA;
    const farEdge = Array.from({ length: count }, (_, i) => [i * step + step / 3, lavaTop + (Math.random() - 0.5) * 4]);
    const lava = [[0, lavaTop], ...farEdge, [width, lavaTop], [width, back + 4], [0, back + 4]];
    const bubbles = Array.from({ length: Math.round(width / 110) }, () => ({
      x: Math.random() * width,
      y: lavaTop + LAVA * between([0.3, 0.75]),
      rx: between([3, 8]),
      ry: between([1, 2]),
      phase: Math.random() * Math.PI * 2,
    }));

    // Three trees, deliberately unevenly spaced: [share of the width, height in px].
    const scale = Math.min(1, height / 220);
    const trees = [
      [0.13, 110],
      [0.36, 84],
      [0.8, 120],
    ].flatMap(([at, tall]) => deadTree(at * width, back + 4, tall * scale));

    return { ground, pebbles, backEdge, lava, lavaTop, bubbles, trees };
  }

  // Four to six translucent pyramids around the middle of the pile, tallest first.
  function flameShapes(level) {
    const count = 4 + ((Math.random() * 3) | 0);
    return Array.from({ length: count }, () => {
      const x = (Math.random() - 0.5) * 0.3;
      return {
        x,
        width: between([0.1, 0.17]),
        height: between([0.4, 0.85]) * level,
        tip: x + (Math.random() - 0.5) * 0.1,
        dip: Math.random() * 0.04,
        colour: pick(FLAMES),
      };
    }).sort((a, b) => b.height - a.height);
  }

  class Fires {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.fires = [];
      this.lit = false;
      this.frame = 0;
      this.last = 0;
      this.tick = this.tick.bind(this);
    }

    start() {
      this.resize();
      new ResizeObserver(() => this.resize()).observe(this.canvas);
      if (reducedMotion) return;
      new IntersectionObserver((entries) => this.setVisible(entries[entries.length - 1].isIntersecting), {
        rootMargin: "80px 0px",
      }).observe(this.canvas);
    }

    resize() {
      const { canvas } = this;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height || (width === this.width && height === this.height)) return;

      this.width = width;
      this.height = height;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);

      // A close-packed Firemaking lane, the whole line centred.
      this.size = Math.min(80, Math.max(52, width * 0.05));
      const spacing = this.size * 0.9;
      const count = Math.max(1, Math.floor((width - this.size) / spacing) + 1);
      const first = (width - (count - 1) * spacing) / 2;
      this.scene = wilderness(width, height);
      this.ground = height - GROUND_FRONT - GROUND_TOP * 0.55;

      const now = performance.now();
      const burning = reducedMotion || this.lit;
      this.fires = Array.from({ length: count }, (_, i) => {
        const rotation = Math.random() * Math.PI * 2;
        return {
          x: first + i * spacing,
          logs: logPile(rotation),
          ash: ashPile(rotation),
          phase: burning ? "burning" : "laid",
          since: now - IGNITE,
          until: burning ? now + between(BURN) : Infinity,
          level: burning ? 1 : 0,
          flames: burning ? flameShapes(1) : [],
          nextFlicker: now + Math.random() * (1000 / FLICKER),
          embers: [],
          nextEmber: now + between([0, 600]),
        };
      });
      this.draw();
    }

    // Right to left, one at a time.
    lightAll(now) {
      [...this.fires]
        .sort((a, b) => b.x - a.x)
        .forEach((fire, i) => {
          fire.until = now + i * LIGHT_EVERY;
        });
      this.lit = true;
    }

    // laid → burning → dying → ashes → laid, with `level` (0 to 1) as the heat.
    update(now, dt) {
      for (const fire of this.fires) {
        if (fire.phase === "laid" && now >= fire.until) {
          fire.phase = "burning";
          fire.since = now;
          fire.until = now + between(BURN);
        } else if (fire.phase === "burning") {
          fire.level = Math.min(1, (now - fire.since) / IGNITE);
          if (now >= fire.until) {
            fire.phase = "dying";
            fire.since = now;
          }
        } else if (fire.phase === "dying") {
          fire.level = Math.max(0, 1 - (now - fire.since) / DIE);
          if (fire.level === 0) {
            fire.phase = "ashes";
            fire.until = now + between(ASHES);
          }
        } else if (fire.phase === "ashes" && now >= fire.until) {
          fire.phase = "laid";
          fire.until = now + RELIGHT;
        }

        if (now >= fire.nextFlicker) {
          fire.flames = fire.level > 0 ? flameShapes(fire.level) : [];
          fire.nextFlicker = now + 1000 / FLICKER;
        }

        if (fire.level > 0.6 && now >= fire.nextEmber) {
          fire.embers.push({
            x: (Math.random() - 0.5) * 0.3,
            y: -between([0.3, 0.6]),
            vx: (Math.random() - 0.5) * 0.12,
            vy: -between([0.35, 0.6]),
            size: between([0.035, 0.06]),
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 4,
            age: 0,
            life: between([1.1, 1.9]),
            colour: pick(EMBERS),
          });
          fire.nextEmber = now + between([220, 650]);
        }
        for (const ember of fire.embers) {
          ember.x += ember.vx * dt;
          ember.y += ember.vy * dt;
          ember.angle += ember.spin * dt;
          ember.age += dt;
        }
        fire.embers = fire.embers.filter((ember) => ember.age < ember.life);
      }
    }

    draw() {
      const { ctx, size, ground } = this;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);

      const { scene } = this;
      const lava = ctx.createLinearGradient(0, scene.lavaTop - 3, 0, scene.lavaTop + LAVA + 4);
      lava.addColorStop(0, "rgb(255, 146, 34)");
      lava.addColorStop(0.4, "rgb(255, 222, 54)");
      lava.addColorStop(1, "rgb(255, 236, 92)");
      this.polygon(scene.lava, lava);
      const t = performance.now() / 1000;
      ctx.fillStyle = "rgb(255, 246, 170)";
      for (const bubble of scene.bubbles) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.3 + bubble.phase);
        ctx.beginPath();
        ctx.ellipse(bubble.x, bubble.y, bubble.rx, bubble.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const face of scene.ground) this.polygon(face.points, face.fill);
      for (const pebble of scene.pebbles) this.triangle(...pebble.points, pebble.fill);
      // A cooled, dark red crust where the lava meets the ground.
      ctx.beginPath();
      scene.backEdge.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, y - 1));
      ctx.strokeStyle = "rgb(120, 26, 10)";
      ctx.lineWidth = 3;
      ctx.stroke();
      for (const face of scene.trees) this.polygon(face.points, face.fill);

      // Glows next, lighting the ground, and so no fire's glow lies over its
      // neighbour's logs.
      for (const fire of this.fires) {
        if (fire.level <= 0) continue;
        const y = ground - size * 0.3;
        const radius = size * 1.05;
        const glow = ctx.createRadialGradient(fire.x, y, 0, fire.x, y, radius);
        glow.addColorStop(0, `rgba(255, 150, 50, ${0.18 * fire.level * between([0.85, 1.15])})`);
        glow.addColorStop(1, "rgba(255, 150, 50, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(fire.x - radius, y - radius, radius * 2, radius * 2);
      }

      for (const fire of this.fires) {
        const burnt = fire.phase === "ashes" || (fire.phase === "dying" && fire.level < 0.3);
        for (const face of burnt ? fire.ash : fire.logs) {
          this.polygon(
            face.points.map(([x, y]) => [fire.x + x * size, ground + y * size]),
            face.fill
          );
        }

        const base = ground - size * 0.07;
        for (const flame of fire.flames) {
          const y = base + flame.dip * size;
          const left = [fire.x + (flame.x - flame.width) * size, y];
          const right = [fire.x + (flame.x + flame.width) * size, y];
          const front = [fire.x + (flame.x + flame.width * 0.15) * size, y + flame.width * 0.45 * size];
          const tip = [fire.x + flame.tip * size, y - flame.height * size];
          this.triangle(left, front, tip, rgb(flame.colour, 0.8));
          this.triangle(front, right, tip, rgb(flame.colour.map((c) => Math.round(c * 0.86)), 0.8));
        }

        for (const ember of fire.embers) {
          const t = ember.age / ember.life;
          const alpha = t < 0.6 ? 0.9 : 0.9 * (1 - (t - 0.6) / 0.4);
          const cx = fire.x + ember.x * size;
          const cy = base + ember.y * size;
          const r = ember.size * size;
          const corner = (k) => [
            cx + r * Math.cos(ember.angle + (k * 2 * Math.PI) / 3),
            cy + r * Math.sin(ember.angle + (k * 2 * Math.PI) / 3),
          ];
          this.triangle(corner(0), corner(1), corner(2), rgb(ember.colour, alpha));
        }
      }
    }

    polygon(points, fill) {
      const { ctx } = this;
      ctx.beginPath();
      points.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, y));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      // A hairline in the same colour closes the seams between faces.
      ctx.strokeStyle = fill;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    triangle(a, b, c, fill) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    setVisible(visible) {
      if (visible && !this.lit) this.lightAll(performance.now());
      if (visible && !this.frame) {
        this.last = performance.now();
        this.frame = requestAnimationFrame(this.tick);
      }
      if (!visible && this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    }

    tick(now) {
      this.frame = requestAnimationFrame(this.tick);
      const elapsed = now - this.last;
      if (elapsed < 1000 / FPS - 1) return;
      this.last = now;
      this.update(now, Math.min(elapsed, 100) / 1000);
      this.draw();
    }
  }

  if (!("ResizeObserver" in window) || !("IntersectionObserver" in window)) return;
  document.querySelectorAll("canvas[data-flames]").forEach((canvas) => new Fires(canvas).start());
})();
