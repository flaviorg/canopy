// canopy's file icons: a colored badge (or, with icons: swatches, a colored glyph) before each
// file name, so a glance tells TypeScript from Markdown from config. Pure data, no mods API.
import { own } from './tree.ts'

export type Swatch = { glyph: string; color: string }

const DEFAULT: Swatch = { glyph: '▪', color: 'subtle' }

// Extension → color. Colors follow each language's widely used brand color, moved to a mid
// tone where needed: a swatch must read on light and dark themes alike (3:1 against both).
export const BY_EXT: Readonly<Record<string, string>> = {
  ts: '#3178C6', tsx: '#3178C6', mts: '#3178C6', cts: '#3178C6',
  js: '#A6950E', jsx: '#A6950E', mjs: '#A6950E', cjs: '#A6950E',
  json: '#B5902F', jsonc: '#B5902F', json5: '#B5902F',
  md: '#7698B4', mdx: '#7698B4', txt: '#949494', rst: '#949494',
  css: '#A56EDC', scss: '#C6538C', sass: '#C6538C', less: '#4C73B6',
  html: '#E34C26', htm: '#E34C26', vue: '#3BA777', svelte: '#FF3E00', astro: '#FF5D01',
  py: '#3572A5', ipynb: '#DA5B0B', rb: '#CC342D', go: '#00A1C9', rs: '#D18052',
  java: '#B07219', kt: '#A97BFF', kts: '#A97BFF', swift: '#F05138', dart: '#00A59C',
  c: '#8E8E8E', h: '#8E8E8E', cpp: '#F34B7D', hpp: '#F34B7D', cs: '#178600',
  php: '#5766A4', lua: '#5E7CE2', ex: '#835896', exs: '#835896', zig: '#E77533',
  sh: '#54A81E', bash: '#54A81E', zsh: '#54A81E', fish: '#54A81E', ps1: '#5391FE',
  yml: '#CB4B4B', yaml: '#CB4B4B', toml: '#AF4A25', ini: '#AF4A25', env: '#C08A26',
  sql: '#D18100', prisma: '#5A67D8', graphql: '#E10098', gql: '#E10098', proto: '#7A9A4A',
  png: '#B088A9', jpg: '#B088A9', jpeg: '#B088A9', gif: '#B088A9', svg: '#D48000', webp: '#B088A9', ico: '#B088A9',
  mp4: '#B088A9', mov: '#B088A9', mp3: '#B088A9', wav: '#B088A9', pdf: '#E5534B',
  lock: '#6E6E6E', log: '#6E6E6E',
}

// Whole names that mean more than their extension.
export const BY_NAME: Readonly<Record<string, Swatch>> = {
  'package.json': { glyph: '◆', color: '#CB3837' },
  'tsconfig.json': { glyph: '◆', color: '#3178C6' },
  dockerfile: { glyph: '◆', color: '#2496ED' },
  'docker-compose.yml': { glyph: '◆', color: '#2496ED' },
  makefile: { glyph: '◆', color: '#6D8086' },
  'readme.md': { glyph: '◆', color: '#7698B4' },
  license: { glyph: '◆', color: '#B38F00' },
  '.gitignore': { glyph: '▪', color: '#F05032' },
  '.env': { glyph: '▪', color: '#C08A26' },
  'claude.md': { glyph: '◆', color: '#D97757' },
}

/** The swatch for a file name: special names first, then the extension, then a dim square. */
export function swatchFor(name: string): Swatch {
  const lower = name.toLowerCase()
  const special = own(BY_NAME, lower)
  if (special) return special
  if (lower.startsWith('.env')) return BY_NAME['.env']!
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return DEFAULT
  const color = own(BY_EXT, lower.slice(dot + 1))
  return color ? { glyph: '▪', color } : DEFAULT
}

/**
 * A badge: a two-cell label on a colored tile, as an editor's file icons look. The tile carries
 * its own text color, so it reads the same on any theme.
 */
export type FileIcon = { label: string; bg: string; fg: string }

/** The tile of a file canopy has no badge for: blank, like a sheet of paper. */
export const PLAIN_TILE = '#5A5F69'

/** The tile of a type canopy doesn't know: its extension's first letters on gray. */
export const UNKNOWN_TILE = '#6B7280'

// [label, tile, text]: the label is two cells; the text color is worked out from the tile
// unless given. Tiles follow each language's brand color.
type Spec = readonly [label: string, bg: string, fg?: string]

const LOCK: Spec = ['LK', '#6B7280']
const DOCKER: Spec = ['DK', '#2496ED']
const GIT: Spec = ['GI', '#F05032']
const CONFIG: Spec = ['CF', '#6D8086']
const LICENSE: Spec = ['© ', '#B38F00']

