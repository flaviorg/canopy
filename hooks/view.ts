// canopy's look: every line of the pane as styled segments, decided here so register.ts only
// turns them into elements. Pure, no mods API.
//
// A line is drawn as one row Box: its left segments (wrapped in a Button when it toggles a
// folder), then, when it has a right side, a growing spacer and the right segments. A segment
// with no style is drawn as a bare string; a styled one as a Text.
import type { Row } from './tree.ts'
import { anyHot, heat, hotCounts, summary, type Activity, type Mark, type Marks } from './activity.ts'
import { badgeFor, rollupAll, type Badge, type GitState } from './git.ts'
import { swatchFor } from './filetypes.ts'

/** canopy's one color, for what is live: the header spinner and activity inside closed folders. */
export const ACCENT = '#5FB97A'

export type Seg = { text: string; color?: string; bold?: true; dim?: true }
/** One row of the pane. `toggle` is the folder a press on it opens or closes. */
export type Line = { key: string; left: Seg[]; right: Seg[]; toggle?: string }
export type ViewInput = {
  rows: Row[]
  marks: Marks
  git: GitState
  now: number
  frame: number
  width: number
  activity: Activity
}
export type PaneStatus = 'ready' | 'empty' | 'unreadable'

export const SPIN: readonly string[] = ['◐', '◓', '◑', '◒']
export const BRAILLE: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Elements a pane may hold, with room to spare under the engine's 20,000 (every element and
 * every string counts). A tree that would pass it ends in a "… N more" line instead.
 */
export const NODE_BUDGET = 19_000

const BADGE_COLOR: Record<Badge, string> = { M: 'warning', A: 'success', D: 'error', R: 'suggestion', U: 'success' }

/** `◆ canopy · ⎇ main · ✎ 3 · ◉ 2`, and a spinner on the right while anything is hot. */
export function headerLine(input: ViewInput): Line {
  const marks = shown(input.marks, input.activity)
  const { edited, read } = summary(marks)
  const left: Seg[] = [{ text: '◆ canopy', bold: true }]
  const fact = (seg: Seg) => left.push({ text: ' · ', dim: true }, seg)
  if (input.git.branch !== null) fact({ text: '⎇ ' + input.git.branch, dim: true })
  if (edited > 0) fact({ text: '✎ ' + edited, color: 'success' })
  if (read > 0) fact({ text: '◉ ' + read, color: 'suggestion' })
  const right: Seg[] = anyHot(marks, input.now) ? [{ text: pick(BRAILLE, input.frame), color: ACCENT }] : []
  return { key: 'header', left: merge(left), right }
}

/** One line per row, keyed 'row:' + path ('row:' is the root). */
export function treeLines(input: ViewInput): Line[] {
  const marks = shown(input.marks, input.activity)
  const slots = hasGit(input.git)
  // Folder facts come from one pass each, not one scan per folder row.
  const inside = hotCounts(marks, input.now)
  const badgeOf = rollupAll(input.git.files)
  return input.rows.map((row): Line => {
    switch (row.type) {
      case 'root':
        return {
          key: 'row:',
          left: [{ text: '▾ ', dim: true }, { text: row.name + '/', bold: true }],
          right: column(null, badgeOf(''), slots, '●'),
        }
      case 'dir':
        return dirLine(row, row.expanded ? 0 : inside.get(row.path) ?? 0, badgeOf(row.path), slots)
      case 'file':
        return fileLine(row, marks[row.path], input, slots)
      case 'more':
        return { key: 'more:' + row.path, left: merge([{ text: row.guides, dim: true }, { text: `… ${row.count} more`, dim: true }]), right: [] }
    }
  })
}

// `inside`: hot or warm files inside a closed folder, so it says how much is happening there.
function dirLine(row: Extract<Row, { type: 'dir' }>, inside: number, badge: Badge | null, slots: boolean): Line {
  const left: Seg[] = [{ text: row.guides + (row.expanded ? '▾ ' : '▸ '), dim: true }, { text: row.name + '/', bold: true }]
  if (inside > 0) left.push({ text: ' ·' + inside, color: ACCENT })
  return { key: 'row:' + row.path, left, right: column(null, badge, slots, '●'), toggle: row.path }
}

