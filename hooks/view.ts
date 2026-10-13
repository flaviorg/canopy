// canopy's look: every line of the pane as styled segments, decided here so register.ts only
// turns them into elements. Pure, no mods API.
//
// A line is drawn as one row Box: its lead (the tree's guide lines), its left segments (wrapped
// in a Button when it toggles a folder, so focus and the pointer light the folder, not the
// guides), then, when it has a right side, a growing spacer and the right segments. A segment
// with no style is drawn as a bare string; a styled one as a Text.
import type { Row } from './tree.ts'
import { anyHot, heat, hotCounts, summary, type Activity, type Mark, type Marks } from './activity.ts'
import { badgeFor, rollupAll, type Badge, type GitState } from './git.ts'
import { swatchFor } from './filetypes.ts'

/** canopy's one color, for what is live: the header spinner and activity inside closed folders. */
export const ACCENT = '#5FB97A'

/** `keep`: the end of a left side a cut leaves whole while it can (a closed folder's count). */
export type Seg = { text: string; color?: string; bold?: true; dim?: true; keep?: true }
/**
 * One row of the pane: `lead`, then `left`, then `right` at the edge. `toggle` is the folder a
 * press on `left` opens or closes.
 */
export type Line = { key: string; lead?: Seg[]; left: Seg[]; right: Seg[]; toggle?: string }
export type ViewInput = {
  rows: Row[]
  marks: Marks
  git: GitState
  now: number
  frame: number
  width: number
  activity: Activity
}
export type PaneStatus = 'loading' | 'ready' | 'empty' | 'unreadable'

export const SPIN: readonly string[] = ['◐', '◓', '◑', '◒']
export const BRAILLE: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Elements a pane may hold, with room to spare under the engine's 20,000 (every element and
 * every string counts): a tree past it is refused whole. A tree that would pass it ends in a
 * "… N more" line instead.
 */
export const NODE_BUDGET = 19_000

/** Characters a pane draws: the engine draws 100,000 in all, so the end stays in sight. */
export const CHAR_BUDGET = 95_000

const BADGE_COLOR: Record<Badge, string> = { M: 'warning', A: 'success', D: 'error', R: 'suggestion', U: 'success' }

/** A folder's roll-up of the badges inside it: a small dot in the worst one's color, never ● (editing). */
export const ROLLUP = '•'

/** The fewest cells a cut branch name keeps; below it the branch is left out. */
const BRANCH_MIN = 6

/**
 * `◆ canopy · ⎇ main · ✎ 3 · ◉ 2`, and a spinner on the right while anything is hot. Only the
 * branch is cut to fit, since the counts are what change; and the spinner's two cells are
 * always left free, so the line never moves when it comes and goes.
 */
export function headerLine(input: ViewInput): Line {
  const marks = shown(input.marks, input.activity)
  const { edited, read } = summary(marks)
  const title: Seg = { text: '◆ canopy', bold: true }
  const dot: Seg = { text: ' · ', dim: true }
  const counts: Seg[] = []
  if (edited > 0) counts.push(dot, { text: '✎ ' + edited, color: 'success' })
  if (read > 0) counts.push(dot, { text: '◉ ' + read, color: 'suggestion' })
  const left: Seg[] = [title]
  if (input.git.branch !== null) {
    const room = input.width - 2 - cells(title.text + dot.text + '⎇ ') - cellsIn(counts)
    const branch = printable(input.git.branch)
    if (cells(branch) <= room) left.push(dot, { text: '⎇ ' + branch, dim: true })
    else if (room >= BRANCH_MIN) left.push(dot, { text: '⎇ ' + take(branch, room - 1) + '…', dim: true })
  }
  left.push(...counts)
  const right: Seg[] = anyHot(marks, input.now) ? [{ text: pick(BRAILLE, input.frame), color: ACCENT }] : []
  return { key: 'header', left: merge(left), right }
}

/** A row's key: 'row:' + its path ('row:' is the root), drawable as any text is. */
export function rowKey(path: string): string {
  return 'row:' + printable(path)
}

/**
 * A name as the pane can draw it: the engine refuses a text holding a control character (and
 * a newline would break the row), so each becomes '?', as `ls` shows them. Paths keep the name.
 */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')
}

/** One line per row, keyed by rowKey(). */
export function treeLines(input: ViewInput): Line[] {
  const marks = shown(input.marks, input.activity)
  const slots = hasGit(input.git)
  // Folder facts come from one pass each, not one scan per folder row.
  const inside = hotCounts(marks, input.now)
  const badgeOf = rollupAll(input.git.files)
  const guides = guidesFor(input.width, slots)
  return input.rows.map((row): Line => {
    switch (row.type) {
      case 'root':
        return {
          key: rowKey(''),
          left: [{ text: '▾ ', dim: true }, { text: printable(row.name) + '/', bold: true }],
          right: column(null, badgeOf(''), slots, ROLLUP),
        }
      case 'dir':
        return dirLine({ ...row, guides: guides(row.guides) }, row.expanded ? 0 : inside.get(row.path) ?? 0, badgeOf(row.path), slots)
      case 'file':
        return fileLine({ ...row, guides: guides(row.guides) }, marks[row.path], input, slots)
      case 'more':
        return { key: 'more:' + printable(row.path), left: [{ text: guides(row.guides) + `… ${row.count} more`, dim: true }], right: [] }
    }
  })
}

