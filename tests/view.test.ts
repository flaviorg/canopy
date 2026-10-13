import { expect, test } from 'claude-code/testing'
import { flatten, type Listing } from '../hooks/tree.ts'
import { HOT_MS, mark, type Marks } from '../hooks/activity.ts'
import { NO_GIT, type GitState } from '../hooks/git.ts'
import {
  BRAILLE, cells, CHAR_BUDGET, emptyLine, fit, headerLine, legendLines, NODE_BUDGET, nodesOf, paneLines, printable, ROLLUP, rowKey, SPIN,
  STATE_COLOR, stateGlyph, treeLines,
  type Line, type Seg, type ViewInput,
} from '../hooks/view.ts'

const NOW = 100_000
const file = (name: string) => ({ name, kind: 'file' as const })
const dir = (name: string) => ({ name, kind: 'dir' as const })
const LISTING: Listing = {
  '': [dir('src'), file('README.md'), file('package.json')],
  src: [file('a.ts'), file('b.md')],
}

function input(over: Partial<ViewInput> & { open?: (rel: string) => boolean } = {}): ViewInput {
  const rows = over.rows ?? flatten('w', LISTING, over.open ?? (() => true))
  return { rows, marks: {}, git: NO_GIT, now: NOW, frame: 0, width: 44, activity: 'all', ...over }
}

const text = (segs: Seg[]) => segs.map((s) => s.text).join('')
const full = (l: Line) => text([...(l.lead ?? []), ...l.left])
const line = (lines: Line[], key: string) => {
  const found = lines.find((l) => l.key === key)
  if (!found) throw new Error('no line ' + key)
  return found
}
const segWith = (segs: Seg[], part: string) => segs.find((s) => s.text.includes(part))
const nameSeg = (l: Line, name: string) => segWith(l.left, name)!

test('header shows branch and counts', async () => {
  let marks = mark({}, 'src/a.ts', 'write', NOW)
  marks = mark(marks, 'README.md', 'read', NOW)
  const header = headerLine(input({ marks, git: { branch: 'main', files: {} } }))
  expect(header.key).toBe('header')
  expect(text(header.left)).toBe('◆ canopy · ⎇ main · ● 1 · ○ 1')
  expect(header.left[0]).toEqual({ text: '◆ canopy', bold: true })
  expect(segWith(header.left, '●')?.color).toBe('warning')
  expect(segWith(header.left, '○')?.color).toBe('suggestion')
  expect(header.right).toEqual([{ text: BRAILLE[0], color: 'claude' }])
  // Committed files count apart; the counts outlast the motion.
  const later = headerLine(input({ marks: mark(marks, 'package.json', 'commit', NOW), git: { branch: 'main', files: {} }, now: NOW + 3_600_000 }))
  expect(text(later.left)).toBe('◆ canopy · ⎇ main · ● 1 · ✓ 1 · ○ 1')
  expect(segWith(later.left, '✓')?.color).toBe('success')
  expect(later.right).toEqual([])
  // Quiet: no branch outside git, no counts, no spinner.
  const quiet = headerLine(input({ now: NOW }))
  expect(text(quiet.left)).toBe('◆ canopy')
  expect(quiet.right).toEqual([])
})

test('a long branch is cut before the counts are, and the spinner never moves the header', async () => {
  let marks = mark({}, 'src/a.ts', 'write', NOW)
  marks = mark(marks, 'README.md', 'read', NOW)
  const git: GitState = { branch: 'feature/PROJ-1234-add-the-new-onboarding-flow', files: {} }
  const hot = headerLine(input({ marks, git }))
  expect(text(hot.left)).toBe('◆ canopy · ⎇ feature/PROJ-123… · ● 1 · ○ 1')
  expect(cells(text(hot.left)) + 2).toBe(44)
  expect(text(headerLine(input({ marks, git, now: NOW + 20_000 })).left)).toBe(text(hot.left))
  // Too narrow for a useful piece of the branch: it goes, the counts stay.
  expect(text(headerLine(input({ marks, git, width: 30 })).left)).toBe('◆ canopy · ● 1 · ○ 1')
  expect(text(headerLine(input({ marks, git: { branch: 'main', files: {} }, width: 31 })).left)).toBe('◆ canopy · ⎇ main · ● 1 · ○ 1')
})

