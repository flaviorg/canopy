import { expect, test } from 'claude-code/testing'
import { flatten, type Listing } from '../hooks/tree.ts'
import { mark, type Marks } from '../hooks/activity.ts'
import { NO_GIT, type GitState } from '../hooks/git.ts'
import {
  ACCENT, BRAILLE, cells, emptyLine, fit, headerLine, legendLines, NODE_BUDGET, nodesOf, paneLines, SPIN, treeLines,
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
  expect(text(header.left)).toBe('◆ canopy · ⎇ main · ✎ 1 · ◉ 1')
  expect(header.left[0]).toEqual({ text: '◆ canopy', bold: true })
  expect(segWith(header.left, '✎')?.color).toBe('success')
  expect(segWith(header.left, '◉')?.color).toBe('suggestion')
  expect(header.right).toEqual([{ text: BRAILLE[0], color: ACCENT }])
  // Quiet: no branch outside git, no counts, no spinner.
  const quiet = headerLine(input({ now: NOW }))
  expect(text(quiet.left)).toBe('◆ canopy')
  expect(quiet.right).toEqual([])
})

test('hot write pulses', async () => {
  const marks = mark({}, 'src/a.ts', 'write', NOW)
  const f0 = line(treeLines(input({ marks, frame: 0 })), 'row:src/a.ts')
  const f1 = line(treeLines(input({ marks, frame: 1 })), 'row:src/a.ts')
  expect(text(f0.right).trim()).toBe('●')
  expect(text(f1.right).trim()).toBe('◉')
  expect(nameSeg(f0, 'a.ts')).toEqual({ text: 'a.ts', color: 'success', bold: true })
})

test('hot read spins', async () => {
  const marks = mark({}, 'README.md', 'read', NOW)
  const glyphs = [0, 1, 2, 3].map((frame) => text(line(treeLines(input({ marks, frame })), 'row:README.md').right).trim())
  expect(glyphs).toEqual(SPIN)
  const l = line(treeLines(input({ marks })), 'row:README.md')
  expect(nameSeg(l, 'README.md').color).toBe('suggestion')
  expect(l.right[0]?.color).toBe('suggestion')
})

test('warm write keeps color without motion', async () => {
  const marks = mark({}, 'src/a.ts', 'write', NOW)
  const l = line(treeLines(input({ marks, now: NOW + 9_000 })), 'row:src/a.ts')
  expect(l.right).toEqual([])
  expect(nameSeg(l, 'a.ts')).toEqual({ text: 'a.ts', color: 'success' })
  // A warm read leaves a quiet dot; a cold mark draws nothing.
  const read = mark({}, 'src/a.ts', 'read', NOW)
  expect(text(line(treeLines(input({ marks: read, now: NOW + 9_000 })), 'row:src/a.ts').right)).toBe('·')
  const cold = line(treeLines(input({ marks: read, now: NOW + 90_000 })), 'row:src/a.ts')
  expect(cold.right).toEqual([])
  expect(nameSeg(cold, 'a.ts')).toEqual({ text: 'a.ts' })
})

