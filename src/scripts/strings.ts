/**
 * Plucked strings for the hero wall.
 *
 * The hero is ruled with hairlines like a pen-plotter drawing. The cursor is a hard disc (the same circle as
 * the cursor ring): lines wrap around it, stretch when you drag them, and when one slips off it snaps back
 * and rings, the wave running out along the line. Displaced stretches glow hoodie-orange, so the picture
 * reads as a signal trace, which is what the person behind this site builds dashboards for.
 *
 * Every line is a spring that returns exactly to rest, so, unlike paint, nothing is ever left behind.
 */

const DX = 8
/** Wave speed squared per substep; the explicit scheme below is stable while this stays under 0.5. */
const C2 = 0.32
const DAMP = 0.009
/**
 * Viscosity damps kinks, not the swing: the disc constraint works on discrete samples and injects a sawtooth
 * at the sample spacing, which without this keeps buzzing long after the real wave has settled.
 * Must stay under 0.25: above that the sawtooth mode flips sign every step and the scheme blows up.
 */
const VISC = 0.15
const RESTORE = 0.0012
const SUB = 3
const REVEAL_MS = 1000
const REVEAL_STAGGER = 18

const INK = '15,43,47'
const HOT = '238,125,28'
const HOT_BUCKETS = 6

type Line = {
  y: number
  u: Float32Array
  v: Float32Array
  /** 0 free, ±1 held on that side of the disc, 2 slipped off (ignored until the disc lets go of it). */
  hold: number
}

export type StringsOptions = { gap?: number }

export class Strings {
  private ctx: CanvasRenderingContext2D
  private lines: Line[] = []
  private dpr = 1
  private width = 0
  private height = 0
  private points = 0
  private x0 = 0
  private bottom = Number.POSITIVE_INFINITY
  private raf = 0
  private visible = true
  private revealAt: number | undefined
  private gap: number
  // The disc moves in substeps between frames, so a fast flick drags lines instead of teleporting through them.
  private disc = { x: -1e4, y: -1e4, r: 0 }
  private prevDisc = { x: -1e4, y: -1e4, r: 0 }
  private target = { x: -1e4, y: -1e4, r: 0 }

  constructor(
    private canvas: HTMLCanvasElement,
    opts: StringsOptions = {},
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    this.gap = opts.gap ?? 22
    this.resize()
  }

  /** Lines stop above this y (hero-local px) so the small print under the name sits on a clean wall. */
  setBottom(y: number) {
    this.bottom = y
    this.build()
  }

  resize() {
    // Hairlines need the full device resolution; at 1.5x a 1px line smears into a grey 2px one.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    const r = this.canvas.getBoundingClientRect()
    this.width = r.width
    this.height = r.height
    this.canvas.width = Math.round(r.width * this.dpr)
    this.canvas.height = Math.round(r.height * this.dpr)
    this.build()
  }

  private build() {
    // Anchor points sit just outside the canvas, so the fixed ends of every string are never visible.
    this.x0 = -DX * 2
    this.points = Math.ceil((this.width + DX * 4) / DX) + 1
    const limit = Math.min(this.height, this.bottom) - this.gap * 0.5
    const lines: Line[] = []
    for (let y = this.gap * 0.75; y < limit; y += this.gap) {
      lines.push({ y, u: new Float32Array(this.points), v: new Float32Array(this.points), hold: 0 })
    }
    this.lines = lines
    this.kick()
  }

  setVisible(v: boolean) {
    this.visible = v
    if (v) this.kick()
  }

  /** Rule the lines in from the left, top to bottom, like a plotter. */
  reveal(t = performance.now()) {
    this.revealAt = t
    this.kick()
  }

  /** Move the disc. `r` animates so it grows in on enter instead of slamming into lines at full size. */
  setDisc(x: number, y: number, r: number) {
    if (this.target.r <= 0.5 && this.disc.r <= 0.5) {
      this.disc.x = this.prevDisc.x = x
      this.disc.y = this.prevDisc.y = y
    }
    this.target.x = x
    this.target.y = y
    this.target.r = r
    this.kick()
  }

  releaseDisc() {
    this.target.r = 0
    this.kick()
  }

  /** A tap or click throws a ripple outward from the point. */
  pluck(x: number, y: number, strength = 7) {
    const sigma = 70
    for (const line of this.lines) {
      const dy = line.y - y
      if (Math.abs(dy) > sigma * 3) continue
      const fy = Math.exp(-(dy * dy) / (2 * sigma * sigma)) * (dy >= 0 ? 1 : -1)
      for (let i = 1; i < this.points - 1; i++) {
        const dx = this.x0 + i * DX - x
        if (Math.abs(dx) > sigma * 3) continue
        line.v[i] += strength * fy * Math.exp(-(dx * dx) / (2 * sigma * sigma))
      }
    }
    this.kick()
  }