/** What stands for the levels a deep row's guides leave out. */
export const DEEPER = '⋯  '

// The guides a row draws. They take at most half of what a row has beside its right-hand
// column, so a deep row keeps its name: past that, a row shows its last levels after a dim '⋯',
// and every row that deep lines up at the same indent. Each guide piece is three cells.
function guidesFor(width: number, slots: boolean): (guides: string) => string {
  const room = width - (slots ? 4 : 2) - 2
  const pieces = Math.max(2, Math.floor(room / 6))
  return (guides) => (guides.length <= pieces * 3 ? guides : DEEPER + guides.slice(guides.length - (pieces - 1) * 3))
}

// `inside`: hot or warm files inside a closed folder, so it says how much is happening there.
function dirLine(row: Extract<Row, { type: 'dir' }>, inside: number, badge: Badge | null, slots: boolean): Line {
  const left: Seg[] = [{ text: row.expanded ? '▾ ' : '▸ ', dim: true }, { text: printable(row.name) + '/', bold: true }]
  if (inside > 0) left.push({ text: ' ·' + inside, color: ACCENT, keep: true })
  return { key: rowKey(row.path), lead: [{ text: row.guides, dim: true }], left, right: column(null, badge, slots, ROLLUP), toggle: row.path }
}

function fileLine(row: Extract<Row, { type: 'file' }>, m: Mark | undefined, input: ViewInput, slots: boolean): Line {
  const swatch = swatchFor(row.name)
  const look = activityLook(m, input.now, input.frame)
  const badge = badgeFor(input.git.files, row.path)
  const name: Seg = { text: printable(row.name), ...look.name, ...(badge === 'D' ? { color: 'error' } : {}) }
  return {
    key: rowKey(row.path),
    lead: [{ text: row.guides, dim: true }],
    left: merge([{ text: swatch.glyph + ' ', color: swatch.color }, name]),
    right: column(look.glyph, badge, slots),
  }
}

type Look = { name: Omit<Seg, 'text'>; glyph: Seg | null }

