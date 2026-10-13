import { expect, test } from 'claude-code/testing'
import {
  ancestors, anchorFor, BUILTIN_IGNORE, flatten, FOLDER_CAP, ignoreRules, isHidden, isIgnored, join, relativeTo, toEntries,
  type Listing,
} from '../hooks/tree.ts'

const file = (name: string) => ({ name, kind: 'file' as const })
const dir = (name: string) => ({ name, kind: 'dir' as const })

test('parses gitignore patterns', async () => {
  const ig = ignoreRules('# build output\n\nout/\n*.log\n/secrets\nlogs/old\n!keep.log\n**/tmp\n', 'scratch, notes.txt')
  expect(ig.names.has('out')).toBe(true)
  expect(ig.names.has('tmp')).toBe(true)
  expect(ig.names.has('scratch')).toBe(true)
  expect(ig.names.has('notes.txt')).toBe(true)
  expect(ig.suffixes).toContain('.log')
  expect(ig.prefixes).toEqual(['secrets', 'logs/old'])
  expect(isIgnored('src/out', 'out', ig)).toBe(true)
  expect(isIgnored('a/debug.log', 'debug.log', ig)).toBe(true)
  expect(isIgnored('keep.log', 'keep.log', ig)).toBe(true)
  expect(isIgnored('secrets', 'secrets', ig)).toBe(true)
  expect(isIgnored('secrets/key', 'key', ig)).toBe(true)
  expect(isIgnored('src/secrets', 'secrets', ig)).toBe(false)
  expect(isIgnored('logs/old', 'old', ig)).toBe(true)
  expect(isIgnored('logs/new', 'new', ig)).toBe(false)
  expect(isIgnored('src/a.ts', 'a.ts', ig)).toBe(false)
})

test('built-ins always hide node_modules and .git', async () => {
  const ig = ignoreRules('!node_modules\n', '')
  expect(BUILTIN_IGNORE).toContain('node_modules')
  expect(isIgnored('node_modules', 'node_modules', ig)).toBe(true)
  expect(isIgnored('.git', '.git', ig)).toBe(true)
  expect(isIgnored('pkg/dist', 'dist', ig)).toBe(true)
  expect(isIgnored('.github', '.github', ig)).toBe(false)
})

test('hidden paths: any ignored segment hides the path', async () => {
  const ig = ignoreRules('*.log\n', '')
  expect(isHidden('node_modules/x/index.js', ig)).toBe(true)
  expect(isHidden('src/debug.log', ig)).toBe(true)
  expect(isHidden('src/a.ts', ig)).toBe(false)
})

test('sorts dirs first, naturally', async () => {
  const raw = [file('b.ts'), dir('a'), file('file10'), file('file2'), file('A.md'), { name: 'link', kind: 'other' }, dir('node_modules')]
  const entries = toEntries(raw, '', ignoreRules('', ''))
  expect(entries.map((x) => x.name + (x.kind === 'dir' ? '/' : ''))).toEqual(['a/', 'A.md', 'b.ts', 'file2', 'file10', 'link'])
})

test('flattens with guide lines', async () => {
  const listing: Listing = { '': [dir('src'), file('README.md')], src: [file('a.ts'), file('b.ts')] }
  const rows = flatten('w', listing, () => true)
  expect(rows.map((r) => r.type)).toEqual(['root', 'dir', 'file', 'file', 'file'])
  expect(rows[0]).toEqual({ type: 'root', path: '', name: 'w' })
  expect(rows.slice(1).map((r: any) => [r.path, r.guides])).toEqual([
    ['src', '├─ '],
    ['src/a.ts', '│  ├─ '],
    ['src/b.ts', '│  └─ '],
    ['README.md', '└─ '],
  ])
  expect(rows[1]).toEqual({ type: 'dir', path: 'src', name: 'src', depth: 0, guides: '├─ ', expanded: true })
  expect((rows[2] as any).depth).toBe(1)
})

test('last-child folders draw blank guides beneath them', async () => {
  const listing: Listing = { '': [dir('a'), dir('z')], a: [file('x')], z: [dir('y')], 'z/y': [file('k')] }
  const rows = flatten('w', listing, () => true)
  expect(rows.slice(1).map((r: any) => r.guides)).toEqual(['├─ ', '│  └─ ', '└─ ', '   └─ ', '      └─ '])
})