test('a file Claude is writing pulses in Claude\'s color', async () => {
  const marks = mark({}, 'src/a.ts', 'write', NOW)
  const f0 = line(treeLines(input({ marks, frame: 0 })), 'row:src/a.ts')
  const f1 = line(treeLines(input({ marks, frame: 1 })), 'row:src/a.ts')
  expect(f0.right).toEqual([{ text: '✎', color: 'claude' }])
  expect(f1.right).toEqual([{ text: '✎', color: 'claude', dim: true }])
  expect(nameSeg(f0, 'a.ts')).toEqual({ text: 'a.ts', color: 'claude', bold: true })
})

test('hot read spins', async () => {
  const marks = mark({}, 'README.md', 'read', NOW)
  const glyphs = [0, 1, 2, 3].map((frame) => text(line(treeLines(input({ marks, frame })), 'row:README.md').right).trim())
  expect(glyphs).toEqual(SPIN)
  const l = line(treeLines(input({ marks })), 'row:README.md')
  expect(nameSeg(l, 'README.md').color).toBe('suggestion')
  expect(l.right[0]?.color).toBe('suggestion')
})

test('after the motion, a file keeps its state for the session', async () => {
  const marks = mark({}, 'src/a.ts', 'write', NOW)
  for (const now of [NOW + HOT_MS, NOW + 90_000, NOW + 3_600_000]) {
    const l = line(treeLines(input({ marks, now })), 'row:src/a.ts')
    expect(l.right).toEqual([{ text: '●', color: 'warning' }])
    expect(nameSeg(l, 'a.ts')).toEqual({ text: 'a.ts', color: 'warning' })
  }
  // A file read keeps a ring, and its plain name.
  const read = mark({}, 'src/a.ts', 'read', NOW)
  for (const now of [NOW + HOT_MS, NOW + 3_600_000]) {
    const l = line(treeLines(input({ marks: read, now })), 'row:src/a.ts')
    expect(l.right).toEqual([{ text: '○', color: 'suggestion' }])
    expect(nameSeg(l, 'a.ts')).toEqual({ text: ' a.ts' })
  }
})

test('each state has its own glyph and color', async () => {
  expect(STATE_COLOR).toEqual({ editing: 'claude', edited: 'warning', committed: 'success', reading: 'suggestion', read: 'suggestion' })
  expect(['editing', 'edited', 'committed', 'reading', 'read'].map((s) => stateGlyph(s as any, 0).text).join('')).toBe('✎●✓◐○')
})

test('commit shows check', async () => {
  const marks = mark({}, 'src/a.ts', 'commit', NOW)
  for (const now of [NOW, NOW + 30_000, NOW + 3_600_000]) {
    const l = line(treeLines(input({ marks, now })), 'row:src/a.ts')
    expect(text(l.right)).toBe('✓')
    expect(l.right[0]?.color).toBe('success')
    expect(nameSeg(l, 'a.ts').color).toBe('success')
  }
})

test('git badges right-aligned after activity', async () => {
  const git: GitState = { branch: 'main', files: { 'src/a.ts': 'M', 'package.json': 'A', 'README.md': 'U' } }
  const marks = mark({}, 'src/a.ts', 'write', NOW)
  const lines = treeLines(input({ marks, git }))
  const a = line(lines, 'row:src/a.ts')
  expect(text(a.right)).toBe('✎ M')
  expect(a.right[a.right.length - 1]).toEqual({ text: 'M', color: 'warning' })
  // Badges share one column at the right edge; activity sits two cells before it.
  expect(text(line(lines, 'row:package.json').right)).toBe('  A')
  expect(line(lines, 'row:README.md').right.at(-1)).toEqual({ text: 'U', color: 'success', dim: true })
  // A deleted file's name turns red.
  const gone = treeLines(input({ git: { branch: 'main', files: { 'src/b.md': 'D' } } }))
  expect(nameSeg(line(gone, 'row:src/b.md'), 'b.md').color).toBe('error')
})

test('folders roll their badges up into one dot', async () => {
  const git: GitState = { branch: 'main', files: { 'src/a.ts': 'M', 'src/b.md': 'D' } }
  const lines = treeLines(input({ git }))
  expect(line(lines, 'row:src').right.at(-1)).toEqual({ text: ROLLUP, color: 'error' })
  expect(line(lines, 'row:').right.at(-1)).toEqual({ text: ROLLUP, color: 'error' })
  expect(ROLLUP).toBe('•')
  const clean = treeLines(input({ git: { branch: 'main', files: {} } }))
  expect(line(clean, 'row:src').right).toEqual([])
})

