/* 3D scenes: the hero (floating supply objects around a glowing network globe) and the supply-network simulation. */
import * as THREE from "/assets/vendor/three.module.min.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = innerWidth < 760;
const weak = (navigator.hardwareConcurrency || 4) <= 4 && small;

function webgl() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (e) {
    return false;
  }
}

if (!webgl()) {
  document.documentElement.classList.add("no-webgl");
} else {
  heroScene();
  simScene();
}

/** Runs `frame` only while the element is on screen and the tab is visible. */
function whenVisible(el, frame) {
  let on = false;
  let raf = 0;
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    frame(dt, t / 1000);
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    if (on || document.hidden) return;
    on = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    on = false;
    cancelAnimationFrame(raf);
  };
  let inView = false;
  new IntersectionObserver((en) => {
    inView = en[0].isIntersecting;
    inView ? start() : stop();
  }).observe(el);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : inView && start()));
}

function renderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: !weak, alpha: true, powerPreference: "high-performance" });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, weak ? 1.25 : 1.75));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  return r;
}

function glowSprite(color, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, color);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ====================================================================== */
/* HERO                                                                    */
/* ====================================================================== */

function heroScene() {
  const canvas = document.getElementById("hero3d");
  if (!canvas) return;
  const hero = canvas.parentElement;
  const R = renderer(canvas);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050d22, 0.045);
  const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  cam.position.set(0, 0, 12);

  scene.add(new THREE.AmbientLight(0x8fb4ff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 6, 8);
  scene.add(key);
  const cyan = new THREE.PointLight(0x38bdf8, 60, 30);
  cyan.position.set(-6, 2, 4);
  scene.add(cyan);
  const indigo = new THREE.PointLight(0x6366f1, 70, 30);
  indigo.position.set(6, -3, 3);
  scene.add(indigo);

  const world = new THREE.Group();
  scene.add(world);

  /* Network globe: wireframe sphere, glowing nodes, and arcs between them. */
  const globe = new THREE.Group();
  world.add(globe);
  const gr = 2.6;
  const ico = new THREE.IcosahedronGeometry(gr, 3);
  globe.add(new THREE.LineSegments(new THREE.WireframeGeometry(ico), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.12 })));
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(gr * 0.97, 48, 48),
    new THREE.MeshPhysicalMaterial({ color: 0x0a1a3d, roughness: 0.35, metalness: 0.2, transparent: true, opacity: 0.55, clearcoat: 1, emissive: 0x0b2a6b, emissiveIntensity: 0.4 }),
  );
  globe.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite("rgba(56,189,248,0.45)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  halo.scale.setScalar(gr * 4.2);
  globe.add(halo);

  const nodeCount = 26;
  const nodes = [];
  const nodeGeo = new THREE.SphereGeometry(0.055, 12, 12);
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd });
  const spr = glowSprite("rgba(56,189,248,0.9)", 64);
  for (let i = 0; i < nodeCount; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / nodeCount);
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const p = new THREE.Vector3().setFromSphericalCoords(gr * 1.01, phi, th);
    const m = new THREE.Mesh(nodeGeo, nodeMat);
    m.position.copy(p);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spr, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(0.42);
    m.add(s);
    globe.add(m);
    nodes.push(p);
  }
  const arcs = [];
  const arcMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
  const pulseGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 16; i++) {
    const a = nodes[(i * 7) % nodeCount];
    const b = nodes[(i * 7 + 5 + (i % 4)) % nodeCount];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.setLength(gr * (1.25 + a.distanceTo(b) * 0.09));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), arcMat));
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    const ps = new THREE.Sprite(new THREE.SpriteMaterial({ map: spr, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ps.scale.setScalar(0.35);
    pulse.add(ps);
    globe.add(pulse);
    arcs.push({ curve, pulse, t: Math.random(), speed: 0.18 + Math.random() * 0.22 });
  }

  /* Orbit rings */
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(gr * 1.55, 0.008, 8, 160), ringMat);
  ring1.rotation.set(1.25, 0.2, 0);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(gr * 1.85, 0.006, 8, 160), ringMat.clone());
  ring2.material.color.set(0x38bdf8);
  ring2.rotation.set(1.7, -0.5, 0.3);
  globe.add(ring1, ring2);
  const sat1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), new THREE.MeshBasicMaterial({ color: 0xa5b4fc }));
  const sat2 = sat1.clone();
  sat2.material = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
  [sat1, sat2].forEach((s) => {
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: spr, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.scale.setScalar(0.6);
    s.add(g);
  });
  ring1.add(sat1);
  ring2.add(sat2);

  /* Floating supply objects: gear, oil drum, bearing, bolt, PPE helmet. */
  const steel = new THREE.MeshPhysicalMaterial({ color: 0xc9d2de, metalness: 0.9, roughness: 0.28, clearcoat: 0.6 });
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x2a66c9, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
  const amber = new THREE.MeshPhysicalMaterial({ color: 0xf5b544, metalness: 0.2, roughness: 0.35, clearcoat: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, metalness: 0, roughness: 0.05, transmission: 0.9, thickness: 0.6, transparent: true, opacity: 0.8, ior: 1.4 });

  function gear(teeth = 12, r = 0.7) {
    const s = new THREE.Shape();
    const inner = r * 0.78;
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * Math.PI * 2;
      const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 ? inner : r;
      if (i === 0) s.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
      s.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
      s.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, r * 0.28, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 6 });
    g.center();
    return new THREE.Mesh(g, steel);
  }
  function drum() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 40), blue));
    for (const y of [-0.5, -0.18, 0.18, 0.5]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.425, 0.022, 8, 40), steel);
      rib.rotation.x = Math.PI / 2;
      rib.position.y = y;
      g.add(rib);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), steel);
    cap.position.set(0.2, 0.56, 0.05);
    g.add(cap);
    return g;
  }
  function bearing() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 16, 60), steel));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 16, 60), steel));
    const ball = new THREE.SphereGeometry(0.085, 16, 16);
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(ball, glass);
      const a = (i / 10) * Math.PI * 2;
      b.position.set(Math.cos(a) * 0.435, Math.sin(a) * 0.435, 0);
      g.add(b);
    }
    return g;
  }
  function bolt() {
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 6), steel);
    head.position.y = 0.42;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.8, 20), steel);
    g.add(head, shaft);
    for (let i = 0; i < 7; i++) {
      const th = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 6, 20), steel);
      th.rotation.x = Math.PI / 2;
      th.position.y = -0.35 + i * 0.08;
      g.add(th);
    }
    return g;
  }
  function helmet() {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), amber);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.04, 40), amber);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 1.0), amber);
    ridge.position.y = 0.36;
    ridge.scale.set(1, 1, 0.92);
    g.add(dome, brim);
    return g;
  }

  const items = [
    { m: gear(14, 0.75), p: [-6.9, -3.8, -0.5], s: 1, spin: [0, 0, 0.5] },
    { m: drum(), p: [4.6, 2.2, -0.5], s: 0.9, spin: [0.2, 0.4, 0.1] },
    { m: bearing(), p: [3.9, -2.4, 1], s: 0.95, spin: [0.3, 0.5, 0] },
    { m: bolt(), p: [-1.2, -3.9, 0.6], s: 0.9, spin: [0.4, 0.3, 0.6] },
    { m: helmet(), p: [0.4, 3.9, -1.5], s: 0.75, spin: [0.2, 0.5, 0.1] },
    { m: gear(10, 0.5), p: [1.9, 3.3, -2], s: 0.8, spin: [0, 0, -0.7] },
  ];
  items.forEach((it, i) => {
    it.m.position.set(...it.p);
    it.m.scale.setScalar(it.s);
    it.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    it.base = new THREE.Vector3(...it.p);
    it.phase = i * 1.3;
    world.add(it.m);
  });

  /* Particles */
  const n = weak ? 500 : 1400;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c1 = new THREE.Color(0x38bdf8);
  const c2 = new THREE.Color(0x6366f1);
  const c3 = new THREE.Color(0xffffff);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 30;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 18;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 16 - 3;
    const c = [c1, c2, c3][i % 3];
    col.set([c.r, c.g, c.b], i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const dust = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.8, map: glowSprite("rgba(255,255,255,0.8)", 32), depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  /* Layout: globe sits to the right on wide screens, centred and quieter on phones. */
  let wide = true;
  const resize = () => {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    R.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    wide = w > 1080;
    globe.position.set(wide ? 3.3 : 0, wide ? 0 : small ? 1.6 : 0.6, 0);
    globe.scale.setScalar(wide ? 1 : small ? 0.72 : 0.85);
    items.forEach((it) => (it.m.visible = wide || !small || it.s >= 0.9));
    cam.position.z = wide ? 12 : small ? 14 : 13;
  };
  resize();
  addEventListener("resize", resize);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / innerWidth - 0.5) * 2;
    mouse.ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  const speed = reduced ? 0 : 1;
  whenVisible(hero, (dt, t) => {
    const sy = Math.min(1, scrollY / innerHeight);
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    cam.position.x = mouse.x * 0.8;
    cam.position.y = -mouse.y * 0.5 - sy * 1.2;
    cam.lookAt(0, -sy * 1.2, 0);

    globe.rotation.y += dt * 0.12 * speed * (1 + sy * 3);
    globe.rotation.x = 0.25 + mouse.y * 0.1;
    ring1.rotation.z += dt * 0.35 * speed;
    ring2.rotation.z -= dt * 0.25 * speed;
    sat1.position.set(Math.cos(t * 0.6) * gr * 1.55, Math.sin(t * 0.6) * gr * 1.55, 0);
    sat2.position.set(Math.cos(-t * 0.45) * gr * 1.85, Math.sin(-t * 0.45) * gr * 1.85, 0);
    arcs.forEach((a) => {
      a.t = (a.t + dt * a.speed * speed) % 1;
      a.pulse.position.copy(a.curve.getPoint(a.t));
    });
    halo.material.opacity = 0.45 + Math.sin(t * 1.4) * 0.1;

    items.forEach((it) => {
      it.m.rotation.x += dt * it.spin[0] * speed;
      it.m.rotation.y += dt * it.spin[1] * speed;
      it.m.rotation.z += dt * it.spin[2] * speed;
      it.m.position.y = it.base.y + Math.sin(t * 0.8 + it.phase) * 0.25 * speed + sy * 2.5 * (it.base.y > 0 ? 1 : -1);
      it.m.position.x = it.base.x * (wide ? 1 : 0.7) + mouse.x * 0.3;
    });
    dust.rotation.y += dt * 0.015 * speed;
    dust.position.y = sy * 2;
    R.render(scene, cam);
  });
  requestAnimationFrame(() => canvas.classList.add("ready"));
}

