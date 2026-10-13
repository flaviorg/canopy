// canopy's contract: the $.state values its pane is drawn from. They survive a hot reload;
// /clear, /resume and /branch reset them, and canopy rescans the tree.
// Types only. The shapes match Mark/Marks in hooks/activity.ts and Badge/GitState in
// hooks/git.ts; the names carry a Canopy prefix because every mod's contract merges into
// the same 'claude-code' module.

declare module 'claude-code' {
  /**
   * What Claude last did to a file, how often it read and wrote it this session, and its
   * latest write or commit (which a later read leaves in place).
   */
  type CanopyMark = { kind: 'read' | 'write' | 'commit'; at: number; reads: number; writes: number; change?: 'write' | 'commit' }

  /** Marks by path relative to the project root. */
  type CanopyMarks = Record<string, CanopyMark>

  /** A git status letter: modified, added, deleted, renamed, untracked. */
  type CanopyBadge = 'M' | 'A' | 'D' | 'R' | 'U'

  /** The branch (null outside a repository) and each changed path's badge. */
  type CanopyGitState = { branch: string | null; files: Record<string, CanopyBadge> }

  interface PluginState {
    canopy: {
      marks: CanopyMarks
      git: CanopyGitState
      /** Folders the person opened. */
      expanded: string[]
      /** Folders the person closed, kept closed even while Claude works inside. */
      collapsed: string[]
    }
  }
}
