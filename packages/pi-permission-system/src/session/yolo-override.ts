/**
 * yolo-override.ts — the `/yolo` command's session-scoped yolo state.
 *
 * `yoloMode` in the config is the persistent setting; this is the transient
 * layer above it, so an operator can loosen (or tighten) a session without
 * writing config that outlives it. The override is `null` until `/yolo` runs in
 * this session, which is what makes "the config answers" and "a command
 * answered" distinguishable in the status bar and in the command's own report.
 *
 * One instance per extension factory: Pi caches extension imports per cwd
 * (pi#5905), so module-level state would survive a session switch inside one
 * process and a new session would inherit the previous session's override.
 *
 * The class answers only the *effective* yolo state — it never writes config
 * and never talks to the UI. The composition root composes it with the config
 * reader into the single `isYoloEnabled` reader that `PermissionManager` and
 * the gate runner both consume, so no caller can read the config directly and
 * miss the override.
 */
export class SessionYoloOverride {
  /** `null` when no `/yolo` command has run in this session. */
  private override: boolean | null = null;

  /**
   * The effective yolo state: this session's override when it has one,
   * otherwise whatever the config says.
   */
  resolve(configEnabled: boolean): boolean {
    return this.override ?? configEnabled;
  }

  /** Pin the effective state for this session, or hand it back to the config. */
  set(active: boolean | null): void {
    this.override = active;
  }

  /** Flip the effective state and return it. */
  toggle(configEnabled: boolean): boolean {
    const next = !this.resolve(configEnabled);
    this.override = next;
    return next;
  }
}
