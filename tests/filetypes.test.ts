import { expect, test } from 'claude-code/testing'
import { BADGE_BY_EXT, BADGE_BY_NAME, BY_EXT, BY_NAME, contrast, iconFor, PLAIN_TILE, swatchFor, textOn, UNKNOWN_TILE } from '../hooks/filetypes.ts'
import { cells } from '../hooks/view.ts'

test('swatches by name and extension', async () => {
  expect(swatchFor('a.ts')).toEqual({ glyph: '▪', color: '#3178C6' })
  expect(swatchFor('package.json').glyph).toBe('◆')
  expect(swatchFor('Makefile').glyph).toBe('◆')
  expect(swatchFor('.env.local').color).toBe('#C08A26')
  expect(swatchFor('notes')).toEqual({ glyph: '▪', color: 'subtle' })
  expect(swatchFor('IMG.PNG').color).toBe('#B088A9')
})

test('contrast is the WCAG ratio', async () => {
  expect(Math.round(contrast('#FFFFFF', '#000000'))).toBe(21)
  expect(contrast('#777777', '#777777')).toBe(1)
  expect(textOn('#3178C6')).toBe('#FFFFFF')
  expect(textOn('#F0DB4F')).toBe('#1A1A1A')
})

test('badges by name and extension', async () => {
  expect(iconFor('a.ts')).toEqual({ label: 'TS', bg: '#3178C6', fg: '#FFFFFF' })
  expect(iconFor('Button.TSX').label).toBe('TS')
  expect(iconFor('Button.tsx').bg).not.toBe(iconFor('a.ts').bg)
  expect(iconFor('index.js')).toEqual({ label: 'JS', bg: '#F0DB4F', fg: '#1A1A1A' })
  expect(iconFor('package.json')).toEqual({ label: '{}', bg: '#CB3837', fg: '#FFFFFF' })
  expect(iconFor('README.md').label).toBe('M↓')
  expect(iconFor('Dockerfile').label).toBe('DK')
  expect(iconFor('.env.local').label).toBe('EN')
  expect(iconFor('main.py')).toEqual({ label: 'PY', bg: '#3572A5', fg: '#FFD43B' })
  // An unknown extension shows its first letters; no extension, or an odd one, a blank tile.
  expect(iconFor('data.xyz')).toEqual({ label: 'XY', bg: UNKNOWN_TILE, fg: textOn(UNKNOWN_TILE) })
  expect(iconFor('notes.q').label).toBe('Q ')
  expect(iconFor('NOTES')).toEqual({ label: '  ', bg: PLAIN_TILE, fg: textOn(PLAIN_TILE) })
  expect(iconFor('.prettierrc').label).toBe('CF')
  expect(iconFor('.hidden').label).toBe('  ')
  expect(iconFor('a.漢字').label).toBe('  ')
  expect(iconFor('a.\u001b[').label).toBe('  ')
})

test('every badge is two cells, and its text reads on its tile', async () => {
  const specs = [...Object.values(BADGE_BY_EXT), ...Object.values(BADGE_BY_NAME), ['  ', PLAIN_TILE] as const, ['XY', UNKNOWN_TILE] as const]
  for (const [label, bg, fg] of specs) {
    expect(cells(label)).toBe(2)
    const text = fg ?? textOn(bg)
    if (contrast(text, bg) < 3) throw new Error(`${label} on ${bg}: ${contrast(text, bg).toFixed(2)}`)
  }
})

test('every swatch reads on light and dark themes', async () => {
  const colors = new Set([...Object.values(BY_EXT), ...Object.values(BY_NAME).map((s) => s.color)])
  for (const color of colors) {
    if (!color.startsWith('#')) continue
    for (const background of ['#FFFFFF', '#1E1E1E']) {
      if (contrast(color, background) < 3) throw new Error(`${color} on ${background}: ${contrast(color, background).toFixed(2)}`)
    }
  }
})
