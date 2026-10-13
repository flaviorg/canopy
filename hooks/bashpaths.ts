// canopy reads Claude's shell commands for three things: the files a command reads (so they
// light up), whether it changes the tree (so canopy rescans), and whether it changes git
// (so the badges refresh). A light reading, not a shell: anything it can't be sure of is left
// out. Pure, no mods API.

type Token = { text: string; quoted: boolean }

const READ_VERBS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'wc', 'sed', 'awk', 'grep', 'rg'])

// Flags whose value is the next word, per verb.
const VALUE_FLAGS: Record<string, Set<string>> = {
  head: new Set(['-n', '-c']),
  tail: new Set(['-n', '-c']),
  grep: new Set(['-e', '-f', '-m', '-A', '-B', '-C', '-d', '-D', '--regexp', '--file', '--include', '--exclude', '--exclude-dir']),
  rg: new Set(['-e', '-f', '-m', '-A', '-B', '-C', '-g', '-t', '-T', '-r', '-M', '-j', '--regexp', '--file', '--glob', '--iglob', '--type', '--type-not']),
  sed: new Set(['-e', '-f', '-l', '--expression', '--file']),
  awk: new Set(['-F', '-v', '-f']),
  bat: new Set(['-l', '-r', '-H', '-m', '--language', '--line-range', '--highlight-line', '--map-syntax']),
}

// Verbs whose first argument is a pattern or a script, unless a flag already gave one.
const SCRIPT_FLAGS: Record<string, Set<string>> = {
  grep: new Set(['-e', '-f', '--regexp', '--file']),
  rg: new Set(['-e', '-f', '--regexp', '--file']),
  sed: new Set(['-e', '-f', '--expression', '--file']),
  awk: new Set(['-f']),
}

const TREE_VERBS = new Set(['rm', 'mv', 'cp', 'mkdir', 'rmdir', 'touch', 'ln', 'unzip', 'tar', 'tee', 'rsync'])
const GIT_TREE = new Set(['checkout', 'switch', 'stash', 'merge', 'pull', 'rebase', 'reset', 'restore', 'clean', 'rm', 'mv', 'clone', 'apply', 'cherry-pick', 'revert', 'am'])
const GIT_STATUS = new Set(['commit', 'checkout', 'switch', 'stash', 'merge', 'pull', 'rebase', 'reset', 'restore', 'add', 'rm', 'mv', 'cherry-pick', 'revert', 'am', 'apply', 'clean', 'init', 'branch'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const PACKAGE_CHANGES = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'ci'])
const PREFIX_WORDS = new Set(['sudo', 'env', 'time', 'nohup', 'command'])

