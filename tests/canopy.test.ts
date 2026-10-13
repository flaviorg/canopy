import { expect, mock, test } from 'claude-code/testing'
import { STATUS_ARGV } from '../hooks/git.ts'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'canopy',
  component: 'Pane',
  requestId: 'canopy',
  viewport: { columns: 140, rows: 40 },
  props: { title: 'Canopy', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const file = (name: string) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })
const dir = (name: string) => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })

const FILES = () => ({
  '/w': [dir('src'), dir('docs'), dir('node_modules'), file('README.md'), file('package.json'), file('.gitignore')],
  '/w/src': [file('a.ts'), file('b.md')],
  '/w/docs': [file('guide.md')],
  '/w/node_modules': [dir('left-pad')],
})

type Setup = { files?: Record<string, any[]>; git?: string; gitExit?: number; placed?: boolean; gitignore?: string; panesFail?: boolean }

// Everything canopy calls, answered from memory and recorded. `calls.files` and `calls.git`
// can be changed mid-test to stand for the disk and the repository changing; `calls.gitFails`
// makes `git status` time out.
function stubs(on: any, setup: Setup = {}) {
  const calls = {
    files: setup.files ?? (FILES() as Record<string, any[]>),
    git: setup.git ?? '## main\0',
    gitAll: null as string | null, // what `git status --untracked-files=all` says, when it differs
    gitFails: false,
    lists: [] as string[],
    runs: [] as string[][],
    opens: [] as any[],
    closes: 0,
    toasts: [] as string[],
    panes: 0,
    open: new Set<string>(),
    answer: (e: any): any => ({ result: { type: 'text', file: { filePath: e.file_path } } }),
    hold: {} as Record<string, Promise<void>>,
  }
  const placed = setup.placed ?? true
  on('session.root', () => ({ value: '/w' }))
  on('session.cwd', () => ({ value: '/w' }))
  on('fs.list', async ($: any, e: any) => {
    calls.lists.push(e.path)
    await calls.hold[e.path]
    const entries = calls.files[e.path]
    return entries ? { value: entries } : { deny: 'ENOENT' }
  })
  on('fs.read', ($: any, e: any) => (e.path === '/w/.gitignore' && setup.gitignore !== undefined ? { value: setup.gitignore } : { deny: 'ENOENT' }))
  on('process.run', ($: any, e: any) => {
    calls.runs.push(e.argv)
    if (calls.gitFails && e.argv[1] === 'status') return { deny: 'timed out' }
    const exitCode = setup.gitExit ?? 0
    const all = e.argv.includes('--untracked-files=all') && calls.gitAll !== null
    const stdout = exitCode !== 0 ? '' : e.argv[1] === 'status' ? (all ? calls.gitAll : calls.git) : ''
    return { value: { exitCode, stdout, stderr: exitCode ? 'fatal: not a git repository' : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', ($: any, e: any) => {
    calls.opens.push(e)
    calls.open.add(e.id)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is narrower than 144 columns' } }
  })
  on('ui.close', ($: any, e: any) => {
    calls.closes++
    calls.open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => {
    calls.panes++
    if (setup.panesFail) return { deny: 'refused' }
    return { value: [...calls.open].map((id) => ({ id, title: 'Canopy', isShown: placed, isFocused: false, isPlaced: placed })) }
  })
  on('ui.toast', ($: any, e: any) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'canopy' } }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('tool.call', ($: any, e: any) => calls.answer(e))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  const clock = mock.clock(on, { now: 1_000_000 })
  return { calls, clock }
}

const start = ($: any) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
const bashResult = (extra: any = {}) => ({ result: { stdout: '', stderr: '', interrupted: false, ...extra } })

// The Text pieces under an element, with their props (a bare string has none).
function pieces(el: any): { text: string; props: any }[] {
  if (typeof el === 'string') return [{ text: el, props: {} }]
  if (!el || typeof el !== 'object') return []
  if (el.type === 'Text') return [{ text: (el.children ?? []).filter((c: any) => typeof c === 'string').join(''), props: el.props ?? {} }]
  return (el.children ?? []).flatMap(pieces)
}
const piece = (el: any, part: string) => pieces(el).find((p) => p.text.includes(part))

async function header(ui: any): Promise<string> {
  return (await ui.find({ key: 'header' }))?.text ?? ''
}

test('opens at start and draws the tree', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  expect(calls.opens).toEqual([{ id: 'canopy', title: 'Canopy', columns: 44 }])
  expect(calls.runs).toContainEqual([...STATUS_ARGV])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '◆ canopy' })).toBeDefined()
    expect(await header(ui)).toContain('⎇ main')
    expect(await ui.find({ key: 'row:src' })).toBeDefined()
    expect(await ui.find({ key: 'row:README.md' })).toBeDefined()
    expect(await ui.find({ key: 'row:node_modules' })).toBeUndefined()
    expect(await ui.find({ key: 'row:src/a.ts' })).toBeUndefined()
    expect(await ui.find({ key: 'legend' })).toBeDefined()
    await ui.unmount()
  }
})

