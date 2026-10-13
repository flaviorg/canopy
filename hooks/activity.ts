// canopy's activity model: what Claude did to each file and how recently. A mark is hot for
// 8 seconds (it moves on screen) and warm for a minute after (its folders stay open). What a
// file went through stays for the whole session: edited, committed or read (see stateOf).
// Pure, no mods API.
import { ancestors, own, put } from './tree.ts'

export type MarkKind = 'read' | 'write' | 'commit'
/**
 * `kind` and `at`: Claude's latest touch. `change`: its latest write or commit, which a later
 * read leaves in place, so an edited file still reads as edited after Claude looks at it again.
 */
export type Mark = { kind: MarkKind; at: number; reads: number; writes: number; change?: 'write' | 'commit' }
export type Marks = Record<string, Mark>
export type Heat = 'hot' | 'warm' | 'cold'
export type Activity = 'all' | 'writes' | 'none'

/**
 * Where a file stands this session, strongest first: Claude is writing it now, changed it and
 * hasn't committed, committed it, is reading it now, or read it.
 */
export type FileState = 'editing' | 'edited' | 'committed' | 'reading' | 'read'

export const HOT_MS = 8_000
export const WARM_MS = 60_000

/** The most marks kept; past it the oldest are dropped, cold ones first. */
export const MAX_MARKS = 2000

/**
 * Records one touch, returning a new object. A read keeps the counts of earlier touches; a read
 * that lands while a write is still hot leaves the write showing (a write outranks a read).
 */
export function mark(marks: Marks, path: string, kind: MarkKind, now: number): Marks {
  return markAll(marks, [path], kind, now)
}

/** mark() for many paths at once (a commit of thousands of files): one copy, one prune. */
export function markAll(marks: Marks, paths: readonly string[], kind: MarkKind, now: number): Marks {
  const out = { ...marks }
  for (const path of paths) put(out, path, touched(own(out, path), kind, now))
  return prune(out, now)
}

function touched(prev: Mark | undefined, kind: MarkKind, now: number): Mark {
  const reads = (prev?.reads ?? 0) + (kind === 'read' ? 1 : 0)
  const writes = (prev?.writes ?? 0) + (kind === 'write' ? 1 : 0)
  const keepWrite = kind === 'read' && prev?.kind === 'write' && heat(prev, now) === 'hot'
  if (keepWrite) return { ...prev!, reads }
  const change = kind === 'read' ? prev?.change : kind
  return change ? { kind, at: now, reads, writes, change } : { kind, at: now, reads, writes }
}

/**
 * Files Claude changed that git now calls clean. A commit took them (one made outside Claude:
 * in a terminal, an editor), so they read as committed; or they were put back (checkout,
 * restore, stash), so each keeps only what Claude read of it, and goes if nothing.
 */
export function settle(marks: Marks, paths: readonly string[], how: 'committed' | 'reverted'): Marks {
  const out = { ...marks }
  for (const path of paths) {
    const m = own(out, path)
    if (m?.change !== 'write') continue
    if (how === 'committed') put(out, path, { ...m, change: 'commit' })
    else if (m.reads > 0) put(out, path, { kind: m.kind, at: m.at, reads: m.reads, writes: m.writes })
    else delete out[path]
  }
  return out
}

/**
 * Takes back reads that never happened (denied or failed). `left` holds the marks the reads
 * left, `earlier` the marks before them. A mark still as its read left it returns to what
 * `earlier` had, or to nothing; one touched again since keeps that touch and loses only the
 * read's count (and goes when nothing is left of it).
 */
export function unread(marks: Marks, left: Marks, earlier: Marks): Marks {
  const out = { ...marks }
  for (const [path, mine] of Object.entries(left)) {
    const now = own(out, path)
    if (now === undefined) continue
    if (sameMark(now, mine)) {
      const before = own(earlier, path)
      if (before) put(out, path, before)
      else delete out[path]
      continue
    }
    const reads = Math.max(0, now.reads - 1)
    if (now.kind === 'read' && reads === 0 && !now.change) delete out[path]
    else put(out, path, { ...now, reads })
  }
  return out
}

function sameMark(a: Mark, b: Mark): boolean {
  return a.kind === b.kind && a.at === b.at && a.reads === b.reads && a.writes === b.writes && a.change === b.change
}

