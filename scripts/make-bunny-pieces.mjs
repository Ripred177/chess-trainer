/**
 * Generates the "Bunny" piece set.
 *
 * Nothing rabbit-themed exists upstream, so this set is drawn here. It is
 * generated rather than hand-written so the white and black variants can never
 * drift apart: one description of each piece, rendered twice with a different
 * palette.
 *
 * Design rules, so the set stays playable rather than merely cute:
 *
 * - Every piece shares a base, a body, and a head, which makes them read as one
 *   family.
 * - Rank is carried by ears, headgear, and height together, because ears alone
 *   are not enough to separate a king from a queen at 40px. Height rises
 *   steadily from pawn to king, and only the king carries a cross.
 * - Interior detail is stroked in a colour that contrasts with the fill, the
 *   way the classic Cburnett set does, so black pieces are not just blobs.
 *
 * Output: src/renderer/public/pieces/bunny/{w,b}{K,Q,R,B,N,P}.svg
 * Usage:  node scripts/make-bunny-pieces.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'src/renderer/public/pieces/bunny')

/** 45x45 matches the Cburnett convention, so the set scales like every other. */
const VIEWBOX = '0 0 45 45'

const PALETTES = {
  w: { fill: '#ffffff', stroke: '#000000', detail: '#000000', accent: '#f2a8b0' },
  b: { fill: '#1c1c1c', stroke: '#000000', detail: '#ffffff', accent: '#b8626c' }
}

const CX = 22.5

// ---------------------------------------------------------------- parts ----

/**
 * Foot and waist as a single silhouette.
 *
 * Drawing the collar as a separate slab made the white pieces look like stacked
 * plates, so the waist is now a narrowing of the same shape.
 */
function base(width = 1) {
  const half = 9.6 * width
  const waist = 6.2 * width
  return (
    `<path d="M${CX - half} 40.4h${half * 2}` +
    `a1.6 1.6 0 0 0 1.5-2.2l-1.1-2.7a2 2 0 0 0-1.3-1.2l-${half - waist} -.6` +
    `h-${waist * 2}l-${half - waist} .6a2 2 0 0 0-1.3 1.2l-1.1 2.7a1.6 1.6 0 0 0 1.5 2.2z"/>`
  )
}

/** Ears, mirrored around the centre line. `h` is how far above the head they reach. */
function ears(kind, headTop, h) {
  const t = headTop
  switch (kind) {
    case 'short':
      return (
        `<path d="M${CX - 2.9} ${t + .6}c-1-2.2-1.2-4.4-.4-5.4.8-1 1.8-.1 2 1.8.2 1.6.1 2.9-.1 3.7z"/>` +
        `<path d="M${CX + 2.9} ${t + .6}c1-2.2 1.2-4.4.4-5.4-.8-1-1.8-.1-2 1.8-.2 1.6-.1 2.9.1 3.7z"/>`
      )
    case 'tall':
      // Splayed outward so headgear has somewhere to sit without hiding them.
      return (
        `<path d="M${CX - 2.6} ${t + .5}c-2-${h * .5}-3-${h * .95}-2.1-${h * 1.08} .9-.13 2.4.5 3.2 ${h * .4}.5 ${h * .3}.5 ${h * .5}.2 ${h * .6}z"/>` +
        `<path d="M${CX + 2.6} ${t + .5}c2-${h * .5} 3-${h * .95} 2.1-${h * 1.08}-.9-.13-2.4.5-3.2 ${h * .4}-.5 ${h * .3}-.5 ${h * .5}-.2 ${h * .6}z"/>`
      )

    case 'lop':
      // Drooping ears. The silhouette difference from upright ears is what
      // separates the queen from the king at board size.
      return (
        `<path d="M${CX - 3.2} ${t + 1.4}c-2.4-2.6-6.2-2.2-7.4 1.2-1.2 3.4.2 6.2 2.2 6.1 2.1-.1 4-3.1 5.2-7.3z"/>` +
        `<path d="M${CX + 3.2} ${t + 1.4}c2.4-2.6 6.2-2.2 7.4 1.2 1.2 3.4-.2 6.2-2.2 6.1-2.1-.1-4-3.1-5.2-7.3z"/>`
      )
    case 'square':
      // Battlements: stubby rectangular ears echoing a rook's crenellations.
      return (
        `<path d="M${CX - 5.2} ${t + 1}V${t - 5.6}h3.5v${6.6}z"/>` +
        `<path d="M${CX + 1.7} ${t + 1}V${t - 5.6}h3.5v${6.6}z"/>`
      )
    case 'swept':
      // Asymmetric: one upright, one laid back, so the knight reads at a glance
      // even beside a bishop.
      return (
        `<path d="M${CX - 3} ${t + .6}c-1.6-3.6-1.8-7-.8-8.1 1-1.1 2.2.2 2.5 3.2.2 2.5.1 4.2-.2 4.9z"/>` +
        `<path d="M${CX + 2.5} ${t + .8}c2.7-2.7 5.2-4.7 6.5-4.5 1.3.2.8 1.9-1.8 3.9-2 1.5-3.6 2.2-4.3 2.4z"/>`
      )
    default:
      return ''
  }
}