/* ====================================================================== */
/* SUPPLY NETWORK SIMULATION                                               */
/* ====================================================================== */

function simScene() {
  const canvas = document.getElementById("sim3d");
  const stageEl = document.querySelector("[data-sim-stage]");
  if (!canvas || !stageEl) return;
  const labelsEl = document.querySelector("[data-sim-labels]");
  const routesEl = document.querySelector("[data-sim-routes]");
  const movingEl = document.querySelector("[data-sim-moving]");
  const doneEl = document.querySelector("[data-sim-done]");

  const R = renderer(canvas);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050d22, 18, 42);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  scene.add(new THREE.AmbientLight(0x9cc3ff, 0.7));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6);
  dl.position.set(4, 10, 6);
  scene.add(dl);

  const world = new THREE.Group();
  scene.add(world);

  /* Map positions from real longitude/latitude (roughly Tanzania), centred on the hub. */
  const geo = (lon, lat) => new THREE.Vector3((lon - 36.4) * 1.25, 0, -(lat + 6.6) * 1.25);
  const HUB = { id: "hub", name: "TRIUMPH warehouse", pos: geo(39.1, -6.95), hub: true };
  const PORT = { id: "port", name: "Dar es Salaam port", pos: geo(40.2, -6.1), port: true };
  const SITES = [
    { id: "mining", name: "Gold mines · Geita", pos: geo(32.2, -2.9), color: 0xf5b544, css: "#f5b544", what: "Spares, lubricants, PPE" },
    { id: "sugar", name: "Sugar estate · Kilombero", pos: geo(36.9, -7.8), color: 0x34d399, css: "#34d399", what: "Lime, chemicals, chains" },
    { id: "cement", name: "Cement plant · Tanga", pos: geo(39.0, -4.9), color: 0xa5b4fc, css: "#a5b4fc", what: "Kiln lubricants, belts" },
    { id: "gas", name: "Gas plant · Mtwara", pos: geo(40.1, -10.3), color: 0xf472b6, css: "#f472b6", what: "Valves, seals, FR PPE" },
    { id: "coal", name: "Coal & cement · Mbeya", pos: geo(33.45, -8.9), color: 0x22d3ee, css: "#22d3ee", what: "Filters, bearings, oils" },
  ];

  /* Ground: soft glowing disc + grid */
  const groundTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(256, 256, 20, 256, 256, 256);
    grd.addColorStop(0, "rgba(42,102,201,0.55)");
    grd.addColorStop(0.55, "rgba(28,76,155,0.22)");
    grd.addColorStop(1, "rgba(5,13,34,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  world.add(ground);
  const grid = new THREE.GridHelper(32, 40, 0x38bdf8, 0x1e3a8a);
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  world.add(grid);

  /* Coastline hint (Indian Ocean side) */
  const coast = [
    [39.2, -4.6], [39.0, -5.1], [38.9, -5.8], [39.2, -6.4], [39.5, -6.8], [39.4, -7.4], [39.3, -8.0], [39.6, -8.8], [39.8, -9.6], [40.4, -10.4],
  ].map(([lo, la]) => geo(lo + 0.35, la).setY(0.01));
  const coastLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(coast).getPoints(80)), new THREE.LineDashedMaterial({ color: 0x7dd3fc, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.5 }));
  coastLine.computeLineDistances();
  world.add(coastLine);

  const spr = glowSprite("rgba(56,189,248,0.9)", 64);
  const nodeObjs = {};
  function pillar(node, color, h) {
    const g = new THREE.Group();
    g.position.copy(node.pos);
    const mat = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.3, transparent: true, opacity: 0.9 });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, h, 16), mat);
    col.position.y = h / 2;
    g.add(col);
    const top = new THREE.Sprite(new THREE.SpriteMaterial({ map: spr, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    top.scale.setScalar(0.9);
    top.position.y = h;
    g.add(top);
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = 0.02;
    g.add(pulse);
    g.userData = { pulse, top, mat, h };
    world.add(g);
    return g;
  }

  /* The hub: a small glowing warehouse */
  const hubG = new THREE.Group();
  hubG.position.copy(HUB.pos);
  const whMat = new THREE.MeshPhysicalMaterial({ color: 0x1c4c9b, metalness: 0.5, roughness: 0.3, clearcoat: 1, emissive: 0x1c4c9b, emissiveIntensity: 0.5 });
  const wh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), whMat);
  wh.position.y = 0.25;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.32, 4), new THREE.MeshPhysicalMaterial({ color: 0xc9d2de, metalness: 0.8, roughness: 0.25 }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.68);
  roof.position.y = 0.66;
  hubG.add(wh, roof);
  const hubGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite("rgba(56,189,248,0.7)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  hubGlow.scale.setScalar(3.2);
  hubGlow.position.y = 0.4;
  hubG.add(hubGlow);
  const hubPulse = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  hubPulse.rotation.x = -Math.PI / 2;
  hubPulse.position.y = 0.02;
  hubG.add(hubPulse);
  world.add(hubG);
  nodeObjs.hub = hubG;
  nodeObjs.port = pillar(PORT, 0x7dd3fc, 0.8);
  SITES.forEach((s) => (nodeObjs[s.id] = pillar(s, s.color, 1.1)));

  /* Routes as glowing arcs */
  const routes = [];
  function arc(a, b, color, lift) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = lift ?? 0.6 + a.distanceTo(b) * 0.16;
    const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(0.05), mid, b.clone().setY(0.05));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.025, 8, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    world.add(tube);
    return { curve, tube };
  }
  const portArc = arc(PORT.pos, HUB.pos, 0x7dd3fc, 0.5);
  SITES.forEach((s) => routes.push({ site: s, ...arc(HUB.pos, s.pos, s.color) }));

  /* Moving deliveries */
  const truckGeo = new THREE.BoxGeometry(0.22, 0.12, 0.12);
  const packets = [];
  let moving = 0;
  let done = 0;
  function spawn(route, isPort) {
    const color = isPort ? 0xffffff : route.site.color;
    const m = new THREE.Mesh(truckGeo, new THREE.MeshBasicMaterial({ color }));
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: spr, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.scale.setScalar(0.7);
    m.add(g);
    world.add(m);
    const curve = isPort ? portArc.curve : route.curve;
    const len = curve.getLength();
    packets.push({ m, curve, route: isPort ? null : route, t: 0, speed: 1.4 / len + Math.random() * 0.03 });
    if (!isPort) moving++;
  }

  /* Route picker */
  let focus = null;
  if (routesEl) {
    routesEl.innerHTML =
      `<button class="sim-route" aria-pressed="true" data-r=""><i style="--c:#38bdf8"></i><span>All routes</span></button>` +
      SITES.map((s) => `<button class="sim-route" aria-pressed="false" data-r="${s.id}"><i style="--c:${s.css}"></i><span>${s.name.split(" · ")[0]}<br><small style="opacity:.65">${s.what}</small></span></button>`).join("");
    routesEl.addEventListener("click", (e) => {
      const b = e.target.closest(".sim-route");
      if (!b) return;
      focus = b.dataset.r || null;
      routesEl.querySelectorAll(".sim-route").forEach((x) => x.setAttribute("aria-pressed", x === b));
    });
  }

  /* HTML labels that follow their 3D point */
  const labelNodes = [HUB, PORT, ...SITES];
  const labels = labelNodes.map((n) => {
    const el = document.createElement("span");
    el.className = `sim-label${n.hub ? " hub" : ""}`;
    el.textContent = n.name;
    labelsEl && labelsEl.append(el);
    return { n, el };
  });
  /* Short labels on phones, so they don't run into each other. */
  const shortName = (n) => (n.hub ? "TRIUMPH" : n.port ? "Port" : n.name.split(" · ")[1]);
  const setLabelText = () => {
    const narrow = stageEl.clientWidth < 560;
    labels.forEach(({ n, el }) => (el.textContent = narrow ? shortName(n) : n.name));
  };
  setLabelText();
  new ResizeObserver(setLabelText).observe(stageEl);

  /* Drag to rotate, with inertia */
  let rotY = -0.35;
  let vel = 0;
  let drag = null;
  stageEl.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, locked: null };
    stageEl.setPointerCapture(e.pointerId);
  });
  stageEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.locked === null && Math.abs(dx) + Math.abs(dy) > 6) drag.locked = Math.abs(dx) > Math.abs(dy);
    if (drag.locked) {
      vel = dx * 0.005;
      rotY += vel;
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  });
  const end = () => (drag = null);
  stageEl.addEventListener("pointerup", end);
  stageEl.addEventListener("pointercancel", end);

  const resize = () => {
    const w = stageEl.clientWidth;
    const h = stageEl.clientHeight;
    R.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(stageEl);

  const camTarget = new THREE.Vector3(0, 10.5, 12);
  cam.position.copy(camTarget).multiplyScalar(stageEl.clientWidth < 560 ? 1.25 : 1);
  const lookAt = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let spawnClock = 0;
  let portClock = 0;
  const speed = reduced ? 0.25 : 1;

  for (let i = 0; i < 6; i++) spawn(routes[i % routes.length]);
  packets.forEach((p) => (p.t = Math.random() * 0.8));

  whenVisible(stageEl, (dt, t) => {
    if (!drag) {
      vel *= 0.94;
      rotY += vel + dt * 0.05 * speed;
    }
    world.rotation.y = rotY;

    /* Camera eases toward the chosen route */
    const fr = focus && routes.find((r) => r.site.id === focus);
    if (fr) {
      tmp.copy(fr.site.pos).add(HUB.pos).multiplyScalar(0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      lookAt.lerp(tmp, 0.05);
      camTarget.set(lookAt.x, 9.5, lookAt.z + 9.5);
    } else {
      lookAt.lerp(tmp.set(0, 0, 0), 0.05);
      camTarget.set(0, 10.5, 12);
    }
    const narrow = stageEl.clientWidth < 560;
    cam.position.lerp(narrow ? tmp.copy(camTarget).multiplyScalar(1.25) : camTarget, 0.05);
    cam.lookAt(lookAt);

    /* Spawn new deliveries */
    spawnClock += dt * speed;
    portClock += dt * speed;
    if (spawnClock > 0.9) {
      spawnClock = 0;
      const pool = fr ? [fr, fr, routes[(Math.random() * routes.length) | 0]] : routes;
      spawn(pool[(Math.random() * pool.length) | 0]);
    }
    if (portClock > 2.2) {
      portClock = 0;
      spawn(null, true);
    }

    /* Move deliveries */
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.t += dt * p.speed * speed;
      if (p.t >= 1) {
        world.remove(p.m);
        p.m.geometry !== truckGeo && p.m.geometry.dispose();
        p.m.material.dispose();
        packets.splice(i, 1);
        if (p.route) {
          moving--;
          done++;
          const o = nodeObjs[p.route.site.id];
          o.userData.flash = 1;
        } else nodeObjs.hub.userData.flash = 1;
        continue;
      }
      const pt = p.curve.getPoint(p.t);
      p.m.position.copy(pt);
      p.m.lookAt(p.curve.getPoint(Math.min(1, p.t + 0.01)));
      const dim = fr && p.route && p.route !== fr;
      p.m.visible = !dim;
    }

    /* Highlight the chosen route, pulse the nodes */
    routes.forEach((r) => {
      const on = !fr || r === fr;
      r.tube.material.opacity += ((on ? (fr ? 0.95 : 0.55) : 0.08) - r.tube.material.opacity) * 0.1;
    });
    Object.values(nodeObjs).forEach((o, i) => {
      const u = o.userData;
      const pulse = u.pulse || hubPulse;
      const k = ((t * 0.6 + i * 0.17) % 1);
      pulse.scale.setScalar(1 + k * 2.2);
      pulse.material.opacity = 0.7 * (1 - k);
      if (u.flash) {
        u.flash = Math.max(0, u.flash - dt * 2);
        if (u.top) u.top.scale.setScalar(0.9 + u.flash * 1.2);
        else hubGlow.scale.setScalar(3.2 + u.flash * 1.5);
      }
    });

    R.render(scene, cam);

    /* Labels */
    const w = stageEl.clientWidth;
    const h = stageEl.clientHeight;
    labels.forEach(({ n, el }) => {
      const o = nodeObjs[n.id];
      tmp.set(0, n.hub ? 0.9 : (o.userData.h || 1) + 0.25, 0);
      o.localToWorld(tmp);
      tmp.project(cam);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
      el.style.visibility = vis ? "visible" : "hidden";
      const dim = fr && !n.hub && !n.port && n.id !== fr.site.id;
      el.classList.toggle("dim", !!dim);
      el.classList.toggle("hot", !!fr && n.id === fr.site.id);
    });
    if (movingEl) movingEl.textContent = moving;
    if (doneEl) doneEl.textContent = done;
  });
}
