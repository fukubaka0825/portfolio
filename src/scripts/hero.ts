import { finePointer, gsap, reducedMotion } from './motion'
import { type Disc, Strings } from './strings'

/**
 * Letters are inline-blocks, so the browser may break a line between any two of them. Pinning every letter
 * to its resting width means the variable-font "breathing" only changes the glyph, never the line length,
 * so "Narikawa" can't spill its last "a" onto a third line and snap back.
 */
const pinLetterWidths = (chars: HTMLElement[]) => {
  for (const el of chars) {
    el.style.width = ''
    el.style.removeProperty('--w')
    el.style.removeProperty('--s')
  }
  // offsetWidth ignores transforms; the intro rotates letters, which would inflate a bounding-rect measurement.
  const widths = chars.map((el) => el.offsetWidth)
  chars.forEach((el, i) => {
    el.style.width = `${widths[i]}px`
  })
}

/** Weight/width of each letter eases toward the cursor, like the name leans away from the disc bending the lines. */
const initVariableName = (hero: HTMLElement, chars: HTMLElement[]) => {
  const state = chars.map(() => ({ w: 800, s: 100 }))
  let px = -9999
  let py = -9999
  let running = false
  let rects: DOMRect[] = []

  const measure = () => {
    rects = chars.map((el) => el.getBoundingClientRect())
  }
  const tick = () => {
    const radius = Math.max(window.innerWidth * 0.16, 180)
    let settled = true
    chars.forEach((el, i) => {
      const r = rects[i]
      const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2))
      const k = Math.max(0, 1 - d / radius) ** 1.5
      const st = state[i]
      const tw = 800 - 600 * k
      const ts = 100 - 25 * k
      st.w += (tw - st.w) * 0.14
      st.s += (ts - st.s) * 0.14
      if (Math.abs(tw - st.w) > 0.5 || Math.abs(ts - st.s) > 0.1) settled = false
      el.style.setProperty('--w', st.w.toFixed(1))
      el.style.setProperty('--s', st.s.toFixed(1))
    })
    // Stop the ticker once letters are at rest so the hero costs nothing while you read below it.
    if (settled && px < -9000) {
      gsap.ticker.remove(tick)
      running = false
    }
  }
  const start = () => {
    if (running) return
    running = true
    measure()
    gsap.ticker.add(tick)
  }

  hero.addEventListener('pointermove', (e) => {
    px = e.clientX
    py = e.clientY
    start()
  })
  hero.addEventListener('pointerleave', () => {
    px = -9999
    py = -9999
  })
  window.addEventListener('scroll', () => running && measure(), { passive: true })
}

/**
 * The ring *is* the disc the strings wrap around, so its edge and the bent lines always line up.
 * Over links it shrinks to a dot and lets go of the lines, so buttons stay easy to aim at.
 */
const mountStrings = (hero: HTMLElement, canvas: HTMLCanvasElement, onDisc?: (d: Disc) => void) => {
  const strings = new Strings(canvas, { gap: finePointer() ? 22 : 18, onDisc })
  const meta = hero.querySelector<HTMLElement>('[data-hero-meta]')
  const fitBottom = () => {
    if (meta) strings.setBottom(meta.getBoundingClientRect().top - hero.getBoundingClientRect().top)
  }
  new ResizeObserver(() => {
    strings.resize()
    fitBottom()
  }).observe(hero)
  new IntersectionObserver(([e]) => strings.setVisible(e.isIntersecting)).observe(hero)
  document.fonts.ready.then(fitBottom)
  fitBottom()
  return strings
}

