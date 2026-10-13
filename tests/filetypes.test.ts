import { expect, test } from 'claude-code/testing'
import { BY_EXT, BY_NAME, swatchFor } from '../hooks/filetypes.ts'
import { ACCENT } from '../hooks/view.ts'

test('swatches by name and extension', async () => {
  expect(swatchFor('a.ts')).toEqual({ glyph: '▪', color: '#3178C6' })
  expect(swatchFor('package.json').glyph).toBe('◆')
  expect(swatchFor('Makefile').glyph).toBe('◆')
  expect(swatchFor('.env.local').color).toBe('#C08A26')
  expect(swatchFor('notes')).toEqual({ glyph: '▪', color: 'subtle' })
  expect(swatchFor('IMG.PNG').color).toBe('#B088A9')
})

// WCAG relative luminance and contrast ratio.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test('every swatch and the accent read on light and dark themes', async () => {
  const colors = new Set([...Object.values(BY_EXT), ...Object.values(BY_NAME).map((s) => s.color), ACCENT])
  for (const color of colors) {
    if (!color.startsWith('#')) continue
    for (const background of ['#FFFFFF', '#1E1E1E']) {
      if (contrast(color, background) < 3) throw new Error(`${color} on ${background}: ${contrast(color, background).toFixed(2)}`)
    }
  }
})
