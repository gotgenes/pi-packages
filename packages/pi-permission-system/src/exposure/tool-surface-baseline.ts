/** What a turn observed about pi's tool surface. */
export interface ToolSurfaceObservation {
  /** Names pi reports active right now (`pi.getActiveTools()`). */
  readonly active: readonly string[];
  /** Names pi currently has registered (`pi.getAllTools()`). */
  readonly registered: ReadonlySet<string>;
}

/** The effective tool surface for one turn, and what changed to produce it. */
export interface ToolSurfaceResolution {
  /** Names to hand to `setActive`, in baseline order. */
  readonly exposed: readonly string[];
  /** Baseline members the current policy withholds. */
  readonly withheld: readonly string[];
  /** Names withheld on an earlier turn that the current policy exposes again. */
  readonly restored: readonly string[];
  /** Whether the withheld set differs from the previous turn's. */
  readonly changed: boolean;
}

/** Decides whether the current policy lets the agent see a tool. */
type ToolExposurePolicy = (toolName: string) => boolean;

/**
 * The runtime tool surface a session has, independent of what policy withholds.
 *
 * Filtering writes its result back through `setActive`, so reading the active
 * set again next turn returns the *filtered* set. Applying policy to that makes
 * the surface monotonically shrink and leaves a tool stranded once its rule is
 * relaxed (#873). This baseline is the stable input policy is applied to
 * instead: `exposed = baseline ∩ policy`, recomputed every turn.
 *
 * The baseline only ever grows from tools observed **active**, never from the
 * whole registry, so a tool pi deliberately left inactive is never activated
 * (#385). A tool that stops being active without this extension withholding it
 * — another extension deactivating it — leaves the baseline with it.
 */
export class ToolSurfaceBaseline {
  private baseline: readonly string[] = [];
  private withheld: ReadonlySet<string> = new Set();

  resolveExposed(
    observation: ToolSurfaceObservation,
    isExposed: ToolExposurePolicy,
  ): ToolSurfaceResolution {
    const baseline = this.rebuild(observation);
    const exposed: string[] = [];
    const withheld: string[] = [];
    for (const toolName of baseline) {
      (isExposed(toolName) ? exposed : withheld).push(toolName);
    }
    const restored = exposed.filter((toolName) => this.withheld.has(toolName));
    const changed = !holdsExactly(this.withheld, withheld);

    this.baseline = baseline;
    this.withheld = new Set(withheld);
    return { exposed, withheld, restored, changed };
  }

  /** Forget the surface, so the next turn reseeds from what pi reports. */
  reset(): void {
    this.baseline = [];
    this.withheld = new Set();
  }

  /**
   * Reconstruct the pre-filter surface: the tools still active, plus the ones
   * only this extension's own filtering removed, plus anything newly active.
   *
   * A withheld tool that has left the registry is forgotten rather than kept as
   * a restoration candidate, so re-registering it inactive cannot activate it.
   * The registry is consulted for withheld tools only — an active tool is real
   * by definition — and an active tool is adopted whatever the registry says,
   * so a registry that reports nothing can cost restoration candidates but
   * never removes a tool pi has active.
   */
  private rebuild(observation: ToolSurfaceObservation): readonly string[] {
    const active = new Set(observation.active);
    const baseline = this.baseline.filter(
      (toolName) =>
        active.has(toolName) ||
        (this.withheld.has(toolName) && observation.registered.has(toolName)),
    );

    const known = new Set(baseline);
    for (const toolName of observation.active) {
      if (!known.has(toolName)) {
        known.add(toolName);
        baseline.push(toolName);
      }
    }
    return baseline;
  }
}

function holdsExactly(
  set: ReadonlySet<string>,
  members: readonly string[],
): boolean {
  return set.size === members.length && members.every((m) => set.has(m));
}