test('a closed folder shows the strongest state inside it', async () => {
  const marks = mark({}, 'src/a.ts', 'write', NOW)
  const collapsed = treeLines(input({ marks, open: (rel) => rel !== 'src' }))
  const src = line(collapsed, 'row:src')
  expect(src.toggle).toBe('src')
  expect(full(src)).toBe('├─ ▸ src/ ·1')
  // The guides sit outside what a press covers.
  expect(src.lead).toEqual([{ text: '├─ ', dim: true }])
  expect(text(src.left)).toBe('▸ src/ ·1')
  expect(segWith(src.left, 'src/')).toEqual({ text: 'src/', bold: true, color: 'claude' })
  expect(segWith(src.left, '·1')?.color).toBe('claude')
  expect(src.right).toEqual([{ text: '✎', color: 'claude' }])
  expect(collapsed.some((l) => l.key === 'row:src/a.ts')).toBe(false)
  // An hour on, it still says a file inside waits for a commit.
  const later = line(treeLines(input({ marks, now: NOW + 3_600_000, open: (rel) => rel !== 'src' })), 'row:src')
  expect(full(later)).toBe('├─ ▸ src/ ·1')
  expect(segWith(later.left, 'src/')?.color).toBe('warning')
  expect(later.right).toEqual([{ text: '●', color: 'warning' }])
  const open = line(treeLines(input({ marks })), 'row:src')
  expect(full(open)).toBe('├─ ▾ src/')
  expect(segWith(open.left, 'src/')).toEqual({ text: 'src/', bold: true })
})

test('a closed folder keeps its count when its name is cut', async () => {
  const listing: Listing = { '': [dir('a-rather-long-folder-name-here')], 'a-rather-long-folder-name-here': [file('x.ts')] }
  let marks = mark({}, 'a-rather-long-folder-name-here/x.ts', 'read', NOW)
  marks = mark(marks, 'a-rather-long-folder-name-here/y.ts', 'read', NOW)
  marks = mark(marks, 'a-rather-long-folder-name-here/z.ts', 'read', NOW)
  const git: GitState = { branch: 'main', files: { 'a-rather-long-folder-name-here/x.ts': 'M' } }
  const rows = flatten('w', listing, () => false)
  const l = line(paneLines(input({ rows, marks, git, width: 30 }), 'ready', '/w'), 'row:a-rather-long-folder-name-here')
  expect(full(l)).toBe('└─ ▸ a-rather-long-fol… ·3')
  expect(l.left.at(-1)).toEqual({ text: ' ·3', color: 'suggestion', keep: true })
  // With no room to spare, the count goes before the name does.
  expect(full(line(paneLines(input({ rows, marks, git, width: 12 }), 'ready', '/w'), 'row:a-rather-long-folder-name-here'))).toBe('└─ ▸ a-…')
})

test('root and guide lines', async () => {
  const lines = treeLines(input())
  expect(lines.map(full)).toEqual(['▾ w/', '├─ ▾ src/', '│  ├─ TS a.ts', '│  └─ M↓ b.md', '├─ M↓ README.md', '└─ {} package.json'])
  expect(lines[2]!.lead).toEqual([{ text: '│  ├─ ', dim: true }])
  const more = treeLines(input({ rows: [{ type: 'root', path: '', name: 'w' }, { type: 'more', path: '', depth: 0, guides: '└─ ', count: 3000 }] }))
  expect(more[1]!.key).toBe('more:')
  expect(text(more[1]!.left)).toBe('└─ … 3000 more')
})

test('deep rows keep their names: past half the width the guides fold into ⋯', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const listing: Listing = { '': [dir('a')] }
  names.forEach((n, i) => {
    const path = names.slice(0, i + 1).join('/')
    listing[path] = i + 1 < names.length ? [dir(names[i + 1]!)] : [file('Component.tsx'), file('Other.tsx')]
  })
  const git: GitState = { branch: 'main', files: { 'a/b/c/d/e/f/g/Component.tsx': 'M' } }
  const rows = flatten('w', listing, () => true)
  const narrow = paneLines(input({ rows, git, width: 24 }), 'ready', '/w')
  const deep = line(narrow, 'row:a/b/c/d/e/f/g/Component.tsx')
  expect(full(deep)).toBe('⋯     ├─ TS Compone…')
  expect(deep.lead).toEqual([{ text: '⋯     ├─ ', dim: true }])
  expect(full(line(narrow, 'row:a/b/c/d/e/f/g'))).toBe('⋯     └─ ▾ g/')
  // Rows that deep line up; shallower ones keep every level.
  expect(full(line(narrow, 'row:a/b'))).toBe('   └─ ▾ b/')
  expect(full(line(narrow, 'row:a/b/c'))).toBe('      └─ ▾ c/')
  expect(full(line(narrow, 'row:a/b/c/d'))).toBe('⋯     └─ ▾ d/')
  for (const each of narrow) expect(cells(full(each)) + cells(text(each.right))).toBeLessThanOrEqual(24)
  // A wide pane draws every level.
  const wide = treeLines(input({ rows, git, width: 120 }))
  expect(full(line(wide, 'row:a/b/c/d/e/f/g/Component.tsx'))).toBe('                     ├─ TS Component.tsx')
})