test('toasts once when it cannot place', async ($, on) => {
  const { calls } = stubs(on, { placed: false })
  await start($)
  expect(calls.toasts).toEqual(['canopy: run /canopy to open the tree'])
  await $.command.run({ command: 'canopy', args: '' })
  expect(calls.opens).toHaveLength(2)
  expect(calls.toasts).toHaveLength(1)
})

test('stays closed at start with start: off', { options: { start: 'off' } }, async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  expect(calls.opens).toHaveLength(0)
  expect(calls.toasts).toHaveLength(0)
})

test('a Read lights the file', async ($, on) => {
  stubs(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ key: 'row:src/a.ts' })
    expect(piece(row, 'a.ts')?.props.color).toBe('suggestion')
    expect(piece(row, '◐')?.props.color).toBe('suggestion')
    expect((await ui.find({ key: 'row:src' }))?.text).toContain('▾ src/')
    expect(await header(ui)).toContain('◉ 1')
    await ui.unmount()
  }
})

test('a Read is lit while it waits, and forgotten when denied', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let during = ''
  calls.answer = async () => {
    during = await header(ui)
    return { deny: 'The user denied this read.' }
  }
  const out: any = await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  expect(during).toContain('◉ 1')
  expect(out.deny).toMatch(/denied/)
  expect(await header(ui)).not.toContain('◉')
  expect(await ui.find({ key: 'row:src/a.ts' })).toBeUndefined()
  await ui.unmount()
})

test('a denied Read leaves an Edit made meanwhile', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let deny = () => {}
  const held = new Promise<void>((r) => (deny = r))
  calls.answer = async (e: any) => {
    if (e.tool !== 'Read') return { result: 'ok' }
    await held
    return { deny: 'The user denied this read.' }
  }
  const reading = $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  for (let i = 0; i < 100_000 && !(await header(ui)).includes('◉'); i++) await Promise.resolve()
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' })
  deny()
  await reading
  expect(await header(ui)).toContain('✎ 1')
  expect(piece(await ui.find({ key: 'row:src/a.ts' }), 'a.ts')?.props.color).toBe('success')
  await ui.unmount()
})

test('an Edit marks it written and counts it', async ($, on) => {
  const { calls, clock } = stubs(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await header(ui)).toContain('✎ 1')
    const row = await ui.find({ key: 'row:src/a.ts' })
    expect(piece(row, 'a.ts')?.props).toEqual({ color: 'success', bold: true })
    expect(piece(row, '●')?.props.color).toBe('success')
    await ui.unmount()
  }
  // The badge follows within a second, once git has been asked again.
  const before = calls.runs.length
  calls.git = '## main\0 M src/a.ts\0'
  await clock.advance(1_000)
  expect(calls.runs.length).toBeGreaterThan(before)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'row:src/a.ts' }))?.text).toMatch(/M$/)
  await ui.unmount()
})

test('a Write that creates a file shows it', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  calls.files['/w/src'] = [file('a.ts'), file('b.md'), file('c.ts')]
  await $.tool.call({ tool: 'Write', file_path: '/w/src/c.ts', content: 'x' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(piece(await ui.find({ key: 'row:src/c.ts' }), 'c.ts')?.props.color).toBe('success')
  await ui.unmount()
})

test('a Write that makes new folders shows them at once', async ($, on) => {
  const { calls, clock } = stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1_000)
  calls.files['/w'] = [dir('newdir'), ...calls.files['/w']!]
  calls.files['/w/newdir'] = [dir('sub')]
  calls.files['/w/newdir/sub'] = [file('x.ts')]
  await $.tool.call({ tool: 'Write', file_path: '/w/newdir/sub/x.ts', content: 'x' })
  expect((await ui.find({ key: 'row:newdir' }))?.text).toContain('▾ newdir/')
  expect(piece(await ui.find({ key: 'row:newdir/sub/x.ts' }), 'x.ts')?.props.color).toBe('success')
  await ui.unmount()
})

