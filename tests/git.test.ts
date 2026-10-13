import { expect, test } from 'claude-code/testing'
import { badgeFor, COMMIT_STATUS_ARGV, committed, NO_GIT, parseStatus, rollup, rollupAll, STATUS_ARGV, withinPrefix } from '../hooks/git.ts'

test('parses branch and badges', async () => {
  const out = '## main...origin/main\0 M src/a.ts\0A  src/new.ts\0?? notes/\0 D old.ts\0R  b.ts\0a.ts\0'
  expect(parseStatus(out)).toEqual({
    branch: 'main',
    files: { 'src/a.ts': 'M', 'src/new.ts': 'A', notes: 'U', 'old.ts': 'D', 'b.ts': 'R' },
  })
  expect(STATUS_ARGV).toEqual(['git', 'status', '--porcelain=v1', '-b', '-z'])
})

test('reads ahead/behind branches, copies, conflicts and both-side edits', async () => {
  const out = '## feature/x...origin/feature/x [ahead 1, behind 2]\0MM both.ts\0AM added.ts\0C  copy.ts\0orig.ts\0UU conflict.ts\0!! ignored.log\0'
  expect(parseStatus(out)).toEqual({
    branch: 'feature/x',
    files: { 'both.ts': 'M', 'added.ts': 'A', 'copy.ts': 'A', 'conflict.ts': 'M' },
  })
})

test('no commits yet', async () => {
  expect(parseStatus('## No commits yet on main\0?? a.ts\0')).toEqual({ branch: 'main', files: { 'a.ts': 'U' } })
  expect(parseStatus('## Initial commit on trunk\0').branch).toBe('trunk')
})

test('detached head', async () => {
  expect(parseStatus('## HEAD (no branch)\0').branch).toBe('HEAD')
})

test('empty output → NO_GIT shape with branch null', async () => {
  expect(parseStatus('')).toEqual({ branch: null, files: {} })
  expect(NO_GIT).toEqual({ branch: null, files: {} })
})

test('rollup prefers D then M', async () => {
  const files = { 'src/a.ts': 'M', 'src/b.ts': 'D', 'src/lib/c.ts': 'A', 'docs/x.md': 'U', notes: 'U', 'srcx.ts': 'R' } as const
  expect(rollup(files, 'src')).toBe('D')
  expect(rollup(files, 'src/lib')).toBe('A')
  expect(rollup(files, '')).toBe('D')
  expect(rollup(files, 'docs')).toBe('U')
  expect(rollup(files, 'notes')).toBe('U')
  expect(rollup(files, 'notes/deep')).toBe('U')
  expect(rollup(files, 'lib')).toBe(null)
  expect(rollup({ 'a/x': 'U', 'a/y': 'M', 'a/z': 'A' }, 'a')).toBe('M')
})

test('rollupAll answers like rollup for every folder', async () => {
  const files = { 'src/a.ts': 'M', 'src/b.ts': 'D', 'src/lib/c.ts': 'A', 'docs/x.md': 'U', notes: 'U', 'srcx.ts': 'R' } as const
  const lookup = rollupAll(files)
  for (const dir of ['', 'src', 'src/lib', 'docs', 'notes', 'notes/deep', 'lib', 's']) expect(lookup(dir)).toBe(rollup(files, dir))
})

test('files inside an untracked folder are new too', async () => {
  const files = { notes: 'U', 'src/a.ts': 'M' } as const
  expect(badgeFor(files, 'notes/today.md')).toBe('U')
  expect(badgeFor(files, 'src/a.ts')).toBe('M')
  expect(badgeFor(files, 'src/b.ts')).toBe(null)
})

test('committed lists files that became clean', async () => {
  const before = { branch: 'main', files: { 'b.ts': 'M', 'a.ts': 'A', 'c.ts': 'M' } } as const
  const after = { branch: 'main', files: { 'c.ts': 'M' } } as const
  expect(committed(before, after)).toEqual(['a.ts', 'b.ts'])
  expect(committed(NO_GIT, after)).toEqual([])
  // A file still inside an untracked folder was not committed.
  const untracked = { branch: 'main', files: { 'docs/a.md': 'U', 'docs/b.md': 'U', 'notes/c.md': 'U' } } as const
  expect(committed(untracked, { branch: 'main', files: { notes: 'U' } })).toEqual(['docs/a.md', 'docs/b.md'])
  expect(COMMIT_STATUS_ARGV).toEqual([...STATUS_ARGV, '--untracked-files=all'])
})

test('a session in a subfolder sees paths relative to it', async () => {
  const state = parseStatus('## main\0 M web/src/a.ts\0?? web/notes/\0 M api/b.ts\0?? web/\0')
  expect(withinPrefix(state, 'web/')).toEqual({ branch: 'main', files: { 'src/a.ts': 'M', notes: 'U' } })
  expect(withinPrefix(state, '')).toBe(state)
})