test('a badge is a bold label on its tile, then a space', async () => {
  const lines = treeLines(input())
  expect(line(lines, 'row:src/a.ts').left).toEqual([{ text: 'TS', color: '#FFFFFF', bg: '#3178C6', bold: true }, { text: ' a.ts' }])
  expect(segWith(line(lines, 'row:package.json').left, '{}')?.bg).toBe('#CB3837')
  // A state colors the name, never the badge.
  const marks = mark({}, 'src/a.ts', 'write', NOW - 60_000)
  const edited = line(treeLines(input({ marks })), 'row:src/a.ts').left
  expect(edited).toEqual([{ text: 'TS', color: '#FFFFFF', bg: '#3178C6', bold: true }, { text: ' ' }, { text: 'a.ts', color: 'warning' }])
})

test('icons: swatches draws the small colored glyphs', async () => {
  const lines = treeLines(input({ icons: 'swatches' }))
  expect(segWith(line(lines, 'row:src/a.ts').left, '▪')?.color).toBe('#3178C6')
  expect(segWith(line(lines, 'row:package.json').left, '◆')).toBeDefined()
  expect(lines.map(full)).toEqual(['▾ w/', '├─ ▾ src/', '│  ├─ ▪ a.ts', '│  └─ ▪ b.md', '├─ ◆ README.md', '└─ ◆ package.json'])
})

test('activity none draws no marks', async () => {
  let marks = mark({}, 'src/a.ts', 'write', NOW)
  marks = mark(marks, 'README.md', 'read', NOW)
  const none = input({ marks, activity: 'none' })
  expect(treeLines(none).every((l) => l.right.length === 0)).toBe(true)
  expect(text(headerLine(none).left)).toBe('◆ canopy')
  expect(headerLine(none).right).toEqual([])
  // 'writes' keeps edits and drops reads.
  const writes = input({ marks, activity: 'writes' })
  expect(line(treeLines(writes), 'row:README.md').right).toEqual([])
  expect(text(line(treeLines(writes), 'row:src/a.ts').right)).toBe('✎')
  expect(text(headerLine(writes).left)).toBe('◆ canopy · ● 1')
})

test('truncates to width', async () => {
  const listing: Listing = { '': [file('a-very-long-file-name-that-goes-on.ts')] }
  const git: GitState = { branch: 'main', files: { 'a-very-long-file-name-that-goes-on.ts': 'M' } }
  const marks = mark({}, 'a-very-long-file-name-that-goes-on.ts', 'write', NOW)
  const lines = paneLines(input({ rows: flatten('w', listing, () => true), marks, git, width: 24 }), 'ready', '/w')
  const l = line(lines, 'row:a-very-long-file-name-that-goes-on.ts')
  expect(text(l.left)).toEndWith('…')
  expect(text(l.right)).toBe('✎ M')
  expect(cells(full(l)) + 1 + cells(text(l.right))).toBeLessThanOrEqual(24)
  for (const each of lines) expect(cells(full(each)) + cells(text(each.right))).toBeLessThanOrEqual(24)
  // The cut keeps the name's style, and a line that fits is untouched.
  expect(segWith(l.left, '…')?.color).toBe('claude')
  const short: Line = { key: 'k', left: [{ text: 'abc' }], right: [{ text: 'M' }] }
  expect(fit(short, 24)).toEqual(short)
  expect(cells('漢字')).toBe(4)
  expect(text(fit({ key: 'k', left: [{ text: '漢字漢字漢字' }], right: [] }, 6).left)).toBe('漢字…')
})