/** Pink inner ear, inset from the outer shape. */
function innerEars(kind, headTop, h, p) {
  if (kind === 'square') return ''
  const t = headTop
  let inner
  if (kind === 'tall') {
    inner =
      `<path d="M${CX - 2.2} ${t - .5}c-.9-${h * .45}-1-${h * .8}-.5-${h * .88} .5-.08 1.2.3 1.4 ${h * .35}.1 ${h * .26} 0 ${h * .42}-.2 ${h * .5}z"/>` +
      `<path d="M${CX + 2.2} ${t - .5}c.9-${h * .45} 1-${h * .8} .5-${h * .88}-.5-.08-1.2.3-1.4 ${h * .35}-.1 ${h * .26} 0 ${h * .42}.2 ${h * .5}z"/>`
  } else if (kind === 'lop') {
    inner =
      `<path d="M${CX - 3.6} ${t + 2.4}c-1.7-1.6-4.2-1.3-5 1-.8 2.3 0 4.1 1.3 4 1.4-.1 2.7-2.1 3.7-5z"/>` +
      `<path d="M${CX + 3.6} ${t + 2.4}c1.7-1.6 4.2-1.3 5 1 .8 2.3 0 4.1-1.3 4-1.4-.1-2.7-2.1-3.7-5z"/>`
  } else if (kind === 'swept') {
    inner = `<path d="M${CX - 2.4} ${t - .4}c-.9-2.6-1-4.9-.5-5.6.5-.7 1.2.2 1.4 2.2.1 1.7 0 2.8-.2 3.4z"/>`
  } else {
    inner =
      `<path d="M${CX - 2.3} ${t - .3}c-.6-1.5-.6-3-.3-3.6.4-.7 1 .1 1.2 1.3.1 1 0 1.9-.1 2.3z"/>` +
      `<path d="M${CX + 2.3} ${t - .3}c.6-1.5.6-3 .3-3.6-.4-.7-1 .1-1.2 1.3-.1 1 0 1.9.1 2.3z"/>`
  }
  return `<g fill="${p.accent}" stroke="none" opacity=".9">${inner}</g>`
}

/** Eyes, nose, and whiskers, in the contrasting detail colour. */
function face(cy, r, p) {
  const eyeY = cy - .6
  const noseY = cy + 1.8
  const dx = r * .48
  const eyeR = Math.max(.62, r * .18)
  return (
    `<circle cx="${CX - dx}" cy="${eyeY}" r="${eyeR}" fill="${p.detail}" stroke="none"/>` +
    `<circle cx="${CX + dx}" cy="${eyeY}" r="${eyeR}" fill="${p.detail}" stroke="none"/>` +
    `<path d="M${CX - 1.05} ${noseY}h2.1l-1.05 1.25z" fill="${p.accent}" stroke="${p.detail}" stroke-width=".45" stroke-linejoin="round"/>` +
    `<path d="M${CX} ${noseY + 1.25}v.9" stroke="${p.detail}" stroke-width=".55" fill="none"/>` +
    `<path d="M${CX - r - .4} ${noseY - .3}h2M${CX - r - .2} ${noseY + 1}l1.8-.5` +
    `M${CX + r + .4} ${noseY - .3}h-2M${CX + r + .2} ${noseY + 1}l-1.8-.5"` +
    ` stroke="${p.detail}" stroke-width=".5" stroke-linecap="round" fill="none"/>`
  )
}

