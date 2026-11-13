/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// "Place on Face": finds the flat regions the model can actually rest on, like
// Bambu Studio's Lay on Face. A region qualifies when it is (nearly) planar and
// every vertex of the model lies on or behind its plane, i.e. the plane is a
// supporting plane of the model (a face of its convex hull).

const COS_NEIGHBOUR = Math.cos(1 * Math.PI / 180);   // adjacent triangles within 1° stay in one region
const COS_SEED      = Math.cos(2 * Math.PI / 180);   // ...and within 2° of the region's first triangle

/**
 * @param {Float32Array} pos          non-indexed positions, 9 floats per triangle
 * @param {{start:Int32Array, nbr:Int32Array}} adjacency  CSR from buildAdjacency
 * @param {Float32Array} faceNormals  3 floats per triangle (unit)
 * @param {Object} [opts]
 * @param {number} [opts.minAreaFrac=0.003]  smallest region, as a fraction of total area
 * @param {number} [opts.maxRegions=40]
 * @returns {{ regions: Array<{tris:Int32Array, normal:[number,number,number], area:number}>,
 *             triRegion: Int32Array }}   triRegion[t] = region index or -1
 */
export function findSupportFaces(pos, adjacency, faceNormals, opts = {}) {
  const { minAreaFrac = 0.003, maxRegions = 40 } = opts;
  const n = pos.length / 9;
  const { start, nbr } = adjacency;

  const area = new Float32Array(n);
  let total = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let t = 0; t < n; t++) {
    const b = t * 9;
    const ux = pos[b + 3] - pos[b], uy = pos[b + 4] - pos[b + 1], uz = pos[b + 5] - pos[b + 2];
    const vx = pos[b + 6] - pos[b], vy = pos[b + 7] - pos[b + 1], vz = pos[b + 8] - pos[b + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area[t] = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    total += area[t];
    for (let k = 0; k < 9; k += 3) {
      const x = pos[b + k], y = pos[b + k + 1], z = pos[b + k + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const tol = diag * 1e-3;

  // 1. Group triangles into near-planar regions.
  const regionOf = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const cand = [];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || area[s] === 0) continue;
    const sx = faceNormals[s * 3], sy = faceNormals[s * 3 + 1], sz = faceNormals[s * 3 + 2];
    let head = 0, tail = 0, a = 0;
    queue[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const c = queue[head++];
      a += area[c];
      const cx = faceNormals[c * 3], cy = faceNormals[c * 3 + 1], cz = faceNormals[c * 3 + 2];
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const o = nbr[k];
        if (seen[o]) continue;
        const ox = faceNormals[o * 3], oy = faceNormals[o * 3 + 1], oz = faceNormals[o * 3 + 2];
        if (cx * ox + cy * oy + cz * oz < COS_NEIGHBOUR) continue;
        if (sx * ox + sy * oy + sz * oz < COS_SEED) continue;
        seen[o] = 1; queue[tail++] = o;
      }
    }
    if (a >= total * minAreaFrac) cand.push({ seed: s, count: tail, area: a, tris: queue.slice(0, tail) });
  }

  // 2. Keep the biggest regions whose plane supports the whole model.
  cand.sort((p, q) => q.area - p.area);
  const regions = [];
  const triRegion = new Int32Array(n).fill(-1);
  for (const c of cand) {
    if (regions.length >= maxRegions) break;
    // Area-weighted mean normal and a point on the plane.
    let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0;
    for (let i = 0; i < c.tris.length; i++) {
      const t = c.tris[i], w = area[t];
      nx += faceNormals[t * 3] * w; ny += faceNormals[t * 3 + 1] * w; nz += faceNormals[t * 3 + 2] * w;
      const b = t * 9;
      px += (pos[b] + pos[b + 3] + pos[b + 6]) / 3 * w;
      py += (pos[b + 1] + pos[b + 4] + pos[b + 7]) / 3 * w;
      pz += (pos[b + 2] + pos[b + 5] + pos[b + 8]) / 3 * w;
    }
    const len = Math.hypot(nx, ny, nz); if (len === 0) continue;
    nx /= len; ny /= len; nz /= len;
    px /= c.area; py /= c.area; pz /= c.area;
    let ok = true;
    for (let i = 0; i < pos.length; i += 3) {
      if (nx * (pos[i] - px) + ny * (pos[i + 1] - py) + nz * (pos[i + 2] - pz) > tol) { ok = false; break; }
    }
    if (!ok) continue;
    const id = regions.length;
    regions.push({ tris: c.tris, normal: [nx, ny, nz], area: c.area });
    for (let i = 0; i < c.tris.length; i++) triRegion[c.tris[i]] = id;
  }
  return { regions, triRegion };
}
