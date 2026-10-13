// canopy's activity model: what Claude did to each file and how recently. A mark is hot for
// 8 seconds (it moves on screen), warm for a minute after (it keeps its color), then cold.
// Pure, no mods API.
import { ancestors } from './tree.ts'

export type MarkKind = 'read' | 'write' | 'commit'
export type Mark = { kind: MarkKind; at: number; reads: number; writes: number }
export type Marks = Record<string, Mark>
export type Heat = 'hot' | 'warm' | 'cold'
export type Activity = 'all' | 'writes' | 'none'

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
  for (const path of paths) out[path] = touched(out[path], kind, now)
  return prune(out, now)
}

function touched(prev: Mark | undefined, kind: MarkKind, now: number): Mark {
  const reads = (prev?.reads ?? 0) + (kind === 'read' ? 1 : 0)
  const writes = (prev?.writes ?? 0) + (kind === 'write' ? 1 : 0)
  const keepWrite = kind === 'read' && prev?.kind === 'write' && heat(prev, now) === 'hot'
  return keepWrite ? { ...prev!, reads } : { kind, at: now, reads, writes }
}

/** Takes marks back: each path returns to what `earlier` had for it, or to nothing. */
export function forget(marks: Marks, paths: readonly string[], earlier: Marks): Marks {
  const out = { ...marks }
  for (const path of paths) {
    const before = earlier[path]
    if (before) out[path] = before
    else delete out[path]
  }
  return out
}

// Keeps MAX_MARKS: past it the oldest go, cold before hot or warm, whatever lit them.
function prune(marks: Marks, now: number): Marks {
  const extra = Object.keys(marks).length - MAX_MARKS
  if (extra <= 0) return marks
  const live = (m: Mark) => (heat(m, now) === 'cold' ? 0 : 1)
  const oldest = Object.entries(marks)
    .sort((a, b) => live(a[1]) - live(b[1]) || a[1].at - b[1].at)
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

/** Files edited this session, and files only read. */
export function summary(marks: Marks): { edited: number; read: number } {
  let edited = 0
  let read = 0
  for (const m of Object.values(marks)) {
    if (m.writes > 0) edited++
    else if (m.reads > 0) read++
  }
  return { edited, read }
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
