// homography.js — map a WxH rectangle onto 4 arbitrary destination points.
//
// Math: a planar homography H is a 3x3 matrix with 8 unknowns (h33 = 1).
// Each point correspondence (sx,sy)->(dx,dy) yields 2 linear equations:
//   dx = (h11*sx + h12*sy + h13) / (h31*sx + h32*sy + 1)
//   dy = (h21*sx + h22*sy + h23) / (h31*sx + h32*sy + 1)
// Four corners → 8 equations → solve the 8x8 system with Gaussian elimination.

/** Solve A·x = b for an 8x8 system. Partial pivoting for stability. */
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;   // degenerate (corners collinear)
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // BUG FIX (found by test/run-tests.js, not by desk review — see README):
  // `row` here IS M[i], already a 1D array, so row[i] is the scalar pivot.
  // The original `row[i][i]` re-indexed that scalar, which is `undefined` in
  // JS, making every non-trivial solve return NaN. Corner-pinning was
  // therefore completely non-functional for any real drag.
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * @param {number} w, h        source element size in px
 * @param {Array}  dst         4 points [{x,y}…] in px, order TL,TR,BR,BL
 * @returns {string|null}      CSS matrix3d(...) or null if degenerate
 */
function matrix3dFor(w, h, dst) {
  const src = [ [0, 0], [w, 0], [w, h], [0, h] ];   // TL,TR,BR,BL
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
  }
  const hM = solve8(A, b);
  if (!hM) return null;
  const [h11, h12, h13, h21, h22, h23, h31, h32] = hM;
  // CSS matrix3d is column-major 4x4; z row/col are identity.
  return `matrix3d(${h11},${h21},0,${h31},` +
         `${h12},${h22},0,${h32},` +
         `0,0,1,0,` +
         `${h13},${h23},0,1)`;
}

// Works both as a browser global and a Node module (for unit tests).
if (typeof module !== 'undefined') module.exports = { matrix3dFor, solve8 };