// Keeps MAX_MARKS: past it the oldest go, cold reads first, then cold changes, then the rest.
function prune(marks: Marks, now: number): Marks {
  const extra = Object.keys(marks).length - MAX_MARKS
  if (extra <= 0) return marks
  const keep = (m: Mark) => (heat(m, now) !== 'cold' ? 2 : m.change ? 1 : 0)
  const oldest = Object.entries(marks)
    .sort((a, b) => keep(a[1]) - keep(b[1]) || a[1].at - b[1].at)
    .slice(0, extra)
  for (const [path] of oldest) delete marks[path]
  return marks
}

export function heat(m: Mark | undefined, now: number): Heat {
  if (!m) return 'cold'
  const age = now - m.at
  if (age < HOT_MS) return 'hot'
  return age < HOT_MS + WARM_MS ? 'warm' : 'cold'
}

/**
 * Where a file stands, as the `activity` option lets it show: 'writes' leaves reads out (a
 * file Claude is reading shows what it changed there, if anything), 'none' shows nothing.
 */
export function stateOf(m: Mark | undefined, now: number, activity: Activity = 'all'): FileState | null {
  if (!m || activity === 'none') return null
  const hot = heat(m, now) === 'hot'
  if (hot && m.kind === 'write') return 'editing'
  if (hot && m.kind === 'read' && activity === 'all') return 'reading'
  if (m.change === 'commit') return 'committed'
  if (m.change === 'write') return 'edited'
  return activity === 'all' && m.reads > 0 ? 'read' : null
}

/** Strongest first: what is happening now, then what waits for a commit, then the rest. */
export const STATE_RANK: Readonly<Record<FileState, number>> = { editing: 5, reading: 4, edited: 3, committed: 2, read: 1 }

/**
 * Files Claude changed and hasn't committed, committed, and only read. A file counts by what it
 * went through, not by what it shows this moment: one Claude reads again after changing it
 * still counts as changed.
 */
export function tally(marks: Marks, now: number, activity: Activity = 'all'): { edited: number; committed: number; read: number } {
  const out = { edited: 0, committed: 0, read: 0 }
  for (const m of Object.values(marks)) {
    const state = stateOf(m, now, activity)
    if (state === null) continue
    if (state === 'editing' || m.change === 'write') out.edited++
    else if (m.change === 'commit') out.committed++
    else out.read++
  }
  return out
}

/**
 * Every folder's strongest state inside it, and how many files inside share it, in one pass
 * ('' is the whole tree). A closed folder shows it, so the work inside stays in sight.
 */
export function rollup(marks: Marks, now: number, activity: Activity = 'all'): Map<string, { state: FileState; count: number }> {
  const out = new Map<string, { state: FileState; count: number }>()
  for (const [path, m] of Object.entries(marks)) {
    const state = stateOf(m, now, activity)
    if (state === null) continue
    for (const dir of ancestors(path)) {
      const was = out.get(dir)
      if (!was || STATE_RANK[state] > STATE_RANK[was.state]) out.set(dir, { state, count: 1 })
      else if (was.state === state) was.count++
    }
  }
  return out
}

export function anyHot(marks: Marks, now: number): boolean {
  return Object.values(marks).some((m) => heat(m, now) === 'hot')
}

/** The most recently touched hot file, or null. */
export function newestHot(marks: Marks, now: number): string | null {
  let best: string | null = null
  let at = -Infinity
  for (const [path, m] of Object.entries(marks)) {
    if (heat(m, now) === 'hot' && m.at > at) {
      best = path
      at = m.at
    }
  }
  return best
}

/** How many hot or warm marks lie strictly inside a folder ('' is the whole tree). */
export function hotUnder(marks: Marks, dirRel: string, now: number): number {
  const prefix = dirRel ? dirRel + '/' : ''
  let n = 0
  for (const [path, m] of Object.entries(marks)) {
    if (path.startsWith(prefix) && heat(m, now) !== 'cold') n++
  }
  return n
}

/** hotUnder for every folder at once, in one pass: folder → hot or warm marks inside it. */
export function hotCounts(marks: Marks, now: number): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [path, m] of Object.entries(marks)) {
    if (heat(m, now) === 'cold') continue
    for (const dir of ancestors(path)) counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  return counts
}

/** The folders above every hot or warm mark: the tree opens them so the work shows. */
export function litDirs(marks: Marks, now: number): Set<string> {
  return new Set(hotCounts(marks, now).keys())
}

/** Whether the `activity` option lets a kind of touch light the tree. */
export function allows(activity: Activity, kind: MarkKind): boolean {
  if (activity === 'none') return false
  return activity === 'all' || kind !== 'read'
}
