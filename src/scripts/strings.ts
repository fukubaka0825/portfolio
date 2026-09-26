/**
 * Plucked strings for the hero wall.
 *
 * The hero is ruled with hairlines like a pen-plotter drawing. The cursor is a hard disc (the same circle as
 * the cursor ring): lines wrap around it, stretch when you drag them, and when one slips off it snaps back
 * and rings, the wave running out along the line. Displaced stretches glow hoodie-orange, so the picture
 * reads as a signal trace, which is what the person behind this site builds dashboards for.
 *
 * Lines never cross: each column keeps its lines in order with a minimum gap, so a push stacks them up like
 * contour lines around the disc instead of tangling. The lowest line rests on a floor above the small print.
 *
 * Every line is a spring that returns exactly to rest, so, unlike paint, nothing is ever left behind.
 */

const DX = 8
/** Wave speed squared per substep; the explicit scheme below is stable while this stays under 0.5. */
const C2 = 0.42
const DAMP = 0.014
/**
 * Viscosity damps kinks, not the swing: the disc constraint works on discrete samples and injects a sawtooth
 * at the sample spacing, which without this keeps buzzing long after the real wave has settled.
 * Must stay under 0.25: above that the sawtooth mode flips sign every step and the scheme blows up.
 */
const VISC = 0.15
const RESTORE = 0.004
const SUB = 2
/** Closest two neighbouring lines may be squeezed together, in px. */
const MIN_GAP = 2.2
/** Below this (px and px/substep) a line is snapped to rest and stops being simulated. */
const REST = 0.04
/** ~0.25s at two substeps a frame: long enough for a slipped line to snap through the disc. */
const SLIP_SUBSTEPS = 30
/**
 * Stroking hairlines at 2x is raster-bound. If frames keep running long while things move, drop to 1x once:
 * a slightly softer line beats a stuttering one on a weak laptop.
 */
const SLOW_FRAME_MS = 24
const SLOW_FRAMES = 40
const REVEAL_MS = 1000
const REVEAL_STAGGER = 18

const INK = '15,43,47'
const HOT = '238,125,28'
const HOT_BUCKETS = 10

type Line = {
  y: number
  u: Float32Array
  v: Float32Array
  /** 0 free, ±1 held on that side of the disc, 2 slipped off (ignored until the disc lets go of it). */
  hold: number
  /** Substeps since the line slipped off the disc. */
  slip: number
  awake: boolean
  /** Positions at the start of the frame; the loop keeps running only while something visibly moved. */
  prev: Float32Array
}

export type Disc = { x: number; y: number; r: number }
export type StringsOptions = { gap?: number; onDisc?: (d: Disc) => void }

export class Strings {
  private ctx: CanvasRenderingContext2D
  private lines: Line[] = []
  private dpr = 1
  private width = 0
  private height = 0
  private points = 0
  private x0 = 0
  private bottom = Number.POSITIVE_INFINITY
  private floor = Number.POSITIVE_INFINITY
  private raf = 0
  private visible = true
  private revealAt: number | undefined
  private gap: number
  private onDisc: ((d: Disc) => void) | undefined
  // The disc moves in substeps between frames, so a fast flick drags lines instead of teleporting through them.
  private disc: Disc = { x: -1e4, y: -1e4, r: 0 }
  private prevDisc: Disc = { x: -1e4, y: -1e4, r: 0 }
  private target: Disc = { x: -1e4, y: -1e4, r: 0 }
  /** Set when the pointer leaves: the next contact jumps straight to the pointer instead of sweeping across. */
  private detached = true
  /** Only a disc with a visible ring hides the lines under it; the intro's invisible hand must not punch a hole. */
  private solid = false
  private scratch = new Float32Array(0)
  /**
   * Only the horizontal band that changed is cleared and redrawn. Stroking every hairline at device resolution
   * each frame is what made this slow on weak CPUs; a disc usually disturbs a few rows, not the whole wall.
   */
  private band: [number, number] | null = null
  private full = true
  private maxDpr = 2
  private lastFrame = 0
  private slowFrames = 0
  private stillSince = 0
  private stack = new Float32Array(0)

