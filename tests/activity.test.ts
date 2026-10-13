import { expect, test } from 'claude-code/testing'
import {
  allows, anyHot, changeOf, heat, HOT_MS, hotCounts, hotUnder, litDirs, mark, markAll, MAX_MARKS, newestHot, rollup, stateOf, tally, unread, WARM_MS,
  type Marks,
} from '../hooks/activity.ts'

const T = 100_000

test('marks accumulate counts', async () => {
  const empty: Marks = {}
  let m = mark(empty, 'a.ts', 'read', T)
  expect(empty).toEqual({})
  m = mark(m, 'a.ts', 'read', T + 1)
  m = mark(m, 'a.ts', 'write', T + 2)
  expect(m['a.ts']).toEqual({ kind: 'write', at: T + 2, reads: 2, writes: 1, change: 'write' })
  m = mark(m, 'a.ts', 'commit', T + 3)
  expect(m['a.ts']).toEqual({ kind: 'commit', at: T + 3, reads: 2, writes: 1, change: 'commit' })
  // A read after it keeps what the file went through.
  m = mark(m, 'a.ts', 'read', T + 4)
  expect(m['a.ts']).toEqual({ kind: 'read', at: T + 4, reads: 3, writes: 1, change: 'commit' })
})

test('heat boundaries', async () => {
  const m = { kind: 'read' as const, at: T, reads: 1, writes: 0 }
  expect(HOT_MS).toBe(8_000)
  expect(WARM_MS).toBe(60_000)
  expect(heat(m, T)).toBe('hot')
  expect(heat(m, T + 7_999)).toBe('hot')
  expect(heat(m, T + 8_000)).toBe('warm')
  expect(heat(m, T + 67_999)).toBe('warm')
  expect(heat(m, T + 68_000)).toBe('cold')
  expect(heat(undefined, T)).toBe('cold')
})

test('a read does not hide a hot write', async () => {
  let m = mark({}, 'a.ts', 'write', T)
  m = mark(m, 'a.ts', 'read', T + 1_000)
  expect(m['a.ts']).toEqual({ kind: 'write', at: T, reads: 1, writes: 1, change: 'write' })
  // Once the write has cooled, a read takes over, and the file is still edited.
  m = mark(m, 'a.ts', 'read', T + 9_000)
  expect(m['a.ts']).toEqual({ kind: 'read', at: T + 9_000, reads: 2, writes: 1, change: 'write' })
})

test('a file state lasts the session: editing, then edited; reading, then read; committed', async () => {
  const w = mark({}, 'a.ts', 'write', T)['a.ts']
  expect(stateOf(w, T)).toBe('editing')
  expect(stateOf(w, T + HOT_MS - 1)).toBe('editing')
  expect(stateOf(w, T + HOT_MS)).toBe('edited')
  expect(stateOf(w, T + 10 * 60 * 60_000)).toBe('edited')
  const r = mark({}, 'a.ts', 'read', T)['a.ts']
  expect(stateOf(r, T)).toBe('reading')
  expect(stateOf(r, T + HOT_MS)).toBe('read')
  expect(stateOf(r, T + 10 * 60 * 60_000)).toBe('read')
  const c = mark(mark({}, 'a.ts', 'write', T), 'a.ts', 'commit', T + 1)['a.ts']
  expect(stateOf(c, T + 1)).toBe('committed')
  expect(stateOf(c, T + 10 * 60 * 60_000)).toBe('committed')
  expect(stateOf(undefined, T)).toBe(null)
  // Reading an edited file spins while it reads, then shows the edit again.
  const er = mark(mark({}, 'a.ts', 'write', T), 'a.ts', 'read', T + 9_000)['a.ts']
  expect(stateOf(er, T + 9_000)).toBe('reading')
  expect(stateOf(er, T + 9_000 + HOT_MS)).toBe('edited')
  // A write after a commit makes it edited again.
  expect(stateOf(mark({ 'a.ts': c! }, 'a.ts', 'write', T + 20_000)['a.ts'], T + 40_000)).toBe('edited')
})

test('the activity option filters states', async () => {
  const r = mark({}, 'a.ts', 'read', T)['a.ts']
  const er = mark(mark({}, 'a.ts', 'write', T - 20_000), 'a.ts', 'read', T)['a.ts']
  expect(stateOf(r, T, 'writes')).toBe(null)
  expect(stateOf(r, T + HOT_MS, 'writes')).toBe(null)
  // In 'writes', a file Claude reads shows what it changed there.
  expect(stateOf(er, T, 'writes')).toBe('edited')
  expect(stateOf(mark({}, 'a.ts', 'write', T)['a.ts'], T, 'none')).toBe(null)
})