function fileLine(row: Extract<Row, { type: 'file' }>, m: Mark | undefined, input: ViewInput, slots: boolean): Line {
  const swatch = swatchFor(row.name)
  const look = activityLook(m, input.now, input.frame)
  const badge = badgeFor(input.git.files, row.path)
  const name: Seg = { text: row.name, ...look.name, ...(badge === 'D' ? { color: 'error' } : {}) }
  return {
    key: 'row:' + row.path,
    left: merge([{ text: row.guides, dim: true }, { text: swatch.glyph + ' ', color: swatch.color }, name]),
    right: column(look.glyph, badge, slots),
  }
}

type Look = { name: Omit<Seg, 'text'>; glyph: Seg | null }

// How a mark shows: hot moves (a pulse for a write, a spinner for a read), warm keeps the color,
// a commit keeps its check for the whole minute.
function activityLook(m: Mark | undefined, now: number, frame: number): Look {
  const h = heat(m, now)
  if (!m || h === 'cold') return { name: {}, glyph: null }
  if (m.kind === 'commit') return { name: { color: 'success' }, glyph: { text: '✓', color: 'success' } }
  if (m.kind === 'write') {
    if (h === 'warm') return { name: { color: 'success' }, glyph: null }
    return { name: { color: 'success', bold: true }, glyph: { text: frame % 2 === 0 ? '●' : '◉', color: 'success' } }
  }
  if (h === 'warm') return { name: {}, glyph: { text: '·', color: 'suggestion' } }
  return { name: { color: 'suggestion' }, glyph: { text: pick(SPIN, frame), color: 'suggestion' } }
}

// The right side. In a repository it is two columns, activity then badge, so badges line up
// at the edge and activity two cells before them; elsewhere just the activity glyph.
function column(glyph: Seg | null, badge: Badge | null, slots: boolean, badgeGlyph?: string): Seg[] {
  if (!slots || badge === null) {
    if (!glyph) return []
    return [slots ? { ...glyph, text: glyph.text + '  ' } : glyph]
  }
  const mark: Seg = { text: badgeGlyph ?? badge, color: BADGE_COLOR[badge], ...(badge === 'U' ? { dim: true as const } : {}) }
  return merge([glyph ? { ...glyph, text: glyph.text + ' ' } : { text: '  ' }, mark])
}

/** The key to the glyphs: activity (as the option allows), then git's letters in a repository. */
export function legendLines(activity: Activity, git: boolean): Line[] {
  const lines: Line[] = []
  const entries = (items: Array<[Seg, string]>): Seg[] =>
    merge(items.flatMap(([glyph, label], i) => [glyph, { text: ' ' + label + (i < items.length - 1 ? '  ' : ''), dim: true as const }]))
  if (activity !== 'none') {
    const items: Array<[Seg, string]> = [[{ text: '●', color: 'success' }, 'editing']]
    if (activity === 'all') items.push([{ text: '◐', color: 'suggestion' }, 'reading'])
    items.push([{ text: '✓', color: 'success' }, 'committed'])
    lines.push({ key: 'legend', left: entries(items), right: [] })
  }
  if (git) {
    const letters = (['M', 'A', 'U', 'D'] as const).map((b): [Seg, string] => [
      { text: b, color: BADGE_COLOR[b], ...(b === 'U' ? { dim: true as const } : {}) },
      { M: 'modified', A: 'added', U: 'new', D: 'deleted' }[b],
    ])
    lines.push({ key: 'legend:git', left: entries(letters), right: [] })
  }
  return lines
}

/** What the pane says instead of a tree. */
export function emptyLine(reason: 'unreadable' | 'empty', root: string): Line {
  const say: Seg = reason === 'unreadable'
    ? { text: `canopy can't read ${root}.` }
    : { text: 'Empty folder — files appear here as Claude creates them.', dim: true }
  return { key: 'empty', left: [say], right: [] }
}

