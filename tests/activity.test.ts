import { expect, test } from 'claude-code/testing'
import {
  allows, anyHot, forget, heat, HOT_MS, hotCounts, hotUnder, litDirs, mark, markAll, MAX_MARKS, newestHot, summary, WARM_MS, type Marks,
} from '../hooks/activity.ts'

const T = 100_000

test('marks accumulate counts', async () => {
  const empty: Marks = {}
  let m = mark(empty, 'a.ts', 'read', T)
  expect(empty).toEqual({})
  m = mark(m, 'a.ts', 'read', T + 1)
  m = mark(m, 'a.ts', 'write', T + 2)
  expect(m['a.ts']).toEqual({ kind: 'write', at: T + 2, reads: 2, writes: 1 })
  m = mark(m, 'a.ts', 'commit', T + 3)
  expect(m['a.ts']).toEqual({ kind: 'commit', at: T + 3, reads: 2, writes: 1 })
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
  expect(m['a.ts']).toEqual({ kind: 'write', at: T, reads: 1, writes: 1 })
  // Once the write has cooled, a read takes over.
  m = mark(m, 'a.ts', 'read', T + 9_000)
  expect(m['a.ts']).toEqual({ kind: 'read', at: T + 9_000, reads: 2, writes: 1 })
})

test('summary counts edited and read files', async () => {
  let m = mark({}, 'a.ts', 'write', T)
  m = mark(m, 'a.ts', 'read', T)
  m = mark(m, 'b.ts', 'read', T)
  m = mark(m, 'c.ts', 'read', T)
  m = mark(m, 'd.ts', 'commit', T)
  expect(summary(m)).toEqual({ edited: 1, read: 2 })
  expect(summary({})).toEqual({ edited: 0, read: 0 })
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
  expect(out[`f${3 * MAX_MARKS - 1}`]).toEqual({ kind: 'commit', at: T + 1, reads: 0, writes: 0 })
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

test('forget puts back what a mark replaced', async () => {
  const earlier = mark({}, 'a.ts', 'write', T)
  let m = mark(earlier, 'a.ts', 'read', T + 20_000)
  m = mark(m, 'b.ts', 'read', T + 20_000)
  const back = forget(m, ['a.ts', 'b.ts'], earlier)
  expect(back).toEqual(earlier)
  expect(m['b.ts']).toBeDefined()
})
