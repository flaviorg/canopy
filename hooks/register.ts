// canopy — your project's file tree beside the chat, lit by what Claude reads, edits and commits.
// This is the only file that touches the mods API ($). The modules beside it decide what to
// show; this one lists folders, asks git, watches Claude's tool calls, keeps the state the
// pane is drawn from, and draws it.
import { atom, read, update } from 'claude-code'
import { allows, anyHot, forget, heat, litDirs, mark, type Activity, type MarkKind, type Marks } from './activity.ts'
import { changesTree, isCommit, readPaths, touchesGit } from './bashpaths.ts'
import { committed, NO_GIT, parseStatus, STATUS_ARGV, withinPrefix, type GitState } from './git.ts'
import { anchorFor, ancestors, flatten, ignoreRules, isHidden, join, relativeTo, toEntries, type Entry, type Ignore, type Listing } from './tree.ts'
import { paneLines, type Line, type PaneStatus, type Seg } from './view.ts'

type Options = { start: 'on' | 'off'; activity: Activity; ignore: string; follow: 'on' | 'off' }

const PANE = 'canopy'
const DOCK_COLUMNS = 44
const TICK_MS = 250
const GIT_TIMEOUT_MS = 5_000
// Claude's own file tools. Any other tool naming a file by an absolute path counts too: as a
// write when its name says edit or write, else as a read.
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])

// What the pane is drawn from. $.state survives a hot reload; a drawing that reads it redraws
// when it changes.
const marksA = atom({ plugin: 'canopy', key: 'marks' } as const, {} as Marks)
const gitA = atom({ plugin: 'canopy', key: 'git' } as const, NO_GIT)
const expandedA = atom({ plugin: 'canopy', key: 'expanded' } as const, [] as string[])
const collapsedA = atom({ plugin: 'canopy', key: 'collapsed' } as const, [] as string[])

// Module state: rebuilt by scanning, so losing it to a reload costs one rescan.
let settings: Options = { start: 'on', activity: 'all', ignore: '', follow: 'on' }
let root: string | null = null
let rootName = ''
let gitPrefix = ''
let listing: Listing = {}
let listings = 0 // counts finished listings, so a scan knows which ones came after it began
const listedAt = new Map<string, number>()
const misses = new Map<string, number>() // listings in a row that failed, by folder
let ig: Ignore = ignoreRules('', '')
let frame = 0
let tick = 0
let ticker: { cancel(): void } | null = null
let busy = false // a tick still running when the next one is due lets it pass
let wasHot = false // one more frame once the last hot mark cools
let wasLit = false // one more redraw once the last mark goes cold
let gitDue = false // a file changed: ask git on the next check
let followTo: string | null = null
let toasted = false

