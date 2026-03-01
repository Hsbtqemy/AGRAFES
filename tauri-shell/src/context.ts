/**
 * context.ts — ShellContext interface
 *
 * Minimal contract passed from the shell to each module wrapper.
 * Modules read/write DB path exclusively through this interface when
 * running inside the shell, keeping them decoupled from shell internals.
 */

export interface ShellContext {
  /** Return the currently active DB path, or null if none selected. */
  getDbPath(): string | null;

  /**
   * Subscribe to DB path changes made by the shell (e.g. via "Changer…").
   * Returns an unsubscribe function to be called on dispose.
   */
  onDbChange(cb: (path: string | null) => void): () => void;
}