test('a commit turns edited files green', async ($, on) => {
  const { calls } = stubs(on, { git: '## main\0 M src/a.ts\0' })
  await start($)
  calls.answer = (e: any) => {
    if (e.tool !== 'Bash') return { result: 'ok' }
    calls.git = '## main\0'
    return bashResult({ gitOperation: { commit: { sha: 'abc1234', kind: 'committed' } } })
  }
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(calls.runs.filter((argv) => argv.join(' ') === STATUS_ARGV.join(' ')).length).toBeGreaterThanOrEqual(2)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ key: 'row:src/a.ts' })
    expect(piece(row, '✓')?.props.color).toBe('success')
    expect(piece(row, 'a.ts')?.props.color).toBe('success')
    expect(row?.text).not.toMatch(/M$/)
    await ui.unmount()
  }
})

test('committing a new folder marks the files inside it', async ($, on) => {
  const { calls } = stubs(on, { git: '## main\0?? docs/\0' })
  calls.gitAll = '## main\0?? docs/guide.md\0'
  await start($)
  calls.answer = (e: any) => {
    if (e.tool !== 'Bash') return { result: 'ok' }
    calls.git = calls.gitAll = '## main\0'
    return bashResult({ gitOperation: { commit: { sha: 'abc1234', kind: 'committed' } } })
  }
  await $.tool.call({ tool: 'Bash', command: 'git add docs && git commit -m docs' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(piece(await ui.find({ key: 'row:docs/guide.md' }), '✓')?.props.color).toBe('success')
  await ui.unmount()
})

test('a commit of thousands of files is marked without holding Claude up', async ($, on) => {
  const files: Record<string, any[]> = { '/w': [] }
  let changed = ''
  for (let d = 0; d < 100; d++) {
    files['/w']!.push(dir(`d${d}`))
    files[`/w/d${d}`] = Array.from({ length: 120 }, (_, i) => file(`f${i}.ts`))
    for (let i = 0; i < 120; i++) changed += ` M d${d}/f${i}.ts\0`
  }
  const { calls } = stubs(on, { files, git: '## main\0' + changed })
  await start($)
  calls.answer = (e: any) => {
    calls.git = '## main\0'
    return bashResult({ gitOperation: { commit: { sha: 'abc1234', kind: 'committed' } } })
  }
  const started = performance.now()
  await $.tool.call({ tool: 'Bash', command: 'git commit -am x' })
  expect(performance.now() - started).toBeLessThan(3_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'row:d9/f0.ts' }))?.text).toContain('✓')
  await ui.unmount()
})

test('a git status that fails after a commit marks nothing and keeps the badges', async ($, on) => {
  const { calls } = stubs(on, { git: '## main\0 M src/a.ts\0 M README.md\0' })
  await start($)
  calls.answer = (e: any) => {
    if (e.tool !== 'Bash') return { result: 'ok' }
    calls.git = '## main\0 M README.md\0'
    calls.gitFails = true
    return bashResult({ gitOperation: { commit: { sha: 'abc1234', kind: 'committed' } } })
  }
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x src/a.ts' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await header(ui)).toContain('⎇ main')
  expect((await ui.find({ key: 'row:README.md' }))?.text).not.toContain('✓')
  expect((await ui.find({ key: 'row:README.md' }))?.text).toMatch(/M$/)
  await ui.unmount()
})

test('a poll whose git status fails keeps the branch and badges', async ($, on) => {
  const { calls, clock } = stubs(on, { git: '## main\0 M README.md\0' })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  calls.gitFails = true
  const runs = calls.runs.length
  await clock.advance(5_000)
  expect(calls.runs.length).toBeGreaterThan(runs)
  expect(await header(ui)).toBe('◆ canopy · ⎇ main')
  expect((await ui.find({ key: 'row:README.md' }))?.text).toMatch(/M$/)
  await ui.unmount()
})

