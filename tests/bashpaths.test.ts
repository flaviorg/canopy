import { expect, test } from 'claude-code/testing'
import { changesTree, isCommit, readPaths, touchesGit } from '../hooks/bashpaths.ts'

test('cat and head', async () => {
  expect(readPaths('cat src/a.ts && head -n 20 README.md')).toEqual(['src/a.ts', 'README.md'])
  expect(readPaths('head -20 a.ts; tail -n5 b.ts')).toEqual(['a.ts', 'b.ts'])
  expect(readPaths('cat a.ts | wc -l')).toEqual(['a.ts'])
  expect(readPaths('/bin/cat "my notes.md"')).toEqual(['my notes.md'])
})

test('grep skips the pattern', async () => {
  expect(readPaths('grep -rn "TODO" src lib | head')).toEqual(['src', 'lib'])
  expect(readPaths('grep -e TODO -e FIXME src')).toEqual(['src'])
  expect(readPaths('rg --type ts -C 2 "a|b" hooks')).toEqual(['hooks'])
  expect(readPaths("awk -F, '{print $1}' data.csv")).toEqual(['data.csv'])
})

test('sed skips the script', async () => {
  expect(readPaths("sed -n '1,40p' hooks/x.ts")).toEqual(['hooks/x.ts'])
  expect(readPaths("sed -e 's/a/b/' -n in.txt")).toEqual(['in.txt'])
})

test('globs and redirects are dropped', async () => {
  expect(readPaths('cat *.md > out.txt')).toEqual([])
  expect(readPaths('wc -l src/*.ts README.md 2>/dev/null')).toEqual(['README.md'])
  expect(readPaths('cat $FILE a.ts 2>&1')).toEqual(['a.ts'])
  expect(readPaths('cat < input.txt')).toEqual([])
  expect(readPaths('cat a.ts # and b.ts')).toEqual(['a.ts'])
})

test('only read verbs count', async () => {
  expect(readPaths('echo cat a.ts')).toEqual([])
  expect(readPaths('git show HEAD:a.ts')).toEqual([])
  expect(readPaths('ls -la src')).toEqual([])
})

test('sudo and env are stripped', async () => {
  expect(readPaths('sudo cat /etc/hosts')).toEqual(['/etc/hosts'])
  expect(readPaths('FOO=1 env BAR=2 tail -f app.log')).toEqual(['app.log'])
  expect(readPaths('sudo -u root head -n 3 x.conf')).toEqual(['x.conf'])
})

test('results are de-duplicated and capped at 8', async () => {
  expect(readPaths('cat a && cat a && head a')).toEqual(['a'])
  const many = Array.from({ length: 12 }, (_, i) => `f${i}`).join(' ')
  expect(readPaths('cat ' + many)).toHaveLength(8)
})

test('changesTree', async () => {
  expect(changesTree('rm -rf build')).toBe(true)
  expect(changesTree('git checkout main')).toBe(true)
  expect(changesTree('git -C app stash pop')).toBe(true)
  expect(changesTree('ls -la')).toBe(false)
  expect(changesTree('npm i')).toBe(true)
  expect(changesTree('pnpm add zod')).toBe(true)
  expect(changesTree('npm run build')).toBe(false)
  expect(changesTree('cd app && mkdir -p a/b')).toBe(true)
  expect(changesTree('echo hi > notes.txt')).toBe(true)
  expect(changesTree('echo hi >>log.txt')).toBe(true)
  expect(changesTree('make 2>/dev/null >/dev/null')).toBe(false)
  expect(changesTree('npm test 2>&1 | tail')).toBe(false)
  expect(changesTree('grep ">" a.html')).toBe(false)
  expect(changesTree('git status')).toBe(false)
})

test('touchesGit', async () => {
  expect(touchesGit('git add .')).toBe(true)
  expect(touchesGit('git -c user.name=x commit -m y')).toBe(true)
  expect(touchesGit('git log')).toBe(false)
  expect(touchesGit('git diff --stat')).toBe(false)
  expect(touchesGit('echo git add')).toBe(false)
})

test('isCommit', async () => {
  expect(isCommit('git commit -m "x"')).toBe(true)
  expect(isCommit('git -C app commit')).toBe(true)
  expect(isCommit('cd app && git commit -am "fix: a && b"')).toBe(true)
  expect(isCommit('git commit-tree')).toBe(false)
  expect(isCommit('git log --grep commit')).toBe(false)
  expect(isCommit('echo git commit')).toBe(false)
})