test('marks kept from before the change field still say what the file went through', async () => {
  expect(changeOf({ kind: 'write', at: T, reads: 0, writes: 1 })).toBe('write')
  expect(changeOf({ kind: 'commit', at: T, reads: 0, writes: 0 })).toBe('commit')
  expect(changeOf({ kind: 'read', at: T, reads: 2, writes: 1 })).toBe('write')
  expect(changeOf({ kind: 'read', at: T, reads: 2, writes: 0 })).toBe(undefined)
  expect(stateOf({ kind: 'read', at: T, reads: 2, writes: 1 }, T + HOT_MS)).toBe('edited')
})

test('tally counts changed, committed and read files', async () => {
  let m = mark({}, 'a.ts', 'write', T)
  m = mark(m, 'a.ts', 'read', T)
  m = mark(m, 'b.ts', 'read', T)
  m = mark(m, 'c.ts', 'read', T)
  m = mark(m, 'd.ts', 'commit', T)
  m = mark(m, 'e.ts', 'write', T - 60_000)
  expect(tally(m, T)).toEqual({ edited: 2, committed: 1, read: 2 })
  expect(tally(m, T, 'writes')).toEqual({ edited: 2, committed: 1, read: 0 })
  expect(tally(m, T, 'none')).toEqual({ edited: 0, committed: 0, read: 0 })
  expect(tally({}, T)).toEqual({ edited: 0, committed: 0, read: 0 })
})

test('a folder rolls up its strongest state and how many files share it', async () => {
  let m = mark({}, 'src/a.ts', 'read', T - 60_000)
  m = mark(m, 'src/b.ts', 'read', T - 60_000)
  expect(rollup(m, T).get('src')).toEqual({ state: 'read', count: 2 })
  m = mark(m, 'src/lib/c.ts', 'write', T - 60_000)
  expect(rollup(m, T).get('src')).toEqual({ state: 'edited', count: 1 })
  expect(rollup(m, T).get('src/lib')).toEqual({ state: 'edited', count: 1 })
  m = mark(m, 'src/d.ts', 'read', T)
  // What is happening now outranks what waits.
  expect(rollup(m, T).get('src')).toEqual({ state: 'reading', count: 1 })
  expect(rollup(m, T).get('')).toEqual({ state: 'reading', count: 1 })
  m = mark(m, 'src/e.ts', 'write', T)
  expect(rollup(m, T).get('src')).toEqual({ state: 'editing', count: 1 })
  expect(rollup(m, T + HOT_MS).get('src')).toEqual({ state: 'edited', count: 2 })
  expect(rollup(m, T + HOT_MS, 'none').size).toBe(0)
  expect(rollup(mark({}, 'x.ts', 'read', T), T, 'writes').size).toBe(0)
})

test('newestHot picks the latest hot', async () => {
  let m = mark({}, 'old.ts', 'write', T)
  m = mark(m, 'new.ts', 'read', T + 2_000)
  m = mark(m, 'cold.ts', 'read', T - 100_000)
  expect(newestHot(m, T + 3_000)).toBe('new.ts')
  expect(anyHot(m, T + 3_000)).toBe(true)
  expect(newestHot(m, T + 20_000)).toBe(null)
  expect(anyHot(m, T + 20_000)).toBe(false)
})

test('hotUnder counts inside a dir only', async () => {
  let m = mark({}, 'src/a.ts', 'write', T)
  m = mark(m, 'src/lib/b.ts', 'read', T)
  m = mark(m, 'srcx.ts', 'read', T)
  m = mark(m, 'src/cold.ts', 'read', T - 100_000)
  expect(hotUnder(m, 'src', T)).toBe(2)
  expect(hotUnder(m, 'src', T + 30_000)).toBe(2)
  expect(hotUnder(m, '', T)).toBe(3)
  expect(hotUnder(m, 's', T)).toBe(0)
  expect(hotUnder(m, 'src/lib', T)).toBe(1)
})

test('hotCounts answers like hotUnder for every folder', async () => {
  let m = mark({}, 'src/a.ts', 'write', T)
  m = mark(m, 'src/lib/b.ts', 'read', T)
  m = mark(m, 'srcx.ts', 'read', T)
  m = mark(m, 'src/cold.ts', 'read', T - 100_000)
  const counts = hotCounts(m, T)
  for (const dir of ['', 'src', 'src/lib', 's', 'docs']) expect(counts.get(dir) ?? 0).toBe(hotUnder(m, dir, T))
})

