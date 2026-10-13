// canopy's tree model: which names to hide, how a folder's entries are ordered, and how the
// expanded folders flatten into rows with guide lines. Pure, no mods API.

export type Entry = { name: string; kind: 'file' | 'dir' }

/** Folder listings by path relative to the root ('' is the root); no trailing '/'. */
export type Listing = Record<string, Entry[]>

/** Names hidden anywhere, path prefixes hidden from the root, and name suffixes (`.log`). */
export type Ignore = { names: Set<string>; prefixes: string[]; suffixes: string[] }

export type Row =
  | { type: 'root'; path: ''; name: string }
  | { type: 'dir' | 'file'; path: string; name: string; depth: number; guides: string; expanded: boolean }
  | { type: 'more'; path: string; depth: number; guides: string; count: number }

/** Hidden in every project, whatever its .gitignore says. */
export const BUILTIN_IGNORE: readonly string[] = [
  '.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'target', '.DS_Store', '.turbo', '.cache',
]

/** The most rows drawn after the root; the rest of the folder being walked becomes one "… N more" row. */
export const ROW_CAP = 2000

// Guide pieces, three cells each: what an ancestor leaves behind, and the row's own connector.
const PIPE = '│  '
const GAP = '   '
const TEE = '├─ '
const ELBOW = '└─ '

/**
 * Reads the simple shapes of .gitignore lines: `name` hides that name anywhere, `*.ext` hides a
 * suffix, `/x` and `x/y` hide a path from the root. Comments, blank lines and `!` negations are
 * skipped, and so are globs this model can't express. `extra` is a comma-separated list read the
 * same way. The built-ins always apply.
 */
export function ignoreRules(gitignore: string, extra: string): Ignore {
  const ig: Ignore = { names: new Set(BUILTIN_IGNORE), prefixes: [], suffixes: [] }
  const patterns = [...gitignore.split(/\r?\n/), ...extra.split(',')]
  for (const raw of patterns) {
    let p = raw.trim()
    if (!p || p.startsWith('#') || p.startsWith('!')) continue
    p = p.replace(/\/+$/, '').replace(/^\*\*\//, '')
    if (!p) continue
    if (/^\*\.[^*?[\]/]+$/.test(p)) ig.suffixes.push(p.slice(1))
    else if (/[*?[\]]/.test(p)) continue
    else if (p.includes('/')) ig.prefixes.push(p.replace(/^\/+/, ''))
    else ig.names.add(p)
  }
  return ig
}

/** Whether the entry `name` at relative path `rel` is hidden by the rules. */
export function isIgnored(rel: string, name: string, ig: Ignore): boolean {
  if (ig.names.has(name)) return true
  if (ig.suffixes.some((s) => name.endsWith(s))) return true
  return ig.prefixes.some((p) => rel === p || rel.startsWith(p + '/'))
}

/** Whether a path is hidden because it, or any folder above it, is ignored. */
export function isHidden(rel: string, ig: Ignore): boolean {
  let at = ''
  for (const name of rel.split('/')) {
    at = join(at, name)
    if (isIgnored(at, name, ig)) return true
  }
  return false
}

/** One folder's listing as the tree shows it: ignored names dropped, folders first, natural order. */
export function toEntries(raw: ReadonlyArray<{ name: string; kind: string }>, dirRel: string, ig: Ignore): Entry[] {
  const entries: Entry[] = []
  for (const r of raw) {
    if (isIgnored(join(dirRel, r.name), r.name, ig)) continue
    // A link ('other') is shown as a file: following it could loop.
    entries.push({ name: r.name, kind: r.kind === 'dir' ? 'dir' : 'file' })
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return byName(a.name, b.name)
  })
}

function byName(a: string, b: string): number {
  const folded = a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { numeric: true })
  return folded !== 0 ? folded : a.localeCompare(b, undefined, { numeric: true })
}

/**
 * The rows to draw: the root, then every entry of each expanded folder under its parent. A row's
 * `guides` is drawn before its glyph: `│  ` or blank for each ancestor (blank when that ancestor
 * was the last of its folder), then `├─ ` or `└─ ` for the row itself.
 */
export function flatten(rootName: string, listing: Listing, isExpanded: (rel: string) => boolean, cap = ROW_CAP): Row[] {
  const rows: Row[] = [{ type: 'root', path: '', name: rootName }]
  let full = false

  const walk = (dirRel: string, depth: number, prefix: string): void => {
    const entries = listing[dirRel] ?? []
    for (let i = 0; i < entries.length; i++) {
      if (rows.length - 1 >= cap) {
        rows.push({ type: 'more', path: dirRel, depth, guides: prefix + ELBOW, count: entries.length - i })
        full = true
        return
      }
      const entry = entries[i]!
      const isLast = i === entries.length - 1
      const path = join(dirRel, entry.name)
      const guides = prefix + (isLast ? ELBOW : TEE)
      if (entry.kind === 'file') {
        rows.push({ type: 'file', path, name: entry.name, depth, guides, expanded: false })
        continue
      }
      const expanded = listing[path] !== undefined && isExpanded(path)
      rows.push({ type: 'dir', path, name: entry.name, depth, guides, expanded })
      if (expanded) walk(path, depth + 1, prefix + (isLast ? GAP : PIPE))
      if (full) return
    }
  }

  walk('', 0, '')
  return rows
}

/** The folders above a path, root first: 'a/b/c.ts' → ['', 'a', 'a/b']. */
export function ancestors(rel: string): string[] {
  if (!rel) return []
  const parts = rel.split('/')
  const out = ['']
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/**
 * A path relative to `root`, or null when it lies outside (or can't be read as a path).
 * Relative paths resolve against `cwd` (default: the root); `~` is the shell's, so it is outside.
 */
export function relativeTo(root: string, path: string, cwd?: string): string | null {
  if (!path || path.startsWith('~')) return null
  const abs = normalize(path.startsWith('/') ? path : (cwd ?? root) + '/' + path)
  const top = normalize(root)
  if (abs === null || top === null) return null
  if (top === '/') return abs.slice(1)
  if (abs === top) return ''
  return abs.startsWith(top + '/') ? abs.slice(top.length + 1) : null
}

// Folds '.', '..' and repeated or trailing slashes; null when '..' climbs above '/'.
function normalize(path: string): string | null {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part !== '..') out.push(part)
    else if (out.length === 0) return null
    else out.pop()
  }
  return '/' + out.join('/')
}

export function join(dirRel: string, name: string): string {
  return dirRel ? dirRel + '/' + name : name
}

/** The row that shows a path: the path itself, or the first closed folder above it. */
export function anchorFor(rel: string, isOpen: (dirRel: string) => boolean): string {
  const parts = rel.split('/')
  let dir = ''
  for (let i = 0; i < parts.length - 1; i++) {
    dir = join(dir, parts[i]!)
    if (!isOpen(dir)) return dir
  }
  return rel
}