// How a mark shows: hot moves (a write's dot pulses bright and dim, a read spins), warm keeps
// the color, a commit keeps its check for the whole minute. The pulse keeps one glyph, so ●
// always means editing and ◉ (the header's count) always means read.
function activityLook(m: Mark | undefined, now: number, frame: number): Look {
  const h = heat(m, now)
  if (!m || h === 'cold') return { name: {}, glyph: null }
  if (m.kind === 'commit') return { name: { color: 'success' }, glyph: { text: '✓', color: 'success' } }
  if (m.kind === 'write') {
    if (h === 'warm') return { name: { color: 'success' }, glyph: null }
    return { name: { color: 'success', bold: true }, glyph: { text: '●', color: 'success', ...(frame % 2 === 0 ? {} : { dim: true as const }) } }
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

/**
 * The key to the glyphs: activity (as the option allows), then git's letters in a repository.
 * Entries are packed into as many lines as `width` needs; an entry is never cut in two.
 */
export function legendLines(activity: Activity, git: boolean, width = Infinity): Line[] {
  const lines: Line[] = []
  if (activity !== 'none') {
    const items: Array<[Seg, string]> = [[{ text: '●', color: 'success' }, 'editing']]
    if (activity === 'all') items.push([{ text: '◐', color: 'suggestion' }, 'reading'])
    items.push([{ text: '✓', color: 'success' }, 'committed'])
    lines.push(...pack('legend', items, width))
  }
  if (git) {
    const label: Record<Badge, string> = { M: 'modified', A: 'added', U: 'untracked', D: 'deleted', R: 'renamed' }
    const items = (['M', 'A', 'U', 'D', 'R'] as const).map((b): [Seg, string] => [
      { text: b, color: BADGE_COLOR[b], ...(b === 'U' ? { dim: true as const } : {}) },
      label[b],
    ])
    lines.push(...pack('legend:git', items, width))
  }
  return lines
}

// Legend entries (a glyph, then its label in dim) two cells apart, a new line when the next
// one would pass `width`. Lines after the first are keyed `<key>:2`, `<key>:3`…
function pack(key: string, items: Array<[Seg, string]>, width: number): Line[] {
  const rows: Seg[][] = []
  let used = 0
  for (const [glyph, label] of items) {
    const entry: Seg[] = [glyph, { text: ' ' + label, dim: true }]
    const w = cellsIn(entry)
    const row = rows[rows.length - 1]
    if (row && used + 2 + w <= width) {
      row.push({ text: '  ', dim: true }, ...entry)
      used += 2 + w
    } else {
      rows.push(entry)
      used = w
    }
  }
  return rows.map((segs, i) => ({ key: i === 0 ? key : `${key}:${i + 1}`, left: merge(segs), right: [] }))
}

/** What the pane says instead of a tree: before the first scan, when it fails, or when empty. */
export function emptyLine(reason: Exclude<PaneStatus, 'ready'>, root: string): Line {
  const where = printable(root)
  const say: Record<typeof reason, Seg> = {
    loading: { text: `Reading ${where}…`, dim: true },
    unreadable: { text: `canopy can't read ${where} — /canopy refresh tries again.` },
    empty: { text: 'Empty folder — files appear here as Claude creates them.', dim: true },
  }
  return { key: 'empty', left: [say[reason]], right: [] }
}

/**
 * Every line of the pane, fitted to its width and kept under the node budget. The empty-state
 * sentence is left whole: it wraps rather than being cut.
 */
export function paneLines(input: ViewInput, status: PaneStatus, root: string): Line[] {
  const header = fit(headerLine(input), input.width)
  if (status === 'loading' || status === 'unreadable') return [header, emptyLine(status, root)]
  const tree = treeLines(input)
  if (status === 'empty') return [header, ...tree.map((l) => fit(l, input.width)), emptyLine('empty', root)]
  const legend = legendLines(input.activity, hasGit(input.git), input.width)
  const tail = [...(legend.length ? [{ key: 'spacer', left: [{ text: ' ' }], right: [] }] : []), ...legend].map((l) => fit(l, input.width))
  const fixed = [header, ...tail]
  const nodes = NODE_BUDGET - 1 - fixed.reduce((n, l) => n + nodesOf(l), 0)
  const chars = CHAR_BUDGET - fixed.reduce((n, l) => n + charsOf(l), 0)
  return [header, ...budgeted(tree.map((l) => fit(l, input.width)), nodes, chars), ...tail]
}

// Keeps lines while they fit both budgets; the rest become one "… N more" line.
function budgeted(lines: Line[], nodes: number, chars: number): Line[] {
  const more = (n: number): Line => ({ key: 'overflow', left: [{ text: `… ${n} more`, dim: true }], right: [] })
  const reserve = more(lines.length)
  let usedNodes = nodesOf(reserve)
  let usedChars = charsOf(reserve)
  for (let i = 0; i < lines.length; i++) {
    usedNodes += nodesOf(lines[i]!)
    usedChars += charsOf(lines[i]!)
    if (usedNodes > nodes || usedChars > chars) return [...lines.slice(0, i), more(lines.length - i)]
  }
  return lines
}

function charsOf(line: Line): number {
  return [...(line.lead ?? []), ...line.left, ...line.right].reduce((n, s) => n + s.text.length, 0)
}

/** The elements a line draws as (see the note at the top): a Button only around a left side. */
export function nodesOf(line: Line): number {
  const segs = (list: Seg[]) => list.reduce((n, s) => n + (isPlain(s) ? 1 : 2), 0)
  const button = line.toggle !== undefined && line.left.length > 0 ? 1 : 0
  return 1 + segs(line.lead ?? []) + button + segs(line.left) + (line.right.length ? 1 + segs(line.right) : 0)
}

/**
 * Cuts the lead and left side with '…' so the line fits `width` cells; the right side is never
 * cut. A kept end stays whole after the cut while the rest still has a few cells to show.
 */
export function fit(line: Line, width: number): Line {
  const lead = line.lead ?? []
  const rightCells = cellsIn(line.right)
  const room = width - rightCells - (rightCells > 0 ? 1 : 0)
  if (cellsIn(lead) + cellsIn(line.left) <= room) return line
  let end = line.left.length
  while (end > 0 && line.left[end - 1]!.keep) end--
  const tail = line.left.slice(end)
  const keep = tail.length > 0 && room - cellsIn(tail) >= cellsIn(lead) + 4
  const kept = keep ? cut([...lead, ...line.left.slice(0, end)], room - cellsIn(tail)) : cut([...lead, ...line.left], room)
  const left = [...kept.slice(lead.length), ...(keep ? tail : [])]
  return line.lead === undefined ? { ...line, left } : { ...line, lead: kept.slice(0, lead.length), left }
}

// The segments that fit `room` cells, the last one cut and ended with '…'; none below one cell.
function cut(segs: Seg[], room: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const seg of segs) {
    const w = cells(seg.text)
    if (used + w <= room - 1) {
      out.push(seg)
      used += w
      continue
    }
    if (room >= 1) out.push({ ...seg, text: take(seg.text, room - 1 - used) + '…' })
    break
  }
  return out
}

function cellsIn(segs: Seg[]): number {
  return segs.reduce((n, s) => n + cells(s.text), 0)
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
    const same = last && last.color === seg.color && last.bold === seg.bold && last.dim === seg.dim && last.keep === seg.keep
    if (same) out[out.length - 1] = { ...last, text: last.text + seg.text }
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
