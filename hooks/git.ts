// canopy's view of git: the branch and a badge per changed path, read from
// `git status --porcelain=v1 -b -z`, and which files a commit took. Pure, no mods API.

export type Badge = 'M' | 'A' | 'D' | 'R' | 'U'
export type GitState = { branch: string | null; files: Record<string, Badge> }

/** The one git command canopy runs: machine-readable, with the branch, NUL-separated. */
export const STATUS_ARGV: readonly string[] = ['git', 'status', '--porcelain=v1', '-b', '-z']

/** Outside a repository (or before the first status): no branch, no badges. */
export const NO_GIT: GitState = { branch: null, files: {} }

// Most severe first: a folder shows the worst thing inside it.
const SEVERITY: readonly Badge[] = ['D', 'M', 'A', 'R', 'U']

export function parseStatus(out: string): GitState {
  const fields = out.split('\0')
  const files: Record<string, Badge> = {}
  let branch: string | null = null
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field.startsWith('## ')) {
      branch = branchOf(field.slice(3))
      continue
    }
    if (field.length < 4) continue
    const x = field[0]!
    const y = field[1]!
    // A rename or copy is followed by the path it came from; that field is not an entry.
    if (x === 'R' || x === 'C') i++
    const badge = badgeOf(x, y)
    if (badge) files[field.slice(3).replace(/\/$/, '')] = badge
  }
  return { branch, files }
}

function branchOf(line: string): string {
  const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(line)
  if (unborn) return unborn[1]!
  return line.split('...')[0]!.split(' ')[0]!
}

function badgeOf(x: string, y: string): Badge | null {
  if (x === '!') return null
  if (x === '?') return 'U'
  if (x === 'D' || y === 'D') return 'D'
  if (x === 'R') return 'R'
  if (x === 'A' || x === 'C') return 'A'
  return x !== ' ' || y !== ' ' ? 'M' : null
}

/**
 * A path's own badge; a file inside an untracked folder is untracked too (git reports only
 * the folder).
 */
export function badgeFor(files: Record<string, Badge>, rel: string): Badge | null {
  const own = files[rel]
  if (own) return own
  const parts = rel.split('/')
  for (let i = parts.length - 1; i > 0; i--) {
    if (files[parts.slice(0, i).join('/')] === 'U') return 'U'
  }
  return null
}

/** The most severe badge inside a folder ('' is the whole tree), or the folder's own. */
export function rollup(files: Record<string, Badge>, dirRel: string): Badge | null {
  const prefix = dirRel + '/'
  let worst = SEVERITY.length
  for (const [path, badge] of Object.entries(files)) {
    if (dirRel !== '' && path !== dirRel && !path.startsWith(prefix)) continue
    worst = Math.min(worst, SEVERITY.indexOf(badge))
  }
  return SEVERITY[worst] ?? (dirRel ? badgeFor(files, dirRel) : null)
}

/** The paths a commit took: changed before, clean after. */
export function committed(before: GitState, after: GitState): string[] {
  return Object.keys(before.files).filter((path) => !(path in after.files)).sort()
}
