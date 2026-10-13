// canopy's file-type swatches: one colored glyph before each file name, so a glance tells
// TypeScript from Markdown from config. Pure data, no mods API.

export type Swatch = { glyph: string; color: string }

const DEFAULT: Swatch = { glyph: '▪', color: 'subtle' }

// Extension → color. Colors follow each language's widely used brand color.
const BY_EXT: Record<string, string> = {
  ts: '#3178C6', tsx: '#3178C6', mts: '#3178C6', cts: '#3178C6',
  js: '#F1E05A', jsx: '#F1E05A', mjs: '#F1E05A', cjs: '#F1E05A',
  json: '#CBA135', jsonc: '#CBA135', json5: '#CBA135',
  md: '#7D9DB8', mdx: '#7D9DB8', txt: '#9A9A9A', rst: '#9A9A9A',
  css: '#A56EDC', scss: '#C6538C', sass: '#C6538C', less: '#4C73B6',
  html: '#E34C26', htm: '#E34C26', vue: '#41B883', svelte: '#FF3E00', astro: '#FF5D01',
  py: '#3572A5', ipynb: '#DA5B0B', rb: '#CC342D', go: '#00ADD8', rs: '#DEA584',
  java: '#B07219', kt: '#A97BFF', kts: '#A97BFF', swift: '#F05138', dart: '#00B4AB',
  c: '#8E8E8E', h: '#8E8E8E', cpp: '#F34B7D', hpp: '#F34B7D', cs: '#178600',
  php: '#4F5D95', lua: '#5E7CE2', ex: '#6E4A7E', exs: '#6E4A7E', zig: '#EC915C',
  sh: '#89E051', bash: '#89E051', zsh: '#89E051', fish: '#89E051', ps1: '#5391FE',
  yml: '#CB4B4B', yaml: '#CB4B4B', toml: '#9C4221', ini: '#9C4221', env: '#E5C07B',
  sql: '#E38C00', prisma: '#5A67D8', graphql: '#E10098', gql: '#E10098', proto: '#7A9A4A',
  png: '#B48EAD', jpg: '#B48EAD', jpeg: '#B48EAD', gif: '#B48EAD', svg: '#FFB13B', webp: '#B48EAD', ico: '#B48EAD',
  mp4: '#B48EAD', mov: '#B48EAD', mp3: '#B48EAD', wav: '#B48EAD', pdf: '#E5534B',
  lock: '#6E6E6E', log: '#6E6E6E',
}

// Whole names that mean more than their extension.
const BY_NAME: Record<string, Swatch> = {
  'package.json': { glyph: '◆', color: '#CB3837' },
  'tsconfig.json': { glyph: '◆', color: '#3178C6' },
  dockerfile: { glyph: '◆', color: '#2496ED' },
  'docker-compose.yml': { glyph: '◆', color: '#2496ED' },
  makefile: { glyph: '◆', color: '#6D8086' },
  'readme.md': { glyph: '◆', color: '#7D9DB8' },
  license: { glyph: '◆', color: '#D4AA00' },
  '.gitignore': { glyph: '▪', color: '#F05032' },
  '.env': { glyph: '▪', color: '#E5C07B' },
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