test('bash edits and reads light files', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  calls.answer = (e: any) => bashResult(e.command.startsWith('npx') ? { bashEditDiff: { files: [], moreFiles: 0, changedFiles: ['/w/README.md'] } } : {})
  await $.tool.call({ tool: 'Bash', command: 'npx prettier --write README.md' })
  await $.tool.call({ tool: 'Bash', command: 'cat src/a.ts | head -n 5' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(piece(await ui.find({ key: 'row:README.md' }), 'README.md')?.props).toEqual({ color: 'success', bold: true })
  expect(piece(await ui.find({ key: 'row:src/a.ts' }), 'a.ts')?.props.color).toBe('suggestion')
  expect(await header(ui)).toContain('✎ 1 · ◉ 1')
  await ui.unmount()
})

test('ignores files outside the root', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  const out: any = await $.tool.call({ tool: 'Read', file_path: '/etc/hosts' })
  expect(out.result.file.filePath).toBe('/etc/hosts')
  calls.answer = () => bashResult()
  await $.tool.call({ tool: 'Bash', command: 'cat ~/.zshrc ../outside.txt node_modules/left-pad/index.js' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/../etc/passwd', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await header(ui)).toBe('◆ canopy · ⎇ main')
  await ui.unmount()
})

test('other tools light a file only by its absolute path', async ($, on) => {
  stubs(on)
  await start($)
  // A remote tool's repository path is not a file on this disk.
  await $.tool.call({ tool: 'mcp__github__get_file_contents', path: 'README.md' } as any)
  await $.tool.call({ tool: 'mcp__files__write_file', path: '/w/package.json' } as any)
  await $.tool.call({ tool: 'mcp__files__read_text_file', path: '/w/src' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await header(ui)).toMatch(/^◆ canopy · ⎇ main · ✎ 1\S?$/)
  expect(piece(await ui.find({ key: 'row:package.json' }), 'package.json')?.props.color).toBe('success')
  await ui.unmount()
})

test('works outside a git repo', async ($, on) => {
  stubs(on, { gitExit: 128 })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await header(ui)).not.toContain('⎇')
    expect(await header(ui)).toContain('✎ 1')
    expect(await ui.find({ key: 'legend:git' })).toBeUndefined()
    expect((await ui.find({ key: 'row:src/a.ts' }))?.text).toMatch(/●$/)
    await ui.unmount()
  }
})

test('rescans after rm', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/b.md' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'row:src/b.md' })).toBeDefined()
  const listed = calls.lists.filter((p) => p === '/w/src').length
  calls.files['/w/src'] = [file('a.ts')]
  calls.answer = () => bashResult()
  await $.tool.call({ tool: 'Bash', command: 'rm src/b.md' })
  expect(calls.lists.filter((p) => p === '/w/src').length).toBeGreaterThan(listed)
  expect(await ui.find({ key: 'row:src/b.md' })).toBeUndefined()
  expect(await ui.find({ key: 'row:src/a.ts' })).toBeDefined()
  await ui.unmount()
})

