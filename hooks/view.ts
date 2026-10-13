// canopy's look: every line of the pane as styled segments, decided here so register.ts only
// turns them into elements. Pure, no mods API.
//
// A line is drawn as one row Box: its lead (the tree's guide lines), its left segments (wrapped
// in a Button when it toggles a folder, so focus and the pointer light the folder, not the
// guides), then, when it has a right side, a growing spacer and the right segments. A segment
// with no style is drawn as a bare string; a styled one as a Text.
import type { Row } from './tree.ts'
import { rollup, stateOf, tally, type Activity, type FileState, type Marks } from './activity.ts'
import { badgeFor, rollupAll, type Badge, type GitState } from './git.ts'
import { iconFor, swatchFor } from './filetypes.ts'

/**
 * `keep`: the end of a left side a cut leaves whole while it can (a closed folder's count).
 * `bg`: a tile behind the text (a file's badge).
 */
export type Seg = { text: string; color?: string; bg?: string; bold?: true; dim?: true; keep?: true }
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
  /** How a file's type shows: a two-letter badge (the default) or a small colored glyph. */
  icons?: Icons
}
export type Icons = 'badges' | 'swatches'
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

/**
 * Each state's color: Claude's own while it writes, then git's for what waits for a commit
 * (yellow, like M) and what landed (green); blue for reading. Theme keys, so they follow the
 * person's theme.
 */
export const STATE_COLOR: Readonly<Record<FileState, string>> = {
  editing: 'claude', edited: 'warning', committed: 'success', reading: 'suggestion', read: 'suggestion',
}

/**
 * The glyph a state draws in a row's activity column: a pencil pulsing bright and dim while
 * Claude writes, a dot for a change not yet committed, a check once committed, a quarter moon
 * turning while Claude reads, a ring once read.
 */
export function stateGlyph(state: FileState, frame: number): Seg {
  switch (state) {
    case 'editing':
      return { text: '✎', color: STATE_COLOR.editing, ...(frame % 2 === 0 ? {} : { dim: true as const }) }
    case 'edited':
      return { text: '●', color: STATE_COLOR.edited }
    case 'committed':
      return { text: '✓', color: STATE_COLOR.committed }
    case 'reading':
      return { text: pick(SPIN, frame), color: STATE_COLOR.reading }
    case 'read':
      return { text: '○', color: STATE_COLOR.read }
  }
}

/** A folder's roll-up of the badges inside it: a small dot in the worst one's color, never ● (editing). */
export const ROLLUP = '•'

/** The fewest cells a cut branch name keeps; below it the branch is left out. */
const BRANCH_MIN = 6

/**
 * `◆ canopy · ⎇ main · ● 3 · ✓ 1 · ○ 2` (changed, committed, read), and a spinner on the right
 * while Claude is reading or writing a file. Only the branch is cut to fit, since the counts
 * are what change; and the spinner's two cells are always left free, so the line never moves
 * when it comes and goes.
 */
export function headerLine(input: ViewInput): Line {
  const { edited, committed, read } = tally(input.marks, input.now, input.activity)
  const title: Seg = { text: '◆ canopy', bold: true }
  const dot: Seg = { text: ' · ', dim: true }
  const counts: Seg[] = []
  if (edited > 0) counts.push(dot, { text: '● ' + edited, color: STATE_COLOR.edited })
  if (committed > 0) counts.push(dot, { text: '✓ ' + committed, color: STATE_COLOR.committed })
  if (read > 0) counts.push(dot, { text: '○ ' + read, color: STATE_COLOR.read })
  const left: Seg[] = [title]
  if (input.git.branch !== null) {
    const room = input.width - 2 - cells(title.text + dot.text + '⎇ ') - cellsIn(counts)
    const branch = printable(input.git.branch)
    if (cells(branch) <= room) left.push(dot, { text: '⎇ ' + branch, dim: true })
    else if (room >= BRANCH_MIN) left.push(dot, { text: '⎇ ' + take(branch, room - 1) + '…', dim: true })
  }
  left.push(...counts)
  const right: Seg[] = working(input) ? [{ text: pick(BRAILLE, input.frame), color: STATE_COLOR.editing }] : []
  return { key: 'header', left: merge(left), right }
}