const initStrings = (hero: HTMLElement, canvas: HTMLCanvasElement, ring: HTMLElement | null) => {
  const fine = finePointer()
  const R = fine ? 48 : 38
  let overLink = false
  // The ring is sized from the disc every frame (not by CSS), so its edge is exactly where the lines bend,
  // including while the disc grows in and shrinks away.
  const sizeRing =
    ring && fine
      ? (d: Disc) => {
          const size = overLink ? 10 : Math.max(10, d.r * 2 - 2)
          ring.style.width = `${size}px`
          ring.style.height = `${size}px`
        }
      : undefined
  const strings = mountStrings(hero, canvas, sizeRing)

  let script = true
  const local = (e: PointerEvent) => {
    const r = hero.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  if (ring && fine) {
    // No easing: the lines wrap the disc at the pointer, so a lagging ring would visibly miss the bend.
    const x = gsap.quickSetter(ring, 'x', 'px')
    const y = gsap.quickSetter(ring, 'y', 'px')
    hero.addEventListener('pointermove', (e) => {
      const [lx, ly] = local(e)
      x(lx)
      y(ly)
      ring.style.opacity = '1'
    })
    hero.addEventListener('pointerleave', () => {
      ring.style.opacity = '0'
    })
  }

  hero.addEventListener('pointermove', (e) => {
    script = false
    overLink = Boolean((e.target as Element).closest('a, button'))
    const [lx, ly] = local(e)
    if (overLink) strings.releaseDisc()
    else strings.setDisc(lx, ly, R, fine)
  })
  hero.addEventListener('pointerleave', () => strings.releaseDisc(true))
  hero.addEventListener('pointercancel', () => strings.releaseDisc(true))
  hero.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') strings.releaseDisc(true)
  })
  hero.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('a, button')) return
    strings.pluck(...local(e))
  })

  strings.reveal()
  // One unhurried pass up through the name so the first thing you see is the lines reacting.
  const meta = hero.querySelector<HTMLElement>('[data-hero-meta]')
  const t0 = performance.now() + 1000
  const dur = 2200
  const sweep = (now: number) => {
    if (!script) return
    const u = (now - t0) / dur
    if (u < 0) return requestAnimationFrame(sweep)
    if (u >= 1) {
      strings.releaseDisc(true)
      return
    }
    // Read the size every frame so a resize mid-intro keeps the pass on screen.
    const w = hero.clientWidth
    const h = meta
      ? meta.getBoundingClientRect().top - hero.getBoundingClientRect().top
      : hero.clientHeight * 0.7
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2
    const x = -60 + (w + 120) * e
    const y = h * (0.72 - 0.5 * e)
    strings.setDisc(x, y, fine ? 44 : 32, false)
    requestAnimationFrame(sweep)
    return undefined
  }
  requestAnimationFrame(sweep)
}

/** Reveal the role the way a chat model streams tokens: uneven chunks, uneven gaps. */
const streamText = (el: HTMLElement, caret: HTMLElement | null) => {
  const full = el.dataset.text ?? ''
  const tokens = full.match(/\s*[^\s,&]+[,]?|\s*&/g) ?? [full]
  let i = 0
  el.textContent = ''
  el.style.visibility = 'visible'
  const next = () => {
    if (i >= tokens.length) {
      caret?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 1800, fill: 'forwards' })
      return
    }
    el.textContent += tokens[i++]
    window.setTimeout(next, 40 + Math.random() * 110)
  }
  next()
}

export const initHero = () => {
  const hero = document.querySelector<HTMLElement>('[data-hero]')
  if (!hero) return
  const chars = [...hero.querySelectorAll<HTMLElement>('[data-char]')]
  const stream = hero.querySelector<HTMLElement>('[data-stream]')
  const caret = hero.querySelector<HTMLElement>('[data-caret]')
  const canvas = hero.querySelector<HTMLCanvasElement>('[data-hero-canvas]')
  const ring = hero.querySelector<HTMLElement>('[data-cursor-ring]')

  const repin = () => pinLetterWidths(chars)
  document.fonts.ready.then(repin)
  let resizeTimer = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(repin, 120)
  })

  if (reducedMotion()) {
    // The ruled wall is part of the look, not an effect: keep it, just still.
    if (canvas) mountStrings(hero, canvas)
    hero.classList.add('is-ready')
    return
  }

  // Start state is set in CSS (html.js) so nothing flashes before this module runs; hand it over to GSAP here.
  // y/x reset matters: GSAP parses the CSS translateY(115%) into `y` px, which would otherwise stick after yPercent → 0.
  gsap.set(chars, { x: 0, y: 0, yPercent: 115, rotate: 8 })
  gsap.set('[data-avatar]', { scale: 0.6, rotate: -20, opacity: 0 })
  hero.classList.add('is-ready')

  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
  tl.to(chars, { yPercent: 0, rotate: 0, duration: 1.3, stagger: 0.035 })
    .to('[data-avatar]', { scale: 1, rotate: 0, opacity: 1, duration: 1.2 }, 0.35)
    .add(() => {
      if (stream) streamText(stream, caret)
    }, 0.55)

  if (canvas) initStrings(hero, canvas, ring)
  if (finePointer()) initVariableName(hero, chars)

  // Name drifts up and the avatar sinks as you leave the hero, so the exit has depth instead of a hard cut.
  gsap.to('[data-line]', {
    yPercent: -18,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  })
  gsap.to('[data-avatar-float]', {
    y: 120,
    rotate: 12,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  })
}