test('lit folders are the ones above hot or warm marks', async () => {
  let m = mark({}, 'src/lib/a.ts', 'read', T)
  m = mark(m, 'docs/old.md', 'read', T - 100_000)
  expect([...litDirs(m, T)].sort()).toEqual(['', 'src', 'src/lib'])
})

test('drops oldest cold marks past MAX_MARKS', async () => {
  let m: Marks = {}
  for (let i = 0; i < MAX_MARKS; i++) m[`f${i}`] = { kind: 'read', at: i, reads: 1, writes: 0 }
  m = mark(m, 'hot.ts', 'write', T)
  expect(Object.keys(m)).toHaveLength(MAX_MARKS)
  expect(m['f0']).toBeUndefined()
  expect(m['f1']).toBeDefined()
  expect(m['hot.ts']).toBeDefined()
})

test('past MAX_MARKS a cold read goes before an older cold edit', async () => {
  let m: Marks = { 'edited.ts': { kind: 'write', at: 0, reads: 0, writes: 1, change: 'write' } }
  for (let i = 1; i < MAX_MARKS; i++) m[`f${i}`] = { kind: 'read', at: i, reads: 1, writes: 0 }
  m = mark(m, 'hot.ts', 'read', T)
  expect(m['edited.ts']).toBeDefined()
  expect(m['f1']).toBeUndefined()
})

test('marking many paths at once keeps MAX_MARKS, the newest and the live ones', async () => {
  let m: Marks = {}
  for (let i = 0; i < 10; i++) m[`cold${i}`] = { kind: 'read', at: T - 100_000, reads: 1, writes: 0 }
  m = mark(m, 'hot.ts', 'write', T)
  const paths = Array.from({ length: 3 * MAX_MARKS }, (_, i) => `f${i}`)
  const started = performance.now()
  const out = markAll(m, paths, 'commit', T + 1)
  expect(performance.now() - started).toBeLessThan(1_000)
  expect(Object.keys(out)).toHaveLength(MAX_MARKS)
  expect(out['cold0']).toBeUndefined()
  expect(out['hot.ts']).toBeUndefined()
  expect(out[`f${3 * MAX_MARKS - 1}`]).toEqual({ kind: 'commit', at: T + 1, reads: 0, writes: 0, change: 'commit' })
  expect(m['f0']).toBeUndefined()
  // The same as marking one by one.
  expect(markAll({}, ['a', 'b', 'a'], 'read', T)).toEqual(mark(mark(mark({}, 'a', 'read', T), 'b', 'read', T), 'a', 'read', T))
})

test('the activity option decides which marks count', async () => {
  expect(allows('all', 'read')).toBe(true)
  expect(allows('writes', 'read')).toBe(false)
  expect(allows('writes', 'write')).toBe(true)
  expect(allows('writes', 'commit')).toBe(true)
  expect(allows('none', 'write')).toBe(false)
})

test('unread puts back what a read replaced', async () => {
  const earlier = mark({}, 'a.ts', 'write', T)
  let m = mark(earlier, 'a.ts', 'read', T + 20_000)
  m = mark(m, 'b.ts', 'read', T + 20_000)
  const left = { 'a.ts': m['a.ts']!, 'b.ts': m['b.ts']! }
  expect(unread(m, left, earlier)).toEqual(earlier)
  expect(m['b.ts']).toBeDefined()
})

test('unread keeps a touch that came after the read', async () => {
  const earlier: Marks = {}
  const read = mark(earlier, 'a.ts', 'read', T)
  const left = { 'a.ts': read['a.ts']! }
  // An Edit landed while the Read waited: the write stays, less the read's count.
  const edited = mark(read, 'a.ts', 'write', T + 1_000)
  expect(unread(edited, left, earlier)).toEqual({ 'a.ts': { kind: 'write', at: T + 1_000, reads: 0, writes: 1, change: 'write' } })
  // A committed file read again, the read denied: the commit stays.
  const committed = mark({}, 'b.ts', 'commit', T)
  const reread = mark(committed, 'b.ts', 'read', T + 20_000)
  const later = mark(reread, 'b.ts', 'read', T + 21_000)
  expect(unread(later, { 'b.ts': reread['b.ts']! }, committed)['b.ts']?.change).toBe('commit')
  // Two reads of one file, both denied, in either order: nothing is left.
  const second = mark(read, 'a.ts', 'read', T + 2_000)
  const leftSecond = { 'a.ts': second['a.ts']! }
  expect(unread(unread(second, left, earlier), leftSecond, read)).toEqual({})
  expect(unread(unread(second, leftSecond, read), left, earlier)).toEqual({})
})