// Whether Claude is reading or writing a file right now, as the activity option shows it.
function working(input: ViewInput): boolean {
  return Object.values(input.marks).some((m) => {
    const state = stateOf(m, input.now, input.activity)
    return state === 'editing' || state === 'reading'
  })
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
  const slots = hasGit(input.git)
  // Folder facts come from one pass each, not one scan per folder row.
  const inside = rollup(input.marks, input.now, input.activity)
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
        return dirLine({ ...row, guides: guides(row.guides) }, row.expanded ? null : inside.get(row.path) ?? null, badgeOf(row.path), slots, input.frame)
      case 'file':
        return fileLine({ ...row, guides: guides(row.guides) }, stateOf(input.marks[row.path], input.now, input.activity), input, slots)
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

// `inside`: a closed folder's strongest state and how many files inside share it, so the work
// in there stays in sight; null for an open folder (its rows show it) or a quiet one.
function dirLine(row: Extract<Row, { type: 'dir' }>, inside: { state: FileState; count: number } | null, badge: Badge | null, slots: boolean, frame: number): Line {
  const color = inside ? STATE_COLOR[inside.state] : undefined
  const left: Seg[] = [{ text: row.expanded ? '▾ ' : '▸ ', dim: true }, { text: printable(row.name) + '/', bold: true, ...(color ? { color } : {}) }]
  if (inside) left.push({ text: ' ·' + inside.count, color, keep: true })
  const glyph = inside ? stateGlyph(inside.state, frame) : null
  return { key: rowKey(row.path), lead: [{ text: row.guides, dim: true }], left, right: column(glyph, badge, slots, ROLLUP), toggle: row.path }
}

function fileLine(row: Extract<Row, { type: 'file' }>, state: FileState | null, input: ViewInput, slots: boolean): Line {
  const badge = badgeFor(input.git.files, row.path)
  const name: Seg = { text: printable(row.name), ...nameLook(state), ...(badge === 'D' ? { color: 'error' } : {}) }
  return {
    key: rowKey(row.path),
    lead: [{ text: row.guides, dim: true }],
    left: merge([...iconSegs(row.name, input.icons ?? 'badges'), name]),
    right: column(state ? stateGlyph(state, input.frame) : null, badge, slots),
  }
}

// A file's name in its state's color, bold while Claude writes it. A file only read keeps its
// plain name: the ring beside it says enough.
function nameLook(state: FileState | null): Omit<Seg, 'text'> {
  if (state === null || state === 'read') return {}
  return state === 'editing' ? { color: STATE_COLOR.editing, bold: true } : { color: STATE_COLOR[state] }
}

// The icon before a name: a bold two-letter badge on its tile and a space, or a swatch.
function iconSegs(name: string, icons: Icons): Seg[] {
  if (icons === 'swatches') {
    const swatch = swatchFor(name)
    return [{ text: swatch.glyph + ' ', color: swatch.color }]
  }
  const icon = iconFor(name)
  return [{ text: icon.label, color: icon.fg, bg: icon.bg, bold: true }, { text: ' ' }]
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
 * The key to the glyphs: what Claude changed, what it read (as the activity option allows),
 * then git's letters in a repository. Each group is packed into as many lines as `width`
 * needs; an entry is never cut in two.
 */
export function legendLines(activity: Activity, git: boolean, width = Infinity): Line[] {
  const lines: Line[] = []
  const entry = (state: FileState): [Seg, string] => [stateGlyph(state, 0), state]
  if (activity !== 'none') lines.push(...pack('legend', [entry('editing'), entry('edited'), entry('committed')], width))
  if (activity === 'all') lines.push(...pack('legend:read', [entry('reading'), entry('read')], width))
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

/**
 * Terminal cells a string takes: wide characters (East Asian, emoji) take two, combining marks
 * and joiners none. A guess that errs wide, so a row never runs past its width.
 */
export function cells(text: string): number {
  let n = 0
  let before = 0
  for (const ch of text) {
    const w = widthOf(ch, before)
    n += w
    if (w > 0) before = ch === EMOJI_LOOK ? 2 : w
  }
  return n
}

function take(text: string, room: number): string {
  let out = ''
  let used = 0
  let before = 0
  for (const ch of text) {
    const w = widthOf(ch, before)
    if (used + w > room) break
    out += ch
    used += w
    if (w > 0) before = ch === EMOJI_LOOK ? 2 : w
  }
  return out
}

/** U+FE0F asks for a character's emoji look, two cells wide. */
const EMOJI_LOOK = '\ufe0f'
const WIDE_EMOJI = /\p{Emoji_Presentation}/u
const NO_WIDTH = /[\p{Mn}\p{Me}\u200b-\u200f\u2060\ufe00-\ufe0e]/u

// The cells `ch` adds after a character `before` cells wide.
function widthOf(ch: string, before: number): number {
  const cp = ch.codePointAt(0)!
  if (cp < 0x300) return 1
  if (ch === EMOJI_LOOK) return before === 1 ? 1 : 0
  if (NO_WIDTH.test(ch)) return 0
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd) || WIDE_EMOJI.test(ch)
  return wide ? 2 : 1
}

// Joins neighbours that look the same (fewer elements to draw) and drops empty ones.
function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const seg of segs) {
    if (!seg.text) continue
    const last = out[out.length - 1]
    const same = last && last.color === seg.color && last.bg === seg.bg && last.bold === seg.bold && last.dim === seg.dim && last.keep === seg.keep
    if (same) out[out.length - 1] = { ...last, text: last.text + seg.text }
    else out.push(seg)
  }
  return out
}

export function isPlain(seg: Seg): boolean {
  return seg.color === undefined && seg.bg === undefined && !seg.bold && !seg.dim
}

function hasGit(git: GitState): boolean {
  return git.branch !== null || Object.keys(git.files).length > 0
}

function pick(frames: readonly string[], frame: number): string {
  return frames[((frame % frames.length) + frames.length) % frames.length]!
}
