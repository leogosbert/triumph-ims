/**
 * A small QR code encoder (ISO/IEC 18004, byte mode, error correction M, versions 1-20), for the
 * catalogue link printed on the PDF and shown on the share screen. No library is installed for this,
 * and links are short. Pure; tested in __tests__ (and checked against a QR reader while it was written).
 * The method follows the public-domain reference by Project Nayuki.
 */

const MAX_VERSION = 20;
// Error correction level M: codewords per block and number of blocks, by version (index 0 unused).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const FORMAT_M = 0; // format bits for level M

export type QrMatrix = { size: number; modules: boolean[][] };

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r: number[] = new Array(degree - 1).fill(0);
  r.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], div: number[]): number[] {
  const r: number[] = div.map(() => 0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** QR matrix for the text (UTF-8), or null when it is too long. `mask` forces a mask (tests). */
export function qrEncode(text: string, mask?: number): QrMatrix | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > MAX_VERSION) return null;
  const capacity = dataCodewords(ver) * 8;

  // Data bits.
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  // Error correction and interleaving.
  const nBlocks = BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= nShort) codewords.push(b[i]);
    });
  }

  // Function patterns.
  const size = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    m[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const al = alignmentPositions(ver, size);
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (mk: number) => {
    const d = (FORMAT_M << 3) | mk;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6));
    set(8, 8, bit(b, 7));
    set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      set(a, c, bit(b, i));
      set(c, a, bit(b, i));
    }
  }

  // Data modules, in the zigzag order.
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - v : v;
        if (!fn[y][x] && idx < codewords.length * 8) {
          m[y][x] = bit(codewords[idx >>> 3], 7 - (idx & 7));
          idx++;
        }
      }
  }

  const applyMask = (mk: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (fn[y][x]) continue;
        let inv: boolean;
        switch (mk) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (inv) m[y][x] = !m[y][x];
      }
  };

  let chosen = mask ?? -1;
  if (chosen < 0 || chosen > 7) {
    let best = Infinity;
    for (let mk = 0; mk < 8; mk++) {
      applyMask(mk);
      drawFormat(mk);
      const p = penalty(m, size);
      if (p < best) {
        best = p;
        chosen = mk;
      }
      applyMask(mk); // undo (XOR)
    }
  }
  applyMask(chosen);
  drawFormat(chosen);
  return { size, modules: m };
}

/** The usual mask penalty (runs, 2x2 blocks, finder-like patterns, dark/light balance). */
function penalty(m: boolean[][], size: number): number {
  let p = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    let s = 0;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) s += run - 2;
        run = 1;
      }
    }
    if (run >= 5) s += run - 2;
    const str = Array.from({ length: size }, (_, i) => (get(i) ? "1" : "0")).join("");
    for (const pat of ["10111010000", "00001011101"]) {
      let at = str.indexOf(pat);
      while (at >= 0) {
        s += 40;
        at = str.indexOf(pat, at + 1);
      }
    }
    return s;
  };
  for (let y = 0; y < size; y++) p += line((x) => m[y][x]);
  for (let x = 0; x < size; x++) p += line((y) => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  const total = size * size;
  p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return p;
}

/** SVG of the code with a quiet zone of 4 modules (one path, scales cleanly). */
export function qrSvg(text: string, opts: { scale?: number; dark?: string; light?: string } = {}): string | null {
  const q = qrEncode(text);
  if (!q) return null;
  const border = 4;
  const dim = q.size + border * 2;
  const scale = opts.scale ?? 8;
  let d = "";
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) d += `M${x + border},${y + border}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim * scale}" height="${dim * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${opts.light ?? "#ffffff"}"/><path d="${d}" fill="${opts.dark ?? "#000000"}"/></svg>`;
}
