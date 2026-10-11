/**
 * The "Architecture" background: a city skyline in three layers (far towers, the middle row with a
 * domed hall, a spire and a crane, and low buildings in front), drawn in the company's colours and
 * fading upwards into the page. The far layer drifts slowly and a few windows light up and dim.
 * Pure SVG, no images; deterministic so server and browser draw the same picture.
 */

type B = [x: number, w: number, h: number];

const GROUND = 400;

// Far layer: tall, thin towers (drawn twice side by side so the slow drift never shows an edge).
const FAR: B[] = [
  [0, 46, 190], [52, 34, 250], [92, 58, 205], [156, 30, 300], [192, 52, 230], [250, 40, 275],
  [298, 64, 210], [368, 36, 320], [410, 54, 240], [470, 42, 288], [520, 70, 225], [596, 34, 340],
  [636, 56, 260], [698, 44, 300], [748, 66, 215], [820, 38, 330], [864, 52, 250], [922, 46, 290],
  [974, 72, 220], [1052, 36, 310], [1094, 58, 245], [1158, 40, 285], [1204, 64, 230], [1274, 34, 325],
  [1314, 56, 255], [1376, 64, 280],
];

// Middle layer: the main row, with windows.
const MID: B[] = [
  [20, 92, 170], [124, 70, 225], [206, 104, 150], [322, 66, 260], [400, 120, 135],
  [740, 84, 205], [836, 62, 280], [910, 110, 160], [1032, 78, 240], [1122, 96, 180], [1230, 70, 215],
  [1312, 110, 150],
];

// Front layer: low, wide buildings.
const NEAR: B[] = [
  [0, 140, 70], [150, 90, 95], [250, 160, 60], [420, 110, 85], [880, 130, 80], [1020, 100, 100],
  [1130, 170, 65], [1310, 130, 90],
];

const rect = ([x, w, h]: B) => `M${x} ${GROUND}V${GROUND - h}H${x + w}V${GROUND}Z`;

/** Window grid for one middle building; every few windows "twinkle" (deterministic pattern). */
function windows([x, w, h]: B, bi: number) {
  const out: { x: number; y: number; t: number }[] = [];
  const cols = Math.max(2, Math.floor((w - 12) / 14));
  const rows = Math.max(2, Math.floor((h - 26) / 20));
  const gap = (w - cols * 6) / (cols + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = (r * 7 + c * 3 + bi * 5) % 11;
      if (k > 6) continue; // some windows stay dark
      out.push({ x: x + gap + c * (6 + gap), y: GROUND - h + 16 + r * 20, t: k === 0 ? 1 : k === 3 ? 2 : 0 });
    }
  }
  return out;
}

export function ArchitectureScene() {
  const farPath = FAR.map(rect).join("") + FAR.map(([x, w, h]) => rect([x + 1440, w, h])).join("");
  const midPath = MID.map(rect).join("");
  const nearPath = NEAR.map(rect).join("");
  const wins = MID.flatMap((b, i) => windows(b, i));
  return (
    <svg className="arch" viewBox="0 0 1440 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="arch-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="arch-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1440" height="400">
          <rect x="0" y="0" width="1440" height="400" fill="url(#arch-fade)" />
        </mask>
      </defs>
      <g mask="url(#arch-mask)">
        {/* Blueprint lines: the drawing the city was built from. */}
        <g className="a-plan">
          <path d="M0 120H1440M0 200H1440M0 280H1440M240 0V400M600 0V400M960 0V400M1200 0V400" />
          <circle cx="660" cy="250" r="118" />
          <path d="M542 250H778M660 132V368" />
        </g>
        <g className="a-far-move">
          <path className="a-far" d={farPath} />
        </g>
        <g className="a-mid">
          <path d={midPath} />
          {/* Domed hall with columns. */}
          <path d="M540 400V300H780V400Z" />
          <path d="M556 300C556 214 764 214 764 300Z" />
          <path d="M648 228C648 200 672 200 672 228Z" />
          <path d="M657 204V178H663V204Z" />
          <path d="M530 300H790V290H530Z" />
          {/* Spire on the tall tower. */}
          <path d="M836 120L867 52L898 120Z" />
          <path d="M865 52V18H869V52Z" />
          {/* Stepped tower. */}
          <path d="M1060 160V140H1082V160ZM1066 140V118H1076V140Z" />
          {/* Crane: still building. */}
          <path d="M300 400V96H306V400Z" />
          <path d="M240 98H420V104H240Z" />
          <path d="M303 96L330 70L357 96" fill="none" className="a-line" />
          <path d="M398 104V150" fill="none" className="a-line" />
          <path d="M390 150H406V162H390Z" />
        </g>
        <g className="a-cols">
          {[566, 596, 626, 656, 686, 716, 746].map((x) => (
            <path key={x} d={`M${x} 310V400H${x + 10}V310Z`} />
          ))}
        </g>
        <g className="a-win">
          {wins.map((w, i) => (
            <rect key={i} x={w.x} y={w.y} width="6" height="9" rx="1" className={w.t ? `tw tw${w.t}` : undefined} />
          ))}
        </g>
        <path className="a-near" d={nearPath} />
        {/* Arched bridge in front. */}
        <path className="a-near" d="M530 400V372C560 342 600 342 630 372V400H650V372C680 342 720 342 750 372V400H770V360H510V400Z" />
      </g>
    </svg>
  );
}