test('pressing a folder expands it, and again closes it', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'row:docs/guide.md' })).toBeUndefined()
    await ui.press({ key: 'dir:docs' })
    expect(calls.lists).toContain('/w/docs')
    expect(await ui.find({ key: 'row:docs/guide.md' })).toBeDefined()
    expect((await ui.find({ key: 'row:docs' }))?.text).toContain('▾ docs/')
    await ui.press({ key: 'dir:docs' })
    expect(await ui.find({ key: 'row:docs/guide.md' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a folder pressed open while a rescan is running stays open', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  calls.answer = () => bashResult()
  let release = () => {}
  calls.hold['/w'] = new Promise<void>((r) => (release = r))
  const lists = calls.lists.length
  const shell = $.tool.call({ tool: 'Bash', command: 'touch notes.txt' })
  for (let i = 0; i < 100_000 && calls.lists.length === lists; i++) await Promise.resolve()
  delete calls.hold['/w']
  await ui.press({ key: 'dir:docs' })
  expect(await ui.find({ key: 'row:docs/guide.md' })).toBeDefined()
  release()
  await shell
  await ui.redraw()
  expect(await ui.find({ key: 'row:docs/guide.md' })).toBeDefined()
  await ui.unmount()
})

test('a folder the person closed stays closed while Claude works in it', async ($, on) => {
  stubs(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'dir:src' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' })
  expect(await ui.find({ key: 'row:src/a.ts' })).toBeUndefined()
  const src = await ui.find({ key: 'row:src' })
  expect(src?.text).toContain('▸ src/ ·1')
  expect(piece(src, '·1')?.props.color).toBe('#5FB97A')
  await ui.unmount()
})

test('/canopy toggles the pane', { options: { start: 'off' } }, async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  expect((await $.command.run({ command: 'canopy', args: '' })).text).toBeUndefined()
  expect(calls.opens).toHaveLength(1)
  await $.command.run({ command: 'canopy', args: '' })
  expect(calls.closes).toBe(1)
  await $.command.run({ command: 'canopy', args: '' })
  expect(calls.opens).toHaveLength(2)
  const lists = calls.lists.length
  expect((await $.command.run({ command: 'canopy', args: ' refresh ' })).text).toBe('canopy: rescanned')
  expect(calls.lists.length).toBeGreaterThan(lists)
})

test('heat fades with the clock', async ($, on) => {
  const { clock } = stubs(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = async () => (await ui.find({ key: 'row:src/a.ts' }))?.text.trim() ?? ''
  expect(await row()).toMatch(/●$/)
  await clock.advance(250)
  expect(await row()).toMatch(/◉$/)
  expect(await header(ui)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/)
  await clock.advance(9_000)
  expect(await row()).toMatch(/a\.ts$/)
  const warm = await ui.find({ key: 'row:src/a.ts' })
  expect(piece(warm, 'a.ts')?.props).toEqual({ color: 'success' })
  expect(await header(ui)).toBe('◆ canopy · ⎇ main · ✎ 1')
  // A minute later the folder closes again: nothing is happening in it.
  await clock.advance(60_000)
  expect(await ui.find({ key: 'row:src/a.ts' })).toBeUndefined()
  await ui.unmount()
})

test('a shown pane keeps up with changes made outside Claude', async ($, on) => {
  const { calls, clock } = stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  calls.files['/w'] = [...calls.files['/w']!, file('TODO.md')]
  calls.git = '## main\0?? TODO.md\0'
  await clock.advance(5_000)
  expect((await ui.find({ key: 'row:TODO.md' }))?.text).toMatch(/U$/)
  // Hidden, it stops polling; drawn again, it picks up where it left off.
  calls.open.delete('canopy')
  await clock.advance(1_000)
  const lists = calls.lists.length
  await clock.advance(10_000)
  expect(calls.lists.length).toBe(lists)
  calls.open.add('canopy')
  await ui.redraw()
  calls.files['/w'] = [...calls.files['/w']!, file('LATER.md')]
  await clock.advance(5_000)
  expect(await ui.find({ key: 'row:LATER.md' })).toBeDefined()
  await ui.unmount()
})

test('with the pane closed, the ticker rests right after a touch', { options: { start: 'off' } }, async ($, on) => {
  const { calls, clock } = stubs(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' })
  const panes = calls.panes
  await clock.advance(120_000)
  expect(calls.panes - panes).toBeLessThanOrEqual(1)
})

test('the ticker rests when the panes cannot be asked about', async ($, on) => {
  const { calls, clock } = stubs(on, { panesFail: true })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  await clock.advance(60_000)
  const panes = calls.panes
  await clock.advance(600_000)
  expect(calls.panes).toBe(panes)
})

test('one failed listing keeps the tree; a second says so', async ($, on) => {
  const { calls, clock } = stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const root = calls.files['/w']!
  delete calls.files['/w']
  await clock.advance(5_000)
  expect(await ui.find({ key: 'row:src' })).toBeDefined()
  await clock.advance(5_000)
  expect(await ui.find({ key: 'row:src' })).toBeUndefined()
  expect((await ui.find({ key: 'empty' }))?.text).toContain("can't read /w")
  calls.files['/w'] = root
  await clock.advance(5_000)
  expect(await ui.find({ key: 'row:src' })).toBeDefined()
  await ui.unmount()
})

test('follow never gets in the way', async ($, on) => {
  // The test kit has no `ui.scroll`, so canopy's scroll is refused here as on a hidden pane:
  // the touch still lands and the pane still draws.
  const { clock } = stubs(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  await clock.advance(500)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(piece(await ui.find({ key: 'row:src/a.ts' }), 'a.ts')?.props.color).toBe('suggestion')
  await ui.unmount()
})

test('activity none', { options: { activity: 'none' } }, async ($, on) => {
  stubs(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: '/w/README.md' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await header(ui)).toBe('◆ canopy · ⎇ main')
  expect(await ui.find({ key: 'row:src/a.ts' })).toBeUndefined()
  expect(piece(await ui.find({ key: 'row:README.md' }), 'README.md')?.props).toEqual({})
  expect(await ui.find({ key: 'legend' })).toBeUndefined()
  await ui.unmount()
})

test('activity writes ignores reads', { options: { activity: 'writes' } }, async ($, on) => {
  stubs(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/w/README.md' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/package.json', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await header(ui)).toMatch(/^◆ canopy · ⎇ main · ✎ 1\S?$/)
  expect(await ui.find({ key: 'row:README.md' })).toBeDefined()
  expect((await ui.find({ key: 'legend' }))?.text).not.toContain('reading')
  await ui.unmount()
})

test('.gitignore and the ignore option hide names', { options: { ignore: 'docs' } }, async ($, on) => {
  stubs(on, { gitignore: '*.md\n' })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'row:docs' })).toBeUndefined()
  expect(await ui.find({ key: 'row:README.md' })).toBeUndefined()
  expect(await ui.find({ key: 'row:package.json' })).toBeDefined()
  await ui.unmount()
})

test('reloads after /clear', async ($, on) => {
  const { calls } = stubs(on)
  await start($)
  const lists = calls.lists.filter((p) => p === '/w').length
  await $.classic.SessionStart({ source: 'clear' } as any)
  expect(calls.lists.filter((p) => p === '/w').length).toBe(lists + 1)
})

test('a huge folder stays drawable', async ($, on) => {
  const many = Array.from({ length: 5000 }, (_, i) => file(`f${i}.ts`))
  stubs(on, { files: { '/w': many } })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'row:f0.ts' })).toBeDefined()
    expect((await ui.find({ key: 'more:' }))?.text).toContain('… 4500 more')
    await ui.unmount()
  }
})