test('collapsed dirs hide children', async () => {
  const listing: Listing = { '': [dir('src'), dir('docs'), file('README.md')], src: [file('a.ts')], docs: [file('x.md')] }
  const rows = flatten('w', listing, (rel) => rel !== 'src')
  expect(rows.map((r) => r.path)).toEqual(['', 'src', 'docs', 'docs/x.md', 'README.md'])
  expect((rows[1] as any).expanded).toBe(false)
  // A directory whose listing is missing is drawn collapsed.
  const unscanned = flatten('w', { '': [dir('lib')] }, () => true)
  expect((unscanned[1] as any).expanded).toBe(false)
})

test('caps rows', async () => {
  const many = Array.from({ length: 5000 }, (_, i) => file('f' + i))
  const rows = flatten('w', { '': many }, () => true, 2000, 5000)
  expect(rows).toHaveLength(2002)
  expect(rows[2001]).toEqual({ type: 'more', path: '', depth: 0, guides: '└─ ', count: 3000 })
  expect(flatten('w', { '': many.slice(0, 2000) }, () => true, 2000, 5000)).toHaveLength(2001)
  // By default one folder draws at most FOLDER_CAP entries.
  const capped = flatten('w', { '': many }, () => true)
  expect(capped).toHaveLength(FOLDER_CAP + 2)
  expect(capped.at(-1)).toEqual({ type: 'more', path: '', depth: 0, guides: '└─ ', count: 5000 - FOLDER_CAP })
})

test('one huge folder leaves the rest of the tree drawn', async () => {
  const listing: Listing = {
    '': [dir('assets'), dir('src'), file('README.md')],
    assets: Array.from({ length: 5000 }, (_, i) => file('img' + i + '.png')),
    src: [file('a.ts')],
  }
  const rows = flatten('w', listing, () => true)
  const paths = rows.map((r) => r.path)
  expect(paths).toContain('src/a.ts')
  expect(paths.at(-1)).toBe('README.md')
  const more = rows.find((r) => r.type === 'more') as any
  expect(more).toEqual({ type: 'more', path: 'assets', depth: 1, guides: '│  └─ ', count: 5000 - FOLDER_CAP })
})

test('past the row cap, every open folder counts what it left out', async () => {
  const listing: Listing = {
    '': [dir('a'), dir('b'), file('z.md')],
    a: Array.from({ length: 10 }, (_, i) => file('f' + i)),
    b: [file('x')],
  }
  const rows = flatten('w', listing, () => true, 5)
  expect(rows.map((r: any) => (r.type === 'more' ? `${r.guides}… ${r.count}` : r.path))).toEqual([
    '', 'a', 'a/f0', 'a/f1', 'a/f2', 'a/f3', '│  └─ … 6', '└─ … 2',
  ])
})

test('relative paths', async () => {
  expect(relativeTo('/w', '/w/src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('/w', '/w')).toBe('')
  expect(relativeTo('/w/', '/w/')).toBe('')
  expect(relativeTo('/w', '/etc/hosts')).toBe(null)
  expect(relativeTo('/w', '/wx/a.ts')).toBe(null)
  expect(relativeTo('/w', '../x', '/w/src')).toBe('x')
  expect(relativeTo('/w', 'src/a.ts', '/w')).toBe('src/a.ts')
  expect(relativeTo('/w', 'src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('/w', './src//./a.ts/', '/w')).toBe('src/a.ts')
  expect(relativeTo('/w', '../x', '/w')).toBe(null)
  expect(relativeTo('/w', '/w/../w/src')).toBe('src')
  expect(relativeTo('/w', '~/.zshrc', '/w')).toBe(null)
  expect(relativeTo('/w', '')).toBe(null)
  expect(relativeTo('/', '/etc/hosts')).toBe('etc/hosts')
})

test('ancestors', async () => {
  expect(ancestors('a/b/c.ts')).toEqual(['', 'a', 'a/b'])
  expect(ancestors('a.ts')).toEqual([''])
  expect(ancestors('')).toEqual([])
  expect(join('', 'a')).toBe('a')
  expect(join('a/b', 'c')).toBe('a/b/c')
})

test('the anchor is the file, or the folder that hides it', async () => {
  expect(anchorFor('src/lib/a.ts', () => true)).toBe('src/lib/a.ts')
  expect(anchorFor('src/lib/a.ts', (d) => d !== 'src/lib')).toBe('src/lib')
  expect(anchorFor('src/lib/a.ts', (d) => d === '')).toBe('src')
  expect(anchorFor('a.ts', () => false)).toBe('a.ts')
})