  private kick() {
    if (!this.raf && this.visible) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    this.prevDisc = { ...this.disc }
    this.disc.x = this.target.x
    this.disc.y = this.target.y
    this.disc.r += (this.target.r - this.disc.r) * 0.2
    if (Math.abs(this.target.r - this.disc.r) < 0.3) this.disc.r = this.target.r

    let energy = 0
    for (let s = 1; s <= SUB; s++) {
      const k = s / SUB
      const dx = this.prevDisc.x + (this.disc.x - this.prevDisc.x) * k
      const dy = this.prevDisc.y + (this.disc.y - this.prevDisc.y) * k
      const dr = this.prevDisc.r + (this.disc.r - this.prevDisc.r) * k
      for (const line of this.lines) energy = Math.max(energy, this.step(line, dx, dy, dr))
    }
    this.draw(now)

    const revealing =
      this.revealAt !== undefined && now - this.revealAt < REVEAL_MS + this.lines.length * REVEAL_STAGGER
    if (energy > 0.02 || this.disc.r > 0 || this.target.r > 0 || revealing) this.kick()
  }

  private scratch = new Float32Array(0)

  private step(line: Line, px: number, py: number, r: number) {
    const { u, v } = line
    const n = this.points
    let peak = 0
    for (let i = 1; i < n - 1; i++) {
      const a = C2 * (u[i - 1] + u[i + 1] - 2 * u[i]) - RESTORE * u[i]
      v[i] = (v[i] + a) * (1 - DAMP)
    }
    if (this.scratch.length !== n) this.scratch = new Float32Array(n)
    const sv = this.scratch
    sv.set(v)
    for (let i = 1; i < n - 1; i++) v[i] = sv[i] + VISC * (sv[i - 1] + sv[i + 1] - 2 * sv[i])
    for (let i = 1; i < n - 1; i++) {
      u[i] += v[i]
      const m = Math.abs(u[i]) + Math.abs(v[i])
      if (m > peak) peak = m
    }

    const dyb = line.y - py
    const stretch = r * 0.85
    if (r < 1) line.hold = 0
    else if (line.hold === 0) {
      if (Math.abs(dyb) < r) line.hold = dyb >= 0 ? 1 : -1
    } else if (line.hold === 2) {
      if (Math.abs(dyb) >= r) line.hold = 0
    } else if (line.hold * dyb >= r) line.hold = 0
    // Dragged past its breaking point the line slips off the disc and snaps back through it: that's the pluck.
    else if (line.hold * dyb < -stretch) line.hold = 2

    if (line.hold === 1 || line.hold === -1) {
      const side = line.hold
      const i0 = Math.max(1, Math.ceil((px - r - this.x0) / DX))
      const i1 = Math.min(n - 2, Math.floor((px + r - this.x0) / DX))
      for (let i = i0; i <= i1; i++) {
        const ddx = this.x0 + i * DX - px
        const edge = Math.sqrt(Math.max(0, r * r - ddx * ddx))
        const target = py + side * edge - line.y
        if (side * (u[i] - target) < 0) {
          // Carry some of the disc's motion into the string so a released line overshoots instead of stopping dead.
          v[i] = (target - u[i]) * 0.2
          u[i] = target
        }
      }
      peak = Math.max(peak, 1)
    }
    return peak
  }

  private draw(now: number) {
    const { ctx } = this
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const fadeZone = this.gap * 6
    const edge = Math.min(this.height, this.bottom)
    const hot: Path2D[] = Array.from({ length: HOT_BUCKETS }, () => new Path2D())

    this.lines.forEach((line, li) => {
      let reach = 1
      if (this.revealAt !== undefined) {
        const k = Math.min(1, Math.max(0, (now - this.revealAt - li * REVEAL_STAGGER) / REVEAL_MS))
        reach = 1 - (1 - k) ** 3
      }
      if (reach <= 0) return
      const xEnd = this.x0 + reach * (this.points - 1) * DX
      // Lines thin out toward the bottom so the ruled wall dissolves into the plain one behind the small print.
      const fade = Math.min(1, Math.max(0, (edge - line.y) / fadeZone))
      const { u } = line
      const base = new Path2D()
      let started = false
      for (let i = 0; i < this.points; i++) {
        const x = this.x0 + i * DX
        if (x > xEnd) break
        const y = line.y + u[i]
        if (!started) {
          base.moveTo(x, y)
          started = true
        } else {
          const px = this.x0 + (i - 1) * DX
          const py = line.y + u[i - 1]
          base.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2)
        }
        if (i > 0) {
          const e = Math.min(1, Math.abs(u[i]) / 30)
          if (e > 0.12) {
            const b = Math.min(HOT_BUCKETS - 1, Math.floor(e * HOT_BUCKETS))
            const path = hot[b]
            path.moveTo(this.x0 + (i - 1) * DX, line.y + u[i - 1])
            path.lineTo(x, y)
          }
        }
      }
      ctx.strokeStyle = `rgba(${INK},${0.17 * fade})`
      ctx.lineWidth = 0.8
      ctx.stroke(base)
    })

    hot.forEach((path, b) => {
      const e = (b + 0.5) / HOT_BUCKETS
      ctx.strokeStyle = `rgba(${HOT},${0.35 + e * 0.65})`
      ctx.lineWidth = 1 + e * 1.6
      ctx.stroke(path)
    })
  }
}