export function register(on: any, options: Partial<Options>) {
  settings = { ...settings, ...options }

  on('session.start', async ($: any, e: any, next: any) => {
    await boot($)
    try {
      await $.command.register({ name: 'canopy', description: 'Show or hide the project tree', argumentHint: '[refresh]', immediate: true })
    } catch {}
    if (settings.start === 'on' && !(await openPane($)) && !toasted) {
      toasted = true
      $.ui.toast('canopy: run /canopy to open the tree')
    }
    if (root !== null) ensureTicker($)
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  // /clear, /resume and /branch reset $.state: start from a fresh scan.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($: any, e: any, next: any) => {
    await boot($)
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  // Observes every tool call and always returns what the tool gave.
  on('tool.call', async ($: any, e: any, next: any) => {
    if (root === null) return next(e)
    const path = pathOf(e)
    const command = e.tool === 'Bash' && typeof e.command === 'string' ? (e.command as string) : null
    // A Read lights its file while it runs, and while it waits for permission.
    const earlier = e.tool === 'Read' && path ? await read($, marksA) : null
    const reading = earlier ? await touch($, [path!], 'read') : []
    // A commit is judged against the status just before it (null: git could not say).
    const before = command !== null && isCommit(command) ? await readStatus($) : undefined
    const r = await next(e)
    try {
      if (!r?.deny && !r?.isError) await afterTool($, e.tool, r.result, path, command, before)
      else if (reading.length) await update($, marksA, (marks: Marks) => forget(marks, reading, earlier!))
    } catch {}
    return r
  }).catch(($: any, e: any, next: any) => next(e))

  on('command.run', { command: 'canopy' }, async ($: any, e: any) => {
    if ((e.args ?? '').trim() === 'refresh') {
      await boot($)
      return { text: 'canopy: rescanned' }
    }
    const pane = (await $.ui.panes()).find((p: any) => p.id === PANE)
    if (pane?.isShown) {
      await $.ui.close({ id: PANE })
      return {}
    }
    if (root === null) await boot($)
    else await freshen($)
    await openPane($)
    ensureTicker($)
    return {}
  }).catch(($: any, e: any, next: any) => (next.called ? next(e) : { text: 'canopy could not open: ' + next.error.kind }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($: any, e: any) => {
    // Shown again after the ticker stopped (hidden and idle): keep up from here.
    ensureTicker($)
    const marks = await read($, marksA)
    const git = await read($, gitA)
    const now = await $.clock.now()
    const open = openSet(marks, await read($, expandedA), await read($, collapsedA), now)
    const rows = flatten(rootName, listing, (rel) => open.has(rel))
    const width = e.props?.bodyColumns ?? DOCK_COLUMNS
    const lines = paneLines({ rows, marks, git, now, frame, width, activity: settings.activity }, paneStatus(), root ?? 'the project folder')
    const elements = $.ui.resolve(e)
    const toggle = (dir: string) => toggleDir($, dir)
    return elements.Box({ flexDirection: 'column', children: lines.map((line) => drawLine(elements, line, toggle)) })
  })
}

// Finds the root, reads its .gitignore, lists the open folders and asks git. Safe to repeat.
async function boot($: any): Promise<void> {
  try {
    root = normalRoot(await $.session.root())
  } catch {
    root = null
    return
  }
  rootName = root.split('/').filter(Boolean).pop() ?? root
  let gitignore = ''
  try {
    gitignore = await $.fs.read(absolute('.gitignore'))
  } catch {}
  ig = ignoreRules(gitignore, settings.ignore)
  gitPrefix = await readGitPrefix($)
  // Cached listings are replaced folder by folder, so the pane never blinks empty.
  await freshen($)
}

// Catches up with the disk and the repository.
async function freshen($: any): Promise<void> {
  await scanVisible($)
  await refreshGit($)
}

async function openPane($: any): Promise<boolean> {
  try {
    const opened = await $.ui.open({ id: PANE, title: 'Canopy', columns: DOCK_COLUMNS })
    return opened?.isPlaced === true
  } catch {
    return false
  }
}

// Lists one folder into the cache, redrawing when it changed. One failed listing keeps the
// last (a passing hiccup); a folder that fails twice in a row is forgotten, and so drawn closed.
async function scanDir($: any, rel: string): Promise<void> {
  if (root === null) return
  const was = JSON.stringify(listing[rel])
  try {
    listing[rel] = toEntries(await $.fs.list(absolute(rel)), rel, ig)
    misses.delete(rel)
  } catch {
    const missed = (misses.get(rel) ?? 0) + 1
    misses.set(rel, missed)
    if (missed > 1) delete listing[rel]
  }
  listedAt.set(rel, ++listings)
  if (JSON.stringify(listing[rel]) !== was) $.ui.invalidate('ui.render')
}

// Lists every folder the tree shows open, parents first (a folder is listed only while its
// parent shows it), then forgets the listings of folders that closed. Scans overlap (a poll,
// a press, a shell command), so a folder open by the end, or listed by another since this
// one began, is kept.
async function scanVisible($: any): Promise<void> {
  const began = listings
  const open = await openDirs($)
  const listed = new Set<string>()
  for (const dir of [...open].sort((a, b) => depth(a) - depth(b))) {
    if (dir !== '' && !hasEntry(dir, 'dir')) continue
    await scanDir($, dir)
    listed.add(dir)
  }
  const openNow = await openDirs($)
  for (const dir of Object.keys(listing)) {
    if (listed.has(dir) || openNow.has(dir) || (listedAt.get(dir) ?? 0) > began) continue
    delete listing[dir]
    listedAt.delete(dir)
    misses.delete(dir)
  }
}

// The folders drawn open: the root, the ones the person opened and the ones Claude is working
// in, less the ones the person closed.
function openSet(marks: Marks, expanded: string[], collapsed: string[], now: number): Set<string> {
  const open = new Set([...litDirs(marks, now), ...expanded])
  for (const dir of collapsed) open.delete(dir)
  return open.add('')
}

async function openDirs($: any): Promise<Set<string>> {
  return openSet(await read($, marksA), await read($, expandedA), await read($, collapsedA), await $.clock.now())
}

// Asks git for the branch and badges and keeps them. When git can't say (it timed out, failed
// to start or broke), the last answer stands and this returns null.
async function refreshGit($: any): Promise<GitState | null> {
  gitDue = false
  const state = await readStatus($)
  if (state !== null && JSON.stringify(await read($, gitA)) !== JSON.stringify(state)) await update($, gitA, () => state)
  return state
}

// One `git status`: the branch and badges; none outside a repository; null when git can't say.
async function readStatus($: any): Promise<GitState | null> {
  if (root === null) return null
  try {
    // GIT_OPTIONAL_LOCKS=0: a status never takes the index lock from Claude's own git commands.
    const r = await $.process.run([...STATUS_ARGV], { cwd: root, timeoutMs: GIT_TIMEOUT_MS, env: { GIT_OPTIONAL_LOCKS: '0' } })
    if (r.exitCode === 0) return withinPrefix(parseStatus(r.stdout), gitPrefix)
    return /not a git repository/i.test(r.stderr) ? NO_GIT : null
  } catch {
    return null
  }
}

// Where the root sits inside its repository ('web/'), since git names paths from the top.
async function readGitPrefix($: any): Promise<string> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-prefix'], { cwd: root, timeoutMs: GIT_TIMEOUT_MS })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

// Lights files Claude touched and returns their relative paths. Only what the tree can show
// counts: a path outside the root, hidden by the ignore rules, missing or a folder is left alone.
async function touch($: any, paths: readonly string[], kind: MarkKind, cwd?: string): Promise<string[]> {
  if (root === null || !allows(settings.activity, kind)) return []
  const lit: string[] = []
  const listed = new Set<string>()
  for (const path of paths) {
    const rel = relativeTo(root, path, cwd ?? root)
    if (rel && !isHidden(rel, ig) && (await showsFile($, rel, kind !== 'read', listed))) lit.push(rel)
  }
  if (lit.length === 0) return []
  const now = await $.clock.now()
  await update($, marksA, (marks: Marks) => lit.reduce((acc, rel) => mark(acc, rel, kind, now), marks))
  // The folders above now open; one a scan forgot meanwhile is listed again.
  for (const rel of lit) for (const dir of ancestors(rel)) if (!(dir in listing) && !listed.has(dir)) {
    listed.add(dir)
    await scanDir($, dir)
  }
  if (settings.follow === 'on' && kind !== 'commit') followTo = lit[lit.length - 1]!
  ensureTicker($)
  return lit
}

// Whether the tree holds `rel` as a file. Lists the folders above it first, root down (they
// open as it lights). A write may have just made the file and folders above it, so a folder
// whose listing lacks the next step is listed again; `listed` keeps that to once per touch.
async function showsFile($: any, rel: string, mayBeNew: boolean, listed: Set<string>): Promise<boolean> {
  const dirs = ancestors(rel)
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i]!
    const holds = () => (i + 1 < dirs.length ? hasEntry(dirs[i + 1]!, 'dir') : hasEntry(rel, 'file'))
    if (!(dir in listing) || (mayBeNew && !listed.has(dir) && !holds())) {
      listed.add(dir)
      await scanDir($, dir)
    }
    if (!holds()) return false
  }
  return true
}

// What a finished tool call changed: the file it wrote or read, or what a shell command did.
async function afterTool($: any, tool: string, result: any, path: string | undefined, command: string | null, before: GitState | null | undefined): Promise<void> {
  if (command !== null) return afterBash($, command, result, before)
  if (!path || tool === 'Read') return
  if (/edit|write/i.test(tool)) {
    await touch($, [path], 'write')
    gitDue = true
  } else {
    await touch($, [path], 'read')
  }
}

// `before`: the status just before a `git commit` (null when git couldn't say), undefined for
// any other command.
async function afterBash($: any, command: string, result: any, before: GitState | null | undefined): Promise<void> {
  if (changesTree(command)) await scanVisible($)
  const changed: string[] = result?.bashEditDiff?.changedFiles ?? []
  if (changed.length) {
    await touch($, changed, 'write')
    gitDue = true
  }
  if (allows(settings.activity, 'read')) await touch($, readPaths(command), 'read', await cwdOf($))
  if (result?.gitOperation?.commit || before !== undefined) {
    const was = before === undefined ? await read($, gitA) : before
    const now = await refreshGit($)
    // Only two answers git gave can say what a commit took.
    if (was !== null && now !== null) await touch($, committed(was, now), 'commit')
  } else if (touchesGit(command)) {
    await refreshGit($)
  }
}

// Opens or closes a folder the person pressed. Their choice outlasts Claude's activity there.
async function toggleDir($: any, dir: string): Promise<void> {
  const without = (dirs: string[]) => dirs.filter((d) => d !== dir)
  if ((await openDirs($)).has(dir)) {
    await update($, expandedA, without)
    await update($, collapsedA, (dirs: string[]) => [...without(dirs), dir])
  } else {
    await update($, collapsedA, without)
    await update($, expandedA, (dirs: string[]) => [...without(dirs), dir])
    await scanVisible($)
  }
  $.ui.invalidate('ui.render')
}

function ensureTicker($: any): void {
  if (ticker === null) ticker = $.clock.every(TICK_MS, () => onTick($))
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = null
}

// Four frames a second while a mark is hot. Every second: follow up on edits (git), let heat
// fade, and stop once the pane is hidden (heat is worked out again when it is drawn). Every
// five seconds while shown, catch what changed outside Claude (a rescan and a git status).
async function onTick($: any): Promise<void> {
  if (busy) return
  busy = true
  try {
    frame++
    tick++
    const now = await $.clock.now()
    const marks = await read($, marksA)
    const hot = anyHot(marks, now)
    if (hot || wasHot) $.ui.invalidate('ui.render')
    wasHot = hot
    if (followTo !== null) await follow($)
    if (tick % 4 !== 0) return
    if (gitDue) await refreshGit($)
    // A pane that can't be asked about counts as hidden. The next drawing or touch restarts.
    const panes = await $.ui.panes().catch(() => [])
    if (root === null || !panes.some((p: any) => p.id === PANE && p.isShown)) return stopTicker()
    const lit = Object.values(marks).some((m) => heat(m, now) !== 'cold')
    if (lit || wasLit) $.ui.invalidate('ui.render')
    wasLit = lit
    if (tick % 20 === 0) await freshen($)
  } catch {
    stopTicker()
  } finally {
    busy = false
  }
}

// Scrolls the pane to the file Claude touched last, or to the closed folder holding it. It
// runs on the tick after the touch, once the row is drawn; a hidden pane just says no.
async function follow($: any): Promise<void> {
  const rel = followTo!
  followTo = null
  const open = await openDirs($)
  try {
    await $.ui.scroll({ in: PANE, to: { key: 'row:' + anchorFor(rel, (dir) => open.has(dir)) }, block: 'nearest' })
  } catch {}
}

// One line as one row Box; a Button around its left side when it opens or closes a folder.
function drawLine(elements: any, line: Line, toggle: (dir: string) => void): any {
  const { Box, Button } = elements
  const left = line.left.map((seg) => drawSeg(elements, seg))
  const dir = line.toggle
  const children = dir === undefined ? left : [Button({ key: 'dir:' + dir, plain: true, onPress: () => toggle(dir), children: left })]
  if (line.right.length) children.push(Box({ flexGrow: 1 }), ...line.right.map((seg) => drawSeg(elements, seg)))
  return Box({ key: line.key, flexDirection: 'row', children })
}

// A plain segment is a bare string (one element fewer); a styled one is a Text with only the
// props it sets.
function drawSeg(elements: any, seg: Seg): any {
  if (seg.color === undefined && !seg.bold && !seg.dim) return seg.text
  return elements.Text({
    ...(seg.color !== undefined ? { color: seg.color } : {}),
    ...(seg.bold ? { bold: true } : {}),
    ...(seg.dim ? { dimColor: true } : {}),
    children: [seg.text],
  })
}

function paneStatus(): PaneStatus {
  const top = listing['']
  if (root === null || top === undefined) return 'unreadable'
  return top.length === 0 ? 'empty' : 'ready'
}

// The file a tool names: Read/Edit/Write's file_path, NotebookEdit's notebook_path, or another
// tool's file_path or path when absolute (a remote tool's repository path is not on this disk).
function pathOf(e: any): string | undefined {
  const named = [e.file_path, e.notebook_path, e.path].find((p) => typeof p === 'string') as string | undefined
  if (named === undefined) return undefined
  return FILE_TOOLS.has(e.tool) || named.startsWith('/') ? named : undefined
}

async function cwdOf($: any): Promise<string | undefined> {
  try {
    return await $.session.cwd()
  } catch {
    return undefined
  }
}

// Each listing's names, built on first use: a commit of thousands of files asks once per file.
const indexes = new WeakMap<readonly Entry[], Map<string, Entry['kind']>>()

function hasEntry(rel: string, kind: Entry['kind']): boolean {
  const entries = listing[parentOf(rel)]
  if (entries === undefined) return false
  let index = indexes.get(entries)
  if (index === undefined) {
    index = new Map(entries.map((entry) => [entry.name, entry.kind]))
    indexes.set(entries, index)
  }
  return index.get(rel.slice(rel.lastIndexOf('/') + 1)) === kind
}

function absolute(rel: string): string {
  if (!rel) return root!
  return root === '/' ? '/' + rel : join(root!, rel)
}

function normalRoot(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function parentOf(rel: string): string {
  const slash = rel.lastIndexOf('/')
  return slash < 0 ? '' : rel.slice(0, slash)
}

function depth(rel: string): number {
  return rel === '' ? 0 : rel.split('/').length
}
