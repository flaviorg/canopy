// canopy's file-type swatches: one colored glyph before each file name, so a glance tells
// TypeScript from Markdown from config. Pure data, no mods API.

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
  const special = BY_NAME[lower]
  if (special) return special
  if (lower.startsWith('.env')) return BY_NAME['.env']!
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return DEFAULT
  const color = BY_EXT[lower.slice(dot + 1)]
  return color ? { glyph: '▪', color } : DEFAULT
}