test('emoji take two cells, marks and joiners none', async () => {
  for (const wide of ['🚀', '⚡', '✅', '⭐', '🪩', '😀', '❌', '⏳', '漢', '❤\ufe0f']) expect(cells(wide)).toBe(2)
  expect(cells('e\u0301')).toBe(1)
  expect(cells('❤')).toBe(1)
  expect(cells('a\u200db')).toBe(2)
  // canopy's own glyphs are one cell each.
  for (const glyph of '│├└─▸▾▪◆●○◐◓◑◒✓✎⎇⋯•…⠋↓©$_') expect(cells(glyph)).toBe(1)
  // A row with emoji is cut to the width it really takes.
  const name = '🚀✨-launch-plan-for-the-q3-release-and-beyond.md'
  const listing: Listing = { '': [file(name)] }
  const git: GitState = { branch: 'main', files: { [name]: 'M' } }
  const l = line(paneLines(input({ rows: flatten('w', listing, () => true), git }), 'ready', '/w'), 'row:' + name)
  expect(full(l)).toBe('└─ M↓ 🚀✨-launch-plan-for-the-q3-relea…')
  expect(cells(full(l)) + 1 + cells(text(l.right))).toBeLessThanOrEqual(44)
  expect(text(fit({ key: 'k', left: [{ text: '🚀🚀🚀-launch' }], right: [] }, 6).left)).toBe('🚀🚀…')
})

test('legend and empty lines', async () => {
  const [changes, reads, git] = legendLines('all', true)
  expect(text(changes!.left)).toBe('✎ editing  ● edited  ✓ committed')
  expect(segWith(changes!.left, '✎')?.color).toBe('claude')
  expect(segWith(changes!.left, '●')?.color).toBe('warning')
  expect(segWith(changes!.left, '✓')?.color).toBe('success')
  expect(segWith(changes!.left, 'editing')?.dim).toBe(true)
  expect(reads!.key).toBe('legend:read')
  expect(text(reads!.left)).toBe('◐ reading  ○ read')
  expect(text(git!.left)).toBe('M modified  A added  U untracked  D deleted  R renamed')
  expect(segWith(git!.left, 'M')?.color).toBe('warning')
  expect(segWith(git!.left, 'R')?.color).toBe('suggestion')
  expect(legendLines('all', false)).toHaveLength(2)
  expect(legendLines('writes', false)).toHaveLength(1)
  expect(text(legendLines('writes', false)[0]!.left)).toBe('✎ editing  ● edited  ✓ committed')
  expect(legendLines('none', false)).toEqual([])
  expect(text(emptyLine('unreadable', '/w').left)).toBe("canopy can't read /w — /canopy refresh tries again.")
  expect(emptyLine('loading', '/w').left).toEqual([{ text: 'Reading /w…', dim: true }])
  expect(emptyLine('empty', '/w').left).toEqual([{ text: 'Empty folder — files appear here as Claude creates them.', dim: true }])
})

test('the legend packs whole entries into the width', async () => {
  const at = (width: number) => [...legendLines('all', true, width)].map((l) => [l.key, text(l.left)])
  expect(at(44)).toEqual([
    ['legend', '✎ editing  ● edited  ✓ committed'],
    ['legend:read', '◐ reading  ○ read'],
    ['legend:git', 'M modified  A added  U untracked  D deleted'],
    ['legend:git:2', 'R renamed'],
  ])
  expect(at(30)).toEqual([
    ['legend', '✎ editing  ● edited'],
    ['legend:2', '✓ committed'],
    ['legend:read', '◐ reading  ○ read'],
    ['legend:git', 'M modified  A added'],
    ['legend:git:2', 'U untracked  D deleted'],
    ['legend:git:3', 'R renamed'],
  ])
  const lines = paneLines(input({ git: { branch: 'main', files: {} }, width: 30 }), 'ready', '/w')
  for (const l of lines.filter((l) => l.key.startsWith('legend'))) expect(text(l.left)).not.toContain('…')
})