test('a read in a huge folder leaves the rest of the tree drawn', async ($, on) => {
  const files = FILES() as Record<string, any[]>
  files['/w'] = [dir('assets'), ...files['/w']!]
  files['/w/assets'] = Array.from({ length: 5000 }, (_, i) => file(`img${i}.png`))
  stubs(on, { files })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/w/assets/img7.png' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'row:assets/img7.png' })).toBeDefined()
  expect((await ui.find({ key: 'more:assets' }))?.text).toContain('… 4500 more')
  expect(await ui.find({ key: 'row:src' })).toBeDefined()
  expect(await ui.find({ key: 'row:README.md' })).toBeDefined()
  await ui.unmount()
})

test('a folder-heavy project stays under the element limit', async ($, on) => {
  const tops = ['a', 'b', 'c', 'd']
  const files: Record<string, any[]> = { '/w': tops.map(dir) }
  let changed = ''
  for (const top of tops) {
    files['/w/' + top] = Array.from({ length: 500 }, (_, i) => dir(`d${i}`))
    for (let i = 0; i < 500; i++) changed += ` M ${top}/d${i}/x.ts\0`
  }
  stubs(on, { files, git: '## main\0' + changed })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const top of tops) if (!(await ui.find({ key: 'row:' + top + '/d0' }))) await ui.press({ key: 'dir:' + top })
    expect((await ui.find({ key: 'overflow' }))?.text).toMatch(/^… \d+ more$/)
    await ui.unmount()
  }
})

test('narrow panes truncate', async ($, on) => {
  stubs(on, { files: { '/w': [file('a-really-long-component-name.tsx')] }, git: '## main\0 M a-really-long-component-name.tsx\0' })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 24 } })
  const row = await ui.find({ key: 'row:a-really-long-component-name.tsx' })
  expect(row?.text).toContain('…')
  expect(row?.text).toMatch(/ M$/)
  await ui.unmount()
})

test('an empty project says what will happen', async ($, on) => {
  stubs(on, { files: { '/w': [] } })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Empty folder — files appear here as Claude creates them.' })).toBeDefined()
    await ui.unmount()
  }
})

test('an unreadable root says so', async ($, on) => {
  stubs(on, { files: {} })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'empty' }))?.text).toBe("canopy can't read /w.")
  await ui.unmount()
})