export const BADGE_BY_EXT: Readonly<Record<string, Spec>> = {
  ts: ['TS', '#3178C6'], mts: ['TS', '#3178C6'], cts: ['TS', '#3178C6'], tsx: ['TS', '#1F9BCF'],
  js: ['JS', '#F0DB4F'], mjs: ['JS', '#F0DB4F'], cjs: ['JS', '#F0DB4F'], jsx: ['JS', '#1F9BCF'],
  json: ['{}', '#C9A227'], jsonc: ['{}', '#C9A227'], json5: ['{}', '#C9A227'],
  md: ['M↓', '#4A6A8A'], mdx: ['M↓', '#4A6A8A'], markdown: ['M↓', '#4A6A8A'], txt: ['TX', '#6B7280'], rst: ['TX', '#6B7280'],
  css: ['CS', '#663399'], scss: ['SC', '#C6538C'], sass: ['SC', '#C6538C'], less: ['LE', '#1D365D'],
  html: ['<>', '#E34C26'], htm: ['<>', '#E34C26'], xml: ['<>', '#0060AC'], svg: ['SG', '#FFB13B'],
  vue: ['VU', '#41B883'], svelte: ['SV', '#FF3E00'], astro: ['AS', '#FF5D01'],
  py: ['PY', '#3572A5', '#FFD43B'], ipynb: ['NB', '#DA5B0B'], rb: ['RB', '#CC342D'], go: ['GO', '#00ADD8'],
  rs: ['RS', '#DEA584'], java: ['JV', '#B07219'], kt: ['KT', '#7F52FF'], kts: ['KT', '#7F52FF'],
  swift: ['SW', '#F05138'], dart: ['DT', '#00B4AB'], c: ['C ', '#5C6BC0'], h: ['H ', '#5C6BC0'],
  cpp: ['C+', '#F34B7D'], cc: ['C+', '#F34B7D'], cxx: ['C+', '#F34B7D'], hpp: ['H+', '#F34B7D'], cs: ['C#', '#178600'],
  php: ['PH', '#777BB4'], lua: ['LU', '#000080'], ex: ['EX', '#6E4A7E'], exs: ['EX', '#6E4A7E'], zig: ['ZG', '#EC915C'],
  sh: ['$_', '#4EAA25'], bash: ['$_', '#4EAA25'], zsh: ['$_', '#4EAA25'], fish: ['$_', '#4EAA25'], ps1: ['PS', '#012456'],
  yml: ['YM', '#CB171E'], yaml: ['YM', '#CB171E'], toml: ['TO', '#9C4221'], ini: CONFIG, cfg: CONFIG, conf: CONFIG,
  env: ['EN', '#ECD53F'], sql: ['SQ', '#E38C00'], prisma: ['PR', '#2D3748'], graphql: ['GQ', '#E10098'], gql: ['GQ', '#E10098'],
  proto: ['PB', '#4285F4'], csv: ['CV', '#237346'], tsv: ['CV', '#237346'],
  png: ['IM', '#8E5BB5'], jpg: ['IM', '#8E5BB5'], jpeg: ['IM', '#8E5BB5'], gif: ['IM', '#8E5BB5'], webp: ['IM', '#8E5BB5'],
  ico: ['IM', '#8E5BB5'], bmp: ['IM', '#8E5BB5'], avif: ['IM', '#8E5BB5'],
  mp4: ['VD', '#8E5BB5'], mov: ['VD', '#8E5BB5'], webm: ['VD', '#8E5BB5'], mp3: ['AU', '#8E5BB5'], wav: ['AU', '#8E5BB5'],
  ogg: ['AU', '#8E5BB5'], flac: ['AU', '#8E5BB5'], pdf: ['PD', '#E5252A'],
  lock: LOCK, log: ['LG', '#6B7280'], zip: ['ZP', '#6B7280'], gz: ['ZP', '#6B7280'], tar: ['ZP', '#6B7280'], tgz: ['ZP', '#6B7280'],
}

export const BADGE_BY_NAME: Readonly<Record<string, Spec>> = {
  'package.json': ['{}', '#CB3837'], 'tsconfig.json': ['{}', '#3178C6'],
  'package-lock.json': LOCK, 'yarn.lock': LOCK, 'pnpm-lock.yaml': LOCK, 'bun.lock': LOCK, 'bun.lockb': LOCK,
  dockerfile: DOCKER, 'docker-compose.yml': DOCKER, 'docker-compose.yaml': DOCKER, 'compose.yml': DOCKER, 'compose.yaml': DOCKER,
  makefile: ['MK', '#6D8086'], license: LICENSE, 'license.md': LICENSE, 'license.txt': LICENSE,
  '.gitignore': GIT, '.gitattributes': GIT, '.gitmodules': GIT,
  '.editorconfig': CONFIG, '.prettierrc': CONFIG, '.npmrc': CONFIG, '.nvmrc': CONFIG,
  'claude.md': ['CL', '#D97757'],
}

/**
 * The badge for a file name: special names first, then the extension. An extension canopy
 * doesn't know shows its first two letters on gray; a name with none, a blank tile.
 */
export function iconFor(name: string): FileIcon {
  const lower = name.toLowerCase()
  const spec = own(BADGE_BY_NAME, lower) ?? (lower.startsWith('.env') ? BADGE_BY_EXT['env'] : undefined) ?? byExt(lower)
  return { label: spec[0], bg: spec[1], fg: spec[2] ?? textOn(spec[1]) }
}

function byExt(lower: string): Spec {
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return ['  ', PLAIN_TILE]
  const ext = lower.slice(dot + 1)
  const known = own(BADGE_BY_EXT, ext)
  if (known) return known
  // Only letters and digits make a label: anything else could be wide or unprintable.
  return /^[a-z0-9]+$/.test(ext) ? [ext.slice(0, 2).toUpperCase().padEnd(2), UNKNOWN_TILE] : ['  ', PLAIN_TILE]
}

/** White on a tile dark enough for it (3:1, as for bold text), else near-black. */
export function textOn(bg: string): string {
  return contrast('#FFFFFF', bg) >= 3 ? '#FFFFFF' : '#1A1A1A'
}

/** WCAG contrast ratio of two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