  constructor(
    private canvas: HTMLCanvasElement,
    opts: StringsOptions = {},
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    this.gap = opts.gap ?? 22
    this.onDisc = opts.onDisc
    this.resize()
  }

  /** Lines stop above this y (hero-local px) so the small print under the name sits on a clean wall. */
  setBottom(y: number) {
    if (Math.abs(y - this.bottom) < 0.5) return
    this.bottom = y
    this.build()
  }

  resize() {
    // Hairlines need the full device resolution; at 1.5x a 1px line smears into a grey 2px one.
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr)
    const r = this.canvas.getBoundingClientRect()
    this.width = r.width
    this.height = r.height
    this.canvas.width = Math.round(r.width * this.dpr)
    this.canvas.height = Math.round(r.height * this.dpr)
    this.full = true
    this.build()
  }

  private build() {
    // Anchor points sit just outside the canvas, so the fixed ends of every string are never visible.
    this.x0 = -DX * 2
    this.points = Math.ceil((this.width + DX * 4) / DX) + 1
    const edge = Math.min(this.height, this.bottom)
    this.floor = edge - 8
    const limit = edge - this.gap * 0.5
    const lines: Line[] = []
    for (let y = this.gap * 0.75; y < limit; y += this.gap) {
      lines.push({
        y,
        u: new Float32Array(this.points),
        v: new Float32Array(this.points),
        hold: 0,
        slip: 0,
        awake: false,
        prev: new Float32Array(this.points),
      })
    }
    this.lines = lines
    this.full = true
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
  setDisc(x: number, y: number, r: number, solid = true) {
    this.solid = solid
    if (this.detached) {
      this.disc.x = this.prevDisc.x = x
      this.disc.y = this.prevDisc.y = y
      this.detached = false
    }
    this.target = { x, y, r }
    this.kick()
  }

  /** Shrink the disc away in place (over a link, or leaving the hero). */
  releaseDisc(detach = false) {
    this.target.r = 0
    if (detach) this.detached = true
    this.kick()
  }

  /** A tap or click throws a ripple outward from the point. */
  pluck(x: number, y: number, strength = 5) {
    const sigma = 60
    for (const line of this.lines) {
      const dy = line.y - y
      if (Math.abs(dy) > sigma * 3) continue
      const fy = Math.exp(-(dy * dy) / (2 * sigma * sigma)) * (dy >= 0 ? 1 : -1)
      for (let i = 1; i < this.points - 1; i++) {
        const dx = this.x0 + i * DX - x
        if (Math.abs(dx) > sigma * 3) continue
        line.v[i] += strength * fy * Math.exp(-(dx * dx) / (2 * sigma * sigma))
      }
      line.awake = true
    }
    this.kick()
  }

  private kick() {
    if (!this.raf && this.visible) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    if (this.lastFrame && now - this.lastFrame < 100) {
      this.slowFrames = now - this.lastFrame > SLOW_FRAME_MS ? this.slowFrames + 1 : 0
      if (this.slowFrames > SLOW_FRAMES && this.maxDpr > 1) {
        this.maxDpr = 1
        this.resize()
      }
    }
    this.lastFrame = now
    this.prevDisc = { ...this.disc }
    this.disc.x = this.target.x
    this.disc.y = this.target.y
    this.disc.r += (this.target.r - this.disc.r) * 0.25
    if (Math.abs(this.target.r - this.disc.r) < 0.3) this.disc.r = this.target.r
    this.onDisc?.(this.disc)

    for (const line of this.lines) if (line.awake) line.prev.set(line.u)
    for (let s = 1; s <= SUB; s++) {
      const k = s / SUB
      const px = this.prevDisc.x + (this.disc.x - this.prevDisc.x) * k
      const py = this.prevDisc.y + (this.disc.y - this.prevDisc.y) * k
      const pr = this.prevDisc.r + (this.disc.r - this.prevDisc.r) * k
      for (const line of this.lines) {
        const near = pr >= 1 && Math.abs(line.y - py) < pr + 2
        if (near) line.awake = true
        if (line.awake) this.wave(line, near)
      }
      this.grip(px, py, pr)
      this.press(px, py, pr)
      // Last, so ordering and the floor always win over the disc: a line may tuck under the (opaque) disc,
      // but never crosses a neighbour or drops into the small print.
      this.nest()
    }
    const revealing =
      this.revealAt !== undefined && now - this.revealAt < REVEAL_MS + this.lines.length * REVEAL_STAGGER
    this.draw(now, revealing)

    let motion = 0
    for (const line of this.lines) {
      if (!line.awake) continue
      const { u, prev } = line
      for (let i = 0; i < u.length; i++) {
        const d = Math.abs(u[i] - prev[i])
        if (d > motion) motion = d
      }
    }
    const discMoving =
      this.disc.r !== this.target.r ||
      (this.disc.r > 0 && (this.disc.x !== this.prevDisc.x || this.disc.y !== this.prevDisc.y))
    if (discMoving || !this.stillSince) this.stillSince = now
    // Measured as how far anything moved on screen this frame, not as speed: a resting pointer keeps nudging
    // the lines it holds every substep, yet the picture is still, so the loop can sleep until the next move.
    // With the pointer parked, sub-pixel ripples left on held lines would take seconds more to die out; freezing
    // them is invisible, and the next move picks the simulation up exactly where it stopped.
    const settled = motion <= 0.02 || (this.disc.r > 0 && now - this.stillSince > 1500 && motion < 0.25)
    if (!settled || discMoving || revealing) this.kick()
    else this.stillSince = 0
  }

  /** One wave-equation substep; a quiet line is snapped to rest and stops being simulated. */
  private wave(line: Line, near: boolean) {
    const { u, v } = line
    const n = this.points
    for (let i = 1; i < n - 1; i++) {
      const a = C2 * (u[i - 1] + u[i + 1] - 2 * u[i]) - RESTORE * u[i]
      v[i] = (v[i] + a) * (1 - DAMP)
    }
    if (this.scratch.length !== n) this.scratch = new Float32Array(n)
    const sv = this.scratch
    sv.set(v)
    let speed = 0
    let reach = 0
    for (let i = 1; i < n - 1; i++) {
      v[i] = sv[i] + VISC * (sv[i - 1] + sv[i + 1] - 2 * sv[i])
      u[i] += v[i]
      const sp = Math.abs(v[i])
      if (sp > speed) speed = sp
      const d = Math.abs(u[i])
      if (d > reach) reach = d
    }
    // Under a pixel of bend with no speed left, the restoring spring would take seconds to crawl home for no
    // visible gain; snapping flat is invisible and makes "back to rest" exact.
    if (!near && line.hold === 0 && speed < REST && reach < 1) {
      u.fill(0)
      v.fill(0)
      line.awake = false
    }
  }

  /**
   * Keep every column's lines in order, at least MIN_GAP apart, and above the floor. Pushing one line into the
   * next shares the correction between them, so a squeeze travels outward like a stack of real strings.
   */
  private nest() {
    const lines = this.lines
    const L = lines.length
    if (!L) return
    for (let i = 1; i < this.points - 1; i++) {
      for (let k = 1; k < L; k++) {
        const a = lines[k - 1]
        const b = lines[k]
        const overlap = a.y + a.u[i] + MIN_GAP - (b.y + b.u[i])
        if (overlap <= 0) continue
        a.u[i] -= overlap / 2
        b.u[i] += overlap / 2
        const vm = (a.v[i] + b.v[i]) / 2
        a.v[i] = vm
        b.v[i] = vm
        a.awake = true
        b.awake = true
      }
      // Walk back up from the floor so the bottom of the stack can't be pushed into the small print.
      let limit = this.floor
      for (let k = L - 1; k >= 0; k--) {
        const line = lines[k]
        const y = line.y + line.u[i]
        if (y > limit) {
          line.u[i] = limit - line.y
          if (line.v[i] > 0) line.v[i] = 0
          line.awake = true
        }
        limit = Math.min(limit, line.y + line.u[i]) - MIN_GAP
      }
    }
  }

  /** Decide which lines the disc is holding, and on which side. */
  private grip(px: number, py: number, r: number) {
    const stretch = r * 0.85
    let lastAbove = -1
    this.lines.forEach((line, k) => {
      const dyb = line.y - py
      if (r < 1) line.hold = 0
      else if (line.hold === 0) {
        if (Math.abs(dyb) < r) line.hold = dyb >= 0 ? 1 : -1
      } else if (line.hold === 2) {
        if (Math.abs(dyb) >= r) line.hold = 0
        else if (++line.slip > SLIP_SUBSTEPS) {
          // By now the snap has played out. Whatever is left sits wedged between held neighbours under the disc
          // and would creep forever, so the disc takes hold of it again on whichever side it ended up.
          const ic = Math.round((px - this.x0) / DX)
          line.hold = line.y + (line.u[ic] ?? 0) >= py ? 1 : -1
        }
      } else if (line.hold * dyb >= r) line.hold = 0
      // Dragged past its breaking point the line slips off the disc and snaps back through it: that's the pluck.
      else if (line.hold * dyb < -stretch) {
        line.hold = 2
        line.slip = 0
      }
      if (line.hold === -1) lastAbove = k
    })
    // Held-below lines must all sit under held-above ones. If a line dragged down is still above a line held
    // up (a zig-zag can do that), it lets go instead: otherwise the two would swap order around the disc.
    for (let k = 0; k < lastAbove; k++) {
      const line = this.lines[k]
      if (line.hold !== 1) continue
      line.hold = 2
      line.slip = 0
    }
  }

  /**
   * Push held lines out to the disc's edge. Lines held on the same side stack outward from the edge at
   * MIN_GAP, nearest first, so a squeeze reads as nested contours instead of strokes merging into one.
   */
  private press(px: number, py: number, r: number) {
    if (r < 1) return
    const lines = this.lines
    const i0 = Math.max(1, Math.ceil((px - r - this.x0) / DX))
    const i1 = Math.min(this.points - 2, Math.floor((px + r - this.x0) / DX))
    if (i1 < i0) return
    if (this.stack.length < this.points) this.stack = new Float32Array(this.points)
    const stack = this.stack
    for (const side of [1, -1]) {
      stack.fill(side > 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY)
      const order = side > 0 ? lines : [...lines].reverse()
      for (const line of order) {
        if (line.hold !== side) continue
        const { u, v } = line
        for (let i = i0; i <= i1; i++) {
          const ddx = this.x0 + i * DX - px
          const edge = py + side * Math.sqrt(Math.max(0, r * r - ddx * ddx))
          let y = side > 0 ? Math.max(edge, stack[i] + MIN_GAP) : Math.min(edge, stack[i] - MIN_GAP)
          if (side > 0) y = Math.min(y, this.floor)
          const target = y - line.y
          if (side * (u[i] - target) < 0) {
            // Pinned, not kicked: injecting velocity here makes a held point buzz around the edge forever while
            // the pointer rests. The stored bend is enough to make a released line snap and ring.
            v[i] = 0
            u[i] = target
          }
          stack[i] = line.y + u[i]
        }
      }
    }
  }

  private draw(now: number, revealing: boolean) {
    const { ctx } = this
    const lo = new Float32Array(this.lines.length)
    const hi = new Float32Array(this.lines.length)
    let top = Number.POSITIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    this.lines.forEach((line, k) => {
      let mn = 0
      let mx = 0
      if (line.awake) {
        for (const d of line.u) {
          if (d < mn) mn = d
          else if (d > mx) mx = d
        }
      }
      // Padding covers the round caps and the widest orange stroke.
      lo[k] = line.y + mn - 4
      hi[k] = line.y + mx + 4
      if (line.awake) {
        top = Math.min(top, lo[k])
        bottom = Math.max(bottom, hi[k])
      }
    })
    if (this.disc.r > 1) {
      top = Math.min(top, this.disc.y - this.disc.r - 4)
      bottom = Math.max(bottom, this.disc.y + this.disc.r + 4)
    }
    const current: [number, number] | null = top < bottom ? [top, bottom] : null
    let y0 = 0
    let y1 = this.height
    if (!this.full && !revealing) {
      // Redraw where things are now and where they were last frame, so old positions get erased too.
      const a = current ?? this.band
      const b = this.band ?? current
      if (!a || !b) return
      y0 = Math.max(0, Math.min(a[0], b[0]))
      y1 = Math.min(this.height, Math.max(a[1], b[1]))
    }
    this.band = current
    this.full = false
    if (y1 <= y0) return

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, y0, this.width, y1 - y0)
    ctx.clip()
    ctx.clearRect(0, y0, this.width, y1 - y0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const fadeZone = this.gap * 6
    const edge = Math.min(this.height, this.bottom)
    const hot: Path2D[] = Array.from({ length: HOT_BUCKETS }, () => new Path2D())
    const pens: [number, number][] = []

    this.lines.forEach((line, li) => {
      let reach = 1
      if (this.revealAt !== undefined) {
        const k = Math.min(1, Math.max(0, (now - this.revealAt - li * REVEAL_STAGGER) / REVEAL_MS))
        reach = 1 - (1 - k) ** 3
      }
      if (reach <= 0 || hi[li] < y0 || lo[li] > y1) return
      const xEnd = this.x0 + reach * (this.points - 1) * DX
      // Lines thin out toward the bottom so the ruled wall dissolves into the plain one behind the small print.
      const fade = Math.min(1, Math.max(0, (edge - line.y) / fadeZone))
      const base = new Path2D()
      if (!line.awake) {
        base.moveTo(this.x0, line.y)
        base.lineTo(xEnd, line.y)
      } else {
        const { u } = line
        let mx = this.x0
        let my = line.y + u[0]
        base.moveTo(mx, my)
        for (let i = 1; i < this.points; i++) {
          const x = this.x0 + i * DX
          if (x > xEnd) break
          const cx = this.x0 + (i - 1) * DX
          const cy = line.y + u[i - 1]
          const nx = (cx + x) / 2
          const ny = (cy + line.y + u[i]) / 2
          base.quadraticCurveTo(cx, cy, nx, ny)
          // The glow retraces the exact same curve piece, so orange sits on the ink line instead of beside it.
          const e = Math.min(1, Math.abs(u[i - 1]) / 30) * fade
          if (e > 0.12) {
            const path = hot[Math.min(HOT_BUCKETS - 1, Math.floor(e * HOT_BUCKETS))]
            path.moveTo(mx, my)
            path.quadraticCurveTo(cx, cy, nx, ny)
          }
          mx = nx
          my = ny
        }
      }
      if (reach < 1) pens.push([xEnd, line.y])
      ctx.strokeStyle = `rgba(${INK},${0.17 * fade})`
      ctx.lineWidth = 0.8
      ctx.stroke(base)
    })

    hot.forEach((path, b) => {
      const e = (b + 0.5) / HOT_BUCKETS
      ctx.strokeStyle = `rgba(${HOT},${0.3 + e * 0.7})`
      ctx.lineWidth = 0.9 + e * 1.5
      ctx.stroke(path)
    })

    // A pen nib at the head of each line still being ruled sells the plotter.
    ctx.fillStyle = `rgba(${INK},0.8)`
    for (const [x, y] of pens) {
      ctx.beginPath()
      ctx.arc(x, y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }

    // The disc is solid: whatever is inside it (a line snapping back through) is erased, so the ring reads as
    // a lens lying on the wall rather than an outline the lines run through. Erasing one circle afterwards is
    // far cheaper than clipping every stroke to a full-canvas even-odd path.
    if (this.solid && this.disc.r > 1) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(this.disc.x, this.disc.y, Math.max(0, this.disc.r - 1), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.restore()
  }
}