/** Head, ears, inner ears, and face as one unit. */
function head(cy, r, earKind, earHeight, p) {
  const top = cy - r
  return (
    ears(earKind, top, earHeight) +
    `<circle cx="${CX}" cy="${cy}" r="${r}"/>` +
    innerEars(earKind, top, earHeight, p) +
    face(cy, r, p)
  )
}

function body(cy, rx, ry) {
  return `<ellipse cx="${CX}" cy="${cy}" rx="${rx}" ry="${ry}"/>`
}

// --------------------------------------------------------------- pieces ----
//
// Heights are deliberately staged: pawn 4.2 → knight/bishop ~5 → rook ~5 →
// queen 5.2 → king 5.4, with the headgear adding the final separation.

const PIECES = {
  // Smallest of the family: a sitting kit with short ears.
  P: (p) => base(0.82) + body(28.2, 5.7, 5.2) + head(19.6, 4.2, 'short', 5, p),

  N: (p) =>
    base(0.92) +
    body(26.4, 6.6, 6) +
    head(16.4, 5, 'swept', 7, p) +
    // A carrot held at the shoulder — the clearest "knight" marker available
    // once the horse's head is off the table.
    `<path d="M15.4 27.2c-2.7 1-5 2.3-4.7 3.2.3 1 3.1.8 5.8-.2z" fill="${p.accent}" stroke="${p.stroke}" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<path d="M11 30.5c-1.3.2-2.3.7-2.2 1.2M10.7 29.2c-1.2-.4-2.2-.4-2.5.1" stroke="${p.stroke}" stroke-width=".9" stroke-linecap="round" fill="none"/>`,

  B: (p) =>
    base(0.94) +
    body(26, 6.6, 6.1) +
    head(15.8, 5, 'tall', 9, p) +
    // Mitre slit across the body, as on a conventional bishop.
    `<path d="M${CX} 22.4v6" stroke="${p.detail}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`,

  R: (p) =>
    base(1) +
    // Squarer body so the whole piece reads as masonry.
    `<path d="M16.2 31.4V20.6h12.6v10.8z"/>` +
    `<path d="M16.2 25.6h12.6" stroke="${p.detail}" stroke-width=".8" fill="none"/>` +
    head(15.4, 5, 'square', 0, p) +
    `<path d="M17.3 10.6h10.4v2.2H17.3z"/>`,

  Q: (p) =>
    base(1) +
    body(26.6, 6.9, 6.2) +
    head(17.4, 5.2, 'lop', 0, p) +
    // Beaded tiara on the brow. No cross — that stays the king's alone.
    `<path d="M17.4 14.6l.6-3.6 2.2 2 2.3-2.8 2.3 2.8 2.2-2 .6 3.6z"/>` +
    `<circle cx="18" cy="10.4" r="1.05"/><circle cx="${CX}" cy="9.2" r="1.15"/><circle cx="27" cy="10.4" r="1.05"/>`,

  K: (p) =>
    base(1) +
    body(26.4, 6.9, 6.2) +
    head(16.4, 5.2, 'tall', 6.5, p) +
    // Crown sits on the brow rather than above the ears, so the bunny is still
    // a bunny; the cross rises through the gap the splayed ears leave.
    `<path d="M17.2 13.5v-3.3l2.4 1.8 2.9-3 2.9 3 2.4-1.8v3.3z"/>` +
    `<path d="M17.2 13.5h10.6v1.7H17.2z"/>` +
    `<path d="M${CX} 9.2V4.2M20.4 6h4.2" stroke="${p.stroke}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`
}

function render(letter, color) {
  const p = PALETTES[color]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}">` +
    `<g fill="${p.fill}" stroke="${p.stroke}" stroke-width="1.5" ` +
    `stroke-linecap="round" stroke-linejoin="round">${PIECES[letter](p)}</g></svg>`
  )
}

async function main() {
  await mkdir(OUT, { recursive: true })
  let n = 0
  for (const color of ['w', 'b']) {
    for (const letter of ['K', 'Q', 'R', 'B', 'N', 'P']) {
      await writeFile(join(OUT, `${color}${letter}.svg`), render(letter, color), 'utf8')
      n++
    }
  }
  console.log(`Wrote ${n} bunny pieces to ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