/**
 * Every line of the pane, fitted to its width and kept under the node budget. The empty-state
 * sentence is left whole: it wraps rather than being cut.
 */
export function paneLines(input: ViewInput, status: PaneStatus, root: string): Line[] {
  const header = fit(headerLine(input), input.width)
  if (status === 'unreadable') return [header, emptyLine('unreadable', root)]
  const tree = treeLines(input)
  if (status === 'empty') return [header, ...tree.map((l) => fit(l, input.width)), emptyLine('empty', root)]
  const legend = legendLines(input.activity, hasGit(input.git))
  const tail = legend.length ? [{ key: 'spacer', left: [{ text: ' ' }], right: [] }, ...legend] : []
  const fixed = 1 + nodesOf(header) + tail.reduce((n, l) => n + nodesOf(l), 0)
  return [header, ...[...budgeted(tree, NODE_BUDGET - fixed), ...tail].map((l) => fit(l, input.width))]
}

// Keeps lines while they fit the budget; the rest become one "… N more" line.
function budgeted(lines: Line[], budget: number): Line[] {
  const more = (n: number): Line => ({ key: 'overflow', left: [{ text: `… ${n} more`, dim: true }], right: [] })
  const reserve = nodesOf(more(lines.length))
  let used = 0
  for (let i = 0; i < lines.length; i++) {
    used += nodesOf(lines[i]!)
    if (used > budget - reserve) return [...lines.slice(0, i), more(lines.length - i)]
  }
  return lines
}

/** The elements a line draws as (see the note at the top). */
export function nodesOf(line: Line): number {
  const segs = (list: Seg[]) => list.reduce((n, s) => n + (isPlain(s) ? 1 : 2), 0)
  return 1 + (line.toggle !== undefined ? 1 : 0) + segs(line.left) + (line.right.length ? 1 + segs(line.right) : 0)
}

/** Cuts the left side with '…' so the line fits `width` cells; the right side is never cut. */
export function fit(line: Line, width: number): Line {
  const rightCells = cells(line.right.map((s) => s.text).join(''))
  const room = width - rightCells - (rightCells > 0 ? 1 : 0)
  if (cells(line.left.map((s) => s.text).join('')) <= room) return line
  const left: Seg[] = []
  let used = 0
  for (const seg of line.left) {
    const w = cells(seg.text)
    if (used + w <= room - 1) {
      left.push(seg)
      used += w
      continue
    }
    if (room >= 1) left.push({ ...seg, text: take(seg.text, room - 1 - used) + '…' })
    break
  }
  return { ...line, left }
}

/** Terminal cells a string takes: wide (East Asian, emoji) characters take two. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += cellsOf(ch.codePointAt(0)!)
  return n
}

function take(text: string, room: number): string {
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cellsOf(ch.codePointAt(0)!)
    if (used + w > room) break
    out += ch
    used += w
  }
  return out
}

function cellsOf(cp: number): number {
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  return wide ? 2 : 1
}

// Joins neighbours that look the same (fewer elements to draw) and drops empty ones.
function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const seg of segs) {
    if (!seg.text) continue
    const last = out[out.length - 1]
    if (last && last.color === seg.color && last.bold === seg.bold && last.dim === seg.dim) out[out.length - 1] = { ...last, text: last.text + seg.text }
    else out.push(seg)
  }
  return out
}

function isPlain(seg: Seg): boolean {
  return seg.color === undefined && !seg.bold && !seg.dim
}

// The marks the `activity` option lets show: none, writes and commits only, or all.
function shown(marks: Marks, activity: Activity): Marks {
  if (activity === 'all') return marks
  if (activity === 'none') return {}
  return Object.fromEntries(Object.entries(marks).filter(([, m]) => m.kind !== 'read'))
}

function hasGit(git: GitState): boolean {
  return git.branch !== null || Object.keys(git.files).length > 0
}

function pick(frames: readonly string[], frame: number): string {
  return frames[((frame % frames.length) + frames.length) % frames.length]!
}