test('commit shows check', async () => {
  const marks = mark({}, 'src/a.ts', 'commit', NOW)
  for (const now of [NOW, NOW + 30_000]) {
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
  expect(text(a.right)).toBe('● M')
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
  expect(line(lines, 'row:src').right.at(-1)).toEqual({ text: '●', color: 'error' })
  expect(line(lines, 'row:').right.at(-1)).toEqual({ text: '●', color: 'error' })
  const clean = treeLines(input({ git: { branch: 'main', files: {} } }))
  expect(line(clean, 'row:src').right).toEqual([])
})

test('collapsed dir shows activity count', async () => {
  const marks = mark({}, 'src/a.ts', 'write', NOW)
  const collapsed = treeLines(input({ marks, open: (rel) => rel !== 'src' }))
  const src = line(collapsed, 'row:src')
  expect(src.toggle).toBe('src')
  expect(text(src.left)).toBe('├─ ▸ src/ ·1')
  expect(segWith(src.left, '·1')?.color).toBe(ACCENT)
  expect(collapsed.some((l) => l.key === 'row:src/a.ts')).toBe(false)
  const open = line(treeLines(input({ marks })), 'row:src')
  expect(text(open.left)).toBe('├─ ▾ src/')
  expect(segWith(open.left, 'src/')).toEqual({ text: 'src/', bold: true })
})

test('root and guide lines', async () => {
  const lines = treeLines(input())
  expect(lines.map((l) => text(l.left))).toEqual(['▾ w/', '├─ ▾ src/', '│  ├─ ▪ a.ts', '│  └─ ▪ b.md', '├─ ◆ README.md', '└─ ◆ package.json'])
  expect(segWith(lines[2]!.left, '│  ├─ ')?.dim).toBe(true)
  const more = treeLines(input({ rows: [{ type: 'root', path: '', name: 'w' }, { type: 'more', path: '', depth: 0, guides: '└─ ', count: 3000 }] }))
  expect(more[1]!.key).toBe('more:')
  expect(text(more[1]!.left)).toBe('└─ … 3000 more')
})

test('swatch colors', async () => {
  const lines = treeLines(input())
  expect(segWith(line(lines, 'row:src/a.ts').left, '▪')?.color).toBe('#3178C6')
  expect(segWith(line(lines, 'row:package.json').left, '◆')).toBeDefined()
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
  expect(text(line(treeLines(writes), 'row:src/a.ts').right)).toBe('●')
})

test('truncates to width', async () => {
  const listing: Listing = { '': [file('a-very-long-file-name-that-goes-on.ts')] }
  const git: GitState = { branch: 'main', files: { 'a-very-long-file-name-that-goes-on.ts': 'M' } }
  const marks = mark({}, 'a-very-long-file-name-that-goes-on.ts', 'write', NOW)
  const lines = paneLines(input({ rows: flatten('w', listing, () => true), marks, git, width: 24 }), 'ready', '/w')
  const l = line(lines, 'row:a-very-long-file-name-that-goes-on.ts')
  expect(text(l.left)).toEndWith('…')
  expect(text(l.right)).toBe('● M')
  expect(cells(text(l.left)) + 1 + cells(text(l.right))).toBeLessThanOrEqual(24)
  for (const each of lines) expect(cells(text(each.left)) + cells(text(each.right))).toBeLessThanOrEqual(24)
  // The cut keeps the name's style, and a line that fits is untouched.
  expect(segWith(l.left, '…')?.color).toBe('success')
  const short: Line = { key: 'k', left: [{ text: 'abc' }], right: [{ text: 'M' }] }
  expect(fit(short, 24)).toEqual(short)
  expect(cells('漢字')).toBe(4)
  expect(text(fit({ key: 'k', left: [{ text: '漢字漢字漢字' }], right: [] }, 6).left)).toBe('漢字…')
})

test('legend and empty lines', async () => {
  const [activity, git] = legendLines('all', true)
  expect(text(activity!.left)).toBe('● editing  ◐ reading  ✓ committed')
  expect(segWith(activity!.left, '●')?.color).toBe('success')
  expect(segWith(activity!.left, 'editing')?.dim).toBe(true)
  expect(text(git!.left)).toBe('M modified  A added  U new  D deleted')
  expect(segWith(git!.left, 'M')?.color).toBe('warning')
  expect(legendLines('all', false)).toHaveLength(1)
  expect(text(legendLines('writes', false)[0]!.left)).toBe('● editing  ✓ committed')
  expect(legendLines('none', false)).toEqual([])
  expect(text(emptyLine('unreadable', '/w').left)).toBe("canopy can't read /w.")
  expect(emptyLine('empty', '/w').left).toEqual([{ text: 'Empty folder — files appear here as Claude creates them.', dim: true }])
})

test('pane lines: header, tree, spacer, legend; or the empty states', async () => {
  const ready = paneLines(input({ git: { branch: 'main', files: {} } }), 'ready', '/w')
  expect(ready.map((l) => l.key)).toEqual(['header', 'row:', 'row:src', 'row:src/a.ts', 'row:src/b.md', 'row:README.md', 'row:package.json', 'spacer', 'legend', 'legend:git'])
  const empty = paneLines(input({ rows: [{ type: 'root', path: '', name: 'w' }] }), 'empty', '/w')
  expect(empty.map((l) => l.key)).toEqual(['header', 'row:', 'empty'])
  const unreadable = paneLines(input({ rows: [] }), 'unreadable', '/w')
  expect(unreadable.map((l) => l.key)).toEqual(['header', 'empty'])
  // A sentence wraps rather than being cut, however narrow the pane.
  const narrow = paneLines(input({ rows: [{ type: 'root', path: '', name: 'w' }], width: 24 }), 'empty', '/w')
  expect(narrow.at(-1)!.left[0]!.text).toBe('Empty folder — files appear here as Claude creates them.')
})

test('node budget keeps a huge tree drawable', async () => {
  const listing: Listing = { '': Array.from({ length: 2000 }, (_, i) => dir('d' + i)) }
  const git: GitState = { branch: 'main', files: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['d' + i + '/x', 'M' as const])) }
  const lines = paneLines(input({ rows: flatten('w', listing, () => false), git }), 'ready', '/w')
  const total = 1 + lines.reduce((n, l) => n + nodesOf(l), 0)
  expect(total).toBeLessThanOrEqual(NODE_BUDGET)
  const more = lines.find((l) => l.key === 'overflow')
  expect(more).toBeDefined()
  expect(text(more!.left)).toMatch(/^… \d+ more$/)
  expect(lines.at(-1)!.key).toBe('legend:git')
})

test('nodes: a box, one per plain segment, two per styled one', async () => {
  expect(nodesOf({ key: 'k', left: [{ text: 'a' }], right: [] })).toBe(2)
  expect(nodesOf({ key: 'k', left: [{ text: 'a', dim: true }], right: [{ text: 'M', color: 'warning' }] })).toBe(1 + 2 + 1 + 2)
  expect(nodesOf({ key: 'k', left: [{ text: 'a' }], right: [], toggle: 'src' })).toBe(3)
})
