import { describe, it, expect } from 'vitest'
import { contrastRatio } from '../contrast'

describe('contrastRatio', () => {
  it('returns the max WCAG ratio (21:1) for pure black on pure white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('returns 1 for identical colors (no contrast)', () => {
    expect(contrastRatio('#f6f1e6', '#f6f1e6')).toBeCloseTo(1, 2)
  })

  it('flags the original muted token as failing AA body-text contrast (4.5:1) on the card background', () => {
    // design.md token candidates: --muted-2 #a0967f vs --bg-card #f6f1e6
    expect(contrastRatio('#a0967f', '#f6f1e6')).toBeLessThan(4.5)
  })

  it('flags the previously-shipped --muted-2 (#736c5b) as failing AA on --bg-app, its worst-case background', () => {
    // #736c5b cleared 4.5:1 on --bg-card (~4.63:1) but --muted-2 is also painted as text on
    // --bg-app, --bg-input/--bg-header/--bg-rail, and --bg-sidebar — all of which it fails.
    expect(contrastRatio('#736c5b', '#eae1cf')).toBeLessThan(4.5)
  })

  it('confirms the current --muted-2 (#6b6455) passes AA body-text contrast (4.5:1) on every background it is used on', () => {
    // --bg-app (#eae1cf) is the worst-case (lowest-luminance) background --muted-2 is painted on;
    // clearing 4.5:1 there guarantees the rest (--bg-card, --bg-input, --bg-header, --bg-rail, --bg-sidebar) too.
    const backgrounds = ['#eae1cf', '#efe7d3', '#f2ecdd', '#f6f1e6']
    for (const bg of backgrounds) {
      expect(contrastRatio('#6b6455', bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
