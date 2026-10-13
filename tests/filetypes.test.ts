import { expect, test } from 'claude-code/testing'
import { swatchFor } from '../hooks/filetypes.ts'

test('swatches by name and extension', async () => {
  expect(swatchFor('a.ts')).toEqual({ glyph: '▪', color: '#3178C6' })
  expect(swatchFor('package.json').glyph).toBe('◆')
  expect(swatchFor('Makefile').glyph).toBe('◆')
  expect(swatchFor('.env.local').color).toBe('#E5C07B')
  expect(swatchFor('notes')).toEqual({ glyph: '▪', color: 'subtle' })
  expect(swatchFor('IMG.PNG').color).toBe('#B48EAD')
})