const MAX_READ_PATHS = 8
// Words a path can't be sure of: globs, expansions, substitutions, redirects.
const UNSURE = /[*$`()<>]/

/** The paths a command reads, as written (relative or absolute), at most 8. */
export function readPaths(command: string): string[] {
  const found = new Set<string>()
  for (const words of commands(command)) {
    const verb = verbOf(words)
    if (!READ_VERBS.has(verb)) continue
    for (const path of argumentsOf(verb, words)) found.add(path)
  }
  return [...found].slice(0, MAX_READ_PATHS)
}

/** Whether a command adds, removes or moves files (a rescan is due). */
export function changesTree(command: string): boolean {
  return segments(command).some((tokens) => {
    if (writesFile(tokens)) return true
    const words = stripPrefix(tokens)
    const verb = verbOf(words)
    if (TREE_VERBS.has(verb)) return true
    if (verb === 'git') return GIT_TREE.has(gitSubcommand(words))
    return PACKAGE_MANAGERS.has(verb) && PACKAGE_CHANGES.has(words[1]?.text ?? '')
  })
}

/** Whether a command changes what `git status` reports (or the branch). */
export function touchesGit(command: string): boolean {
  return commands(command).some((words) => verbOf(words) === 'git' && GIT_STATUS.has(gitSubcommand(words)))
}

/** Whether a command makes a commit. */
export function isCommit(command: string): boolean {
  return commands(command).some((words) => verbOf(words) === 'git' && gitSubcommand(words) === 'commit')
}

function commands(command: string): Token[][] {
  return segments(command).map(stripPrefix).filter((words) => words.length > 0)
}

// Splits on && || ; | & and newlines outside quotes, then into words; quotes are removed and
// a word remembers whether any of it was quoted. A '#' at the start of a word ends the line.
function segments(command: string): Token[][] {
  const out: Token[][] = []
  let tokens: Token[] = []
  let text = ''
  let quoted = false
  let inWord = false
  let quote: string | null = null
  const endWord = () => {
    if (inWord) tokens.push({ text, quoted })
    text = ''
    quoted = false
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (tokens.length) out.push(tokens)
    tokens = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    const next = command[i + 1]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && next !== undefined) text += command[++i]
      else text += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      quoted = true
      inWord = true
    } else if (c === '\\' && next !== undefined) {
      i++
      if (next !== '\n') {
        text += next
        inWord = true
      }
    } else if (c === '#' && !inWord) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (c === '\n' || c === ';') {
      endSegment()
    } else if (c === '|') {
      endSegment()
      if (next === '|' || next === '&') i++
    } else if (c === '&' && next === '&') {
      endSegment()
      i++
    } else if (c === '&' && !(text.endsWith('>') || text.endsWith('<') || next === '>')) {
      endSegment() // a background job
    } else {
      text += c
      inWord = true
    }
  }
  endSegment()
  return out
}

// Drops `sudo` (and its flags), `env`, `time`, `nohup`, `command` and VAR=value words.
function stripPrefix(tokens: Token[]): Token[] {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!.text
    if (PREFIX_WORDS.has(t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) i++
    else if (i > 0 && t.startsWith('-')) i += t === '-u' || t === '-g' ? 2 : 1
    else break
  }
  return tokens.slice(i)
}

function verbOf(words: Token[]): string {
  const first = words[0]?.text ?? ''
  return first.slice(first.lastIndexOf('/') + 1)
}

// The arguments of a read verb that name files: flags and their values, the pattern or script,
// redirects and anything unsure are left out.
function argumentsOf(verb: string, words: Token[]): string[] {
  const paths: string[] = []
  let needsScript = verb in SCRIPT_FLAGS
  let flagsOver = false
  for (let i = 1; i < words.length; i++) {
    const { text, quoted } = words[i]!
    const redirect = quoted ? null : redirectOf(text)
    if (redirect) {
      if (redirect.target === '') i++
      continue
    }
    if (!flagsOver && text === '--') {
      flagsOver = true
    } else if (!flagsOver && text.startsWith('-') && text.length > 1) {
      if (SCRIPT_FLAGS[verb]?.has(text)) needsScript = false
      if (VALUE_FLAGS[verb]?.has(text)) i++
    } else if (needsScript) {
      needsScript = false
    } else if (text && text !== '-' && !UNSURE.test(text)) {
      paths.push(text)
    }
  }
  return paths
}

// A redirect word: `>`, `2>>`, `&>`, `<`, `<<` (bare: the target is the next word) or with the
// target attached (`>out.txt`, `2>&1`).
function redirectOf(text: string): { op: string; target: string } | null {
  const m = /^(?:\d+|&)?(>>?|<<?<?)(.*)$/.exec(text)
  return m ? { op: m[1]!, target: m[2]! } : null
}

// Whether a segment sends output to a file (not /dev/null, not another descriptor).
function writesFile(tokens: Token[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const redirect = tokens[i]!.quoted ? null : redirectOf(tokens[i]!.text)
    if (!redirect || !redirect.op.startsWith('>')) continue
    const target = redirect.target || tokens[i + 1]?.text || ''
    if (target && target !== '/dev/null' && !target.startsWith('&')) return true
  }
  return false
}

// The git sub-command after global options: `git -C app commit` → 'commit'.
function gitSubcommand(words: Token[]): string {
  for (let i = 1; i < words.length; i++) {
    const text = words[i]!.text
    if (GIT_VALUE_OPTIONS.has(text)) i++
    else if (!text.startsWith('-')) return text
  }
  return ''
}