test('pane lines: header, tree, spacer, legend; or the empty states', async () => {
  const ready = paneLines(input({ git: { branch: 'main', files: {} } }), 'ready', '/w')
  expect(ready.map((l) => l.key)).toEqual([
    'header', 'row:', 'row:src', 'row:src/a.ts', 'row:src/b.md', 'row:README.md', 'row:package.json', 'spacer', 'legend', 'legend:read', 'legend:git',
    'legend:git:2',
  ])
  const empty = paneLines(input({ rows: [{ type: 'root', path: '', name: 'w' }] }), 'empty', '/w')
  expect(empty.map((l) => l.key)).toEqual(['header', 'row:', 'empty'])
  const unreadable = paneLines(input({ rows: [] }), 'unreadable', '/w')
  expect(unreadable.map((l) => l.key)).toEqual(['header', 'empty'])
  expect(paneLines(input({ rows: [] }), 'loading', '/w').map((l) => l.key)).toEqual(['header', 'empty'])
  // A sentence wraps rather than being cut, however narrow the pane.
  const narrow = paneLines(input({ rows: [{ type: 'root', path: '', name: 'w' }], width: 24 }), 'empty', '/w')
  expect(narrow.at(-1)!.left[0]!.text).toBe('Empty folder — files appear here as Claude creates them.')
})

test('node budget keeps a huge tree drawable', async () => {
  const listing: Listing = { '': Array.from({ length: 2000 }, (_, i) => dir('d' + i)) }
  const git: GitState = { branch: 'main', files: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['d' + i + '/x', 'M' as const])) }
  const lines = paneLines(input({ rows: flatten('w', listing, () => false, 2000, 2000), git }), 'ready', '/w')
  const total = 1 + lines.reduce((n, l) => n + nodesOf(l), 0)
  expect(total).toBeLessThanOrEqual(NODE_BUDGET)
  const more = lines.find((l) => l.key === 'overflow')
  expect(more).toBeDefined()
  expect(text(more!.left)).toMatch(/^… \d+ more$/)
  expect(lines.at(-1)!.key).toBe('legend:git:2')
})

test('the text budget keeps the end of a wide pane visible', async () => {
  const long = 'x'.repeat(150)
  const listing: Listing = { '': Array.from({ length: 2000 }, (_, i) => file(`${long}-${i}.ts`)) }
  const lines = paneLines(input({ rows: flatten('w', listing, () => true, 2000, 2000), width: 200 }), 'ready', '/w')
  const chars = lines.reduce((n, l) => n + [...l.left, ...l.right].reduce((m, s) => m + s.text.length, 0), 0)
  expect(chars).toBeLessThanOrEqual(CHAR_BUDGET)
  expect(lines.find((l) => l.key === 'overflow')).toBeDefined()
})

test('names are drawn without control characters', async () => {
  expect(printable('a\u001b[2Jb\n\t\u007f\u009bc')).toBe('a?[2Jb????c')
  expect(rowKey('src/x\u0007.ts')).toBe('row:src/x?.ts')
  const listing: Listing = { '': [dir('d\u0001'), file('f\r')], 'd\u0001': [] }
  const lines = treeLines(input({ rows: flatten('w\u0002', listing, () => true), git: { branch: 'main', files: {} } }))
  for (const l of lines) for (const seg of [...l.left, ...l.right]) expect(seg.text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
  expect(lines.map((l) => l.key)).toEqual(['row:', 'row:d?', 'row:f?'])
  expect(lines[1]!.toggle).toBe('d\u0001')
  expect(text(emptyLine('unreadable', '/w\u0007').left)).toContain('/w?')
})

test('nodes: a box, one per plain segment, two per styled one', async () => {
  expect(nodesOf({ key: 'k', left: [{ text: 'a' }], right: [] })).toBe(2)
  expect(nodesOf({ key: 'k', left: [{ text: 'a', dim: true }], right: [{ text: 'M', color: 'warning' }] })).toBe(1 + 2 + 1 + 2)
  expect(nodesOf({ key: 'k', left: [{ text: 'a' }], right: [], toggle: 'src' })).toBe(3)
  expect(nodesOf({ key: 'k', lead: [{ text: '├─ ', dim: true }], left: [], right: [], toggle: 'src' })).toBe(3)
})

test('a cut reaches into the guides only when the pane is that narrow', async () => {
  const l: Line = { key: 'k', lead: [{ text: '│  ├─ ', dim: true }], left: [{ text: '▸ ', dim: true }, { text: 'src/', bold: true }], right: [{ text: '  M' }], toggle: 'src' }
  expect(fit(l, 14)).toEqual({ ...l, left: [{ text: '▸ ', dim: true }, { text: 's…', bold: true }] })
  expect(fit(l, 8)).toEqual({ ...l, lead: [{ text: '│  …', dim: true }], left: [] })
  expect(fit(l, 4)).toEqual({ ...l, lead: [], left: [] })
})
