// Persistence for pi-subagents operational settings.
// - Global:  ~/.pi/agent/subagents.json (agentDir injected at construction) — manual defaults, never written here
// - Project: <cwd>/.pi/subagents.json — written by /agents → Settings; overrides global on load

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type LayeredSettingsSource, loadLayeredSettings } from "#src/layered-settings";
export interface SubagentsSettings {
  maxConcurrent?: number;
  /**
   * 0 = unlimited — the extension's single source of truth for that convention:
   * `normalizeMaxTurns()` in turn-limits.ts treats 0 → `undefined`, and the
   * `/agents` → Settings input prompt explicitly says "0 = unlimited".
   */
  defaultMaxTurns?: number;
  graceTurns?: number;
  /** Minutes a consumed agent's session is retained after its last relevance event. */
  consumedSessionRetentionMinutes?: number;
  /** Minutes an unconsumed agent's session is retained (safety cap). */
  unconsumedSessionRetentionMinutes?: number;
  /**
   * When false, a parent interrupt (ESC) leaves background and queued subagents
   * running. Foreground agents hold the parent's run signal directly, so they
   * abort on ESC either way.
   */
  abortAllOnInterrupt?: boolean;
  /**
   * When false, a background child is not given the `notify_parent` tool, so it
   * cannot interrupt the parent with a mid-run finding. Ask-back is unaffected.
   */
  midRunUpdates?: boolean;
  /**
   * Pi package sources whose extensions child sessions must not load, matched
   * against Pi's configured source string exactly (e.g. `npm:@scope/pkg`).
   * The package's skills, prompts, and themes stay available to children.
   */
  excludedExtensionPackages?: string[];
  /**
   * Default prompt inheritance for agents whose frontmatter is silent.
   * Either the simple global default (`"full"` | `"portable"`) or a scoped
   * rule object — see `PromptInheritanceRules`. Frontmatter `inherit_prompt`
   * wins over both.
   */
  promptInheritance?: PromptInheritance | PromptInheritanceRules;
}

/** The two prompt-inheritance strategies, as settable in subagents.json. */
export type PromptInheritance = "full" | "portable";

/**
 * Scoped prompt-inheritance rules.
 *
 * `providers` keys the provider id of the child's resolved model (e.g.
 * `claude-bridge`) to the strategy that child should use; `default` applies to
 * every provider not listed. Scoping matters because the strategies' costs are
 * asymmetric by provider: `"full"` keeps a byte-identical cache prefix with
 * the parent, worthless once the child's requests leave through another
 * harness, while `"portable"` drops the harness base prompt, which a re-homing
 * host may reject, and costs the shared prefix when parent and child share the
 * raw API.
 */
export interface PromptInheritanceRules {
  /** Strategy for providers not named in `providers`. Default `"full"`. */
  default?: PromptInheritance;
  /** Per-provider strategy, keyed by provider id of the child's model. */
  providers?: Record<string, PromptInheritance>;
}

/** Normalized form the runtime consumes. */
export interface PromptInheritanceConfig {
  def: PromptInheritance;
  providers: Record<string, PromptInheritance>;
}

/** Parse the settings union into the normalized form. Unknown values → defaults. */
export function normalizePromptInheritance(
  value: PromptInheritance | PromptInheritanceRules | undefined,
): PromptInheritanceConfig {
  if (value === "portable" || value === "full") return { def: value, providers: {} };
  if (value && typeof value === "object") {
    const providers: Record<string, PromptInheritance> = {};
    for (const [provider, strategy] of Object.entries(value.providers ?? {})) {
      if (isPromptInheritance(strategy)) providers[provider] = strategy;
    }
    return {
      def: isPromptInheritance(value.default) ? value.default : DEFAULT_PROMPT_INHERITANCE,
      providers,
    };
  }
  return { def: DEFAULT_PROMPT_INHERITANCE, providers: {} };
}

/**
 * Runtime guard for the strategy enums. Settings arrive from JSON, where the
 * declared types are aspirations — every comparison site funnels through here
 * so narrowing never convinces a linter the check is dead.
 */
function isPromptInheritance(value: unknown): value is PromptInheritance {
  return value === "full" || value === "portable";
}

/**
 * Sanitize the promptInheritance union onto `out`: the enum passes through, a
 * rule object keeps only valid strategies and drops the rest, anything else
 * leaves the field absent. Assigns inside so `sanitize` gains no branches —
 * the audit gate re-scores every function a changed file touches.
 */
function applyPromptInheritance(out: SubagentsSettings, value: unknown): void {
  if (isPromptInheritance(value)) {
    out.promptInheritance = value;
    return;
  }
  if (!value || typeof value !== "object") return;
  const raw = value as { default?: unknown; providers?: unknown };
  const rules: PromptInheritanceRules = {};
  if (isPromptInheritance(raw.default)) rules.default = raw.default;
  const providers = sanitizePromptInheritanceProviders(raw.providers);
  if (providers) rules.providers = providers;
  if (rules.default !== undefined || rules.providers !== undefined) {
    out.promptInheritance = rules;
  }
}

/** Keep only provider entries whose strategy is a known enum, absent when none survive. */
function sanitizePromptInheritanceProviders(
  raw: unknown,
): Record<string, PromptInheritance> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const providers: Record<string, PromptInheritance> = {};
  for (const [provider, strategy] of Object.entries(raw)) {
    if (isPromptInheritance(strategy)) providers[provider] = strategy;
  }
  return Object.keys(providers).length > 0 ? providers : undefined;
}

/**
 * The persisted form of the in-memory settings values.
 * `saveSettings` rewrites the whole project file from this shape, so every key
 * that must survive a `/subagents:settings` edit has to appear here.
 */
export interface SettingsSnapshot {
  maxConcurrent: number;
  defaultMaxTurns: number;
  graceTurns: number;
  consumedSessionRetentionMinutes: number;
  unconsumedSessionRetentionMinutes: number;
  abortAllOnInterrupt: boolean;
  midRunUpdates: boolean;
  /**
   * Present only when non-empty, so files that never set it gain no noise.
   * It must round-trip: the key has no `/subagents:settings` affordance, so a
   * hand-edited value would otherwise be erased by any unrelated setting change.
   */
  excludedExtensionPackages?: string[];
  /** Present only when non-default (either form), so files that never set it gain no noise. */
  promptInheritance?: PromptInheritance | PromptInheritanceRules;
}


/** Emit callback — a subset of `pi.events.emit` to keep helpers testable. */
export type SettingsEmit = (event: string, payload: unknown) => void;

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_GRACE_TURNS = 5;
const DEFAULT_CONSUMED_RETENTION_MINUTES = 10;
const DEFAULT_UNCONSUMED_RETENTION_MINUTES = 720;
const DEFAULT_ABORT_ALL_ON_INTERRUPT = true;
const DEFAULT_MID_RUN_UPDATES = true;
const DEFAULT_PROMPT_INHERITANCE: PromptInheritance = "full";

/**
 * Owns all three in-memory settings values and their load/save/persist cycle.
 * Replaces the scattered free-function + SettingsAppliers callback pattern.
 */
export class SettingsManager {
  private _defaultMaxTurns: number | undefined = undefined;
  private _graceTurns: number = DEFAULT_GRACE_TURNS;
  private _maxConcurrent: number = DEFAULT_MAX_CONCURRENT;
  private _consumedSessionRetentionMinutes: number = DEFAULT_CONSUMED_RETENTION_MINUTES;
  private _unconsumedSessionRetentionMinutes: number = DEFAULT_UNCONSUMED_RETENTION_MINUTES;
  private _abortAllOnInterrupt: boolean = DEFAULT_ABORT_ALL_ON_INTERRUPT;
  private _midRunUpdates: boolean = DEFAULT_MID_RUN_UPDATES;
  private _promptInheritance: PromptInheritanceConfig = normalizePromptInheritance(undefined);
  private _promptInheritanceRaw: SubagentsSettings["promptInheritance"] = undefined;
  private _excludedExtensionPackages: string[] = [];

  private readonly emit: SettingsEmit;
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly onMaxConcurrentChanged: (() => void) | undefined;

  constructor(deps: { emit: SettingsEmit; cwd: string; agentDir: string; onMaxConcurrentChanged?: () => void }) {
    this.emit = deps.emit;
    this.cwd = deps.cwd;
    this.agentDir = deps.agentDir;
    this.onMaxConcurrentChanged = deps.onMaxConcurrentChanged;
  }

  // ── defaultMaxTurns: 0 or undefined → unlimited (undefined); else max(1, n) ──

  get defaultMaxTurns(): number | undefined {
    return this._defaultMaxTurns;
  }

  set defaultMaxTurns(n: number | undefined) {
    if (n == null || n === 0) {
      this._defaultMaxTurns = undefined;
    } else {
      this._defaultMaxTurns = Math.max(1, n);
    }
  }

  // ── graceTurns: minimum 1 ──

  get graceTurns(): number {
    return this._graceTurns;
  }

  set graceTurns(n: number) {
    this._graceTurns = Math.max(1, n);
  }

  // ── maxConcurrent: minimum 1 ──

  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  set maxConcurrent(n: number) {
    this._maxConcurrent = Math.max(1, n);
  }

  // ── retention windows: clamped to [1, RETENTION_MINUTES_CEILING] minutes ──

  get consumedSessionRetentionMinutes(): number {
    return this._consumedSessionRetentionMinutes;
  }

  set consumedSessionRetentionMinutes(n: number) {
    this._consumedSessionRetentionMinutes = clampRetentionMinutes(n);
  }

  get unconsumedSessionRetentionMinutes(): number {
    return this._unconsumedSessionRetentionMinutes;
  }

  set unconsumedSessionRetentionMinutes(n: number) {
    this._unconsumedSessionRetentionMinutes = clampRetentionMinutes(n);
  }

  // ── abortAllOnInterrupt: flipped via toggleAbortAllOnInterrupt(); no normalization ──

  get abortAllOnInterrupt(): boolean {
    return this._abortAllOnInterrupt;
  }

  // ── excludedExtensionPackages: hand-edited only; no /subagents:settings affordance ──

  get excludedExtensionPackages(): readonly string[] {
    return this._excludedExtensionPackages;
  }

  // ── Lifecycle methods ──

  /**
   * Load merged settings (global + project), apply to in-memory values,
   * and emit the `subagents:settings_loaded` lifecycle event.
   * Returns the raw loaded settings object.
   */
  load(): SubagentsSettings {
    const settings = loadSettings(this.agentDir, this.cwd);
    if (typeof settings.maxConcurrent === "number") this.maxConcurrent = settings.maxConcurrent;
    if (typeof settings.defaultMaxTurns === "number") this.defaultMaxTurns = settings.defaultMaxTurns;
    if (typeof settings.graceTurns === "number") this.graceTurns = settings.graceTurns;
    if (typeof settings.consumedSessionRetentionMinutes === "number")
      this.consumedSessionRetentionMinutes = settings.consumedSessionRetentionMinutes;
    if (typeof settings.unconsumedSessionRetentionMinutes === "number")
      this.unconsumedSessionRetentionMinutes = settings.unconsumedSessionRetentionMinutes;
    if (typeof settings.abortAllOnInterrupt === "boolean")
      this._abortAllOnInterrupt = settings.abortAllOnInterrupt;
    if (typeof settings.midRunUpdates === "boolean") this._midRunUpdates = settings.midRunUpdates;
    this._promptInheritance = normalizePromptInheritance(settings.promptInheritance);
    this._promptInheritanceRaw = settings.promptInheritance;
    // Assigned unconditionally: removing the key from disk must clear the value.
    this._excludedExtensionPackages = [...(settings.excludedExtensionPackages ?? [])];
    this.emit("subagents:settings_loaded", { settings });
    return settings;
  }

  /**
   * Snapshot current in-memory values for persistence.
   * `defaultMaxTurns` uses 0 as the on-disk marker for unlimited (undefined).
   */
  snapshot(): SettingsSnapshot {
    const snapshot: SettingsSnapshot = {
      maxConcurrent: this._maxConcurrent,
      defaultMaxTurns: this._defaultMaxTurns ?? 0,
      graceTurns: this._graceTurns,
      consumedSessionRetentionMinutes: this._consumedSessionRetentionMinutes,
      unconsumedSessionRetentionMinutes: this._unconsumedSessionRetentionMinutes,
      abortAllOnInterrupt: this._abortAllOnInterrupt,
      midRunUpdates: this._midRunUpdates,
    };
    if (this._promptInheritanceRaw !== undefined) {
      snapshot.promptInheritance = this._promptInheritanceRaw;
    } else if (
      this._promptInheritance.def !== DEFAULT_PROMPT_INHERITANCE ||
      Object.keys(this._promptInheritance.providers).length > 0
    ) {
      const { def, providers } = this._promptInheritance;
      snapshot.promptInheritance = {
        ...(def !== DEFAULT_PROMPT_INHERITANCE ? { default: def } : {}),
        ...(Object.keys(providers).length > 0 ? { providers: { ...providers } } : {}),
      };
    }
    if (this._excludedExtensionPackages.length > 0) {
      snapshot.excludedExtensionPackages = [...this._excludedExtensionPackages];
    }
    return snapshot;
  }

  /**
   * Set maxConcurrent, notify interested parties, persist, and return the toast.
   * Owns the full consequence chain so callers just say what they want.
   */
  applyMaxConcurrent(n: number): { message: string; level: "info" | "warning" } {
    this.maxConcurrent = n; // setter normalizes: max(1, n)
    this.onMaxConcurrentChanged?.();
    return this.saveAndNotify(`Max concurrency set to ${this.maxConcurrent}`);
  }

  /**
   * Set defaultMaxTurns, persist, and return the toast.
   * Pass 0 for unlimited (maps to undefined internally).
   */
  applyDefaultMaxTurns(n: number): { message: string; level: "info" | "warning" } {
    this.defaultMaxTurns = n === 0 ? undefined : n; // setter normalizes further
    const label = this.defaultMaxTurns == null ? "unlimited" : String(this.defaultMaxTurns);
    return this.saveAndNotify(`Default max turns set to ${label}`);
  }

  /**
   * Set graceTurns, persist, and return the toast.
   */
  applyGraceTurns(n: number): { message: string; level: "info" | "warning" } {
    this.graceTurns = n; // setter normalizes: max(1, n)
    return this.saveAndNotify(`Grace turns set to ${this.graceTurns}`);
  }

  /** Set the consumed-session retention window (minutes), persist, and return the toast. */
  applyConsumedSessionRetentionMinutes(n: number): { message: string; level: "info" | "warning" } {
    this.consumedSessionRetentionMinutes = n; // setter normalizes: clamp [1, ceiling]
    return this.saveAndNotify(`Consumed-session retention set to ${this.consumedSessionRetentionMinutes} min`);
  }

  /** Set the unconsumed-session retention window (minutes), persist, and return the toast. */
  applyUnconsumedSessionRetentionMinutes(n: number): { message: string; level: "info" | "warning" } {
    this.unconsumedSessionRetentionMinutes = n; // setter normalizes: clamp [1, ceiling]
    return this.saveAndNotify(`Unconsumed-session retention set to ${this.unconsumedSessionRetentionMinutes} min`);
  }

  /**
   * Flip whether a parent interrupt (ESC) aborts every subagent, persist, and
   * return the toast. The manager owns the negation so callers just say "flip it".
   */
  toggleAbortAllOnInterrupt(): { message: string; level: "info" | "warning" } {
    this._abortAllOnInterrupt = !this._abortAllOnInterrupt;
    return this.saveAndNotify(
      `Abort all subagents on ESC: ${this._abortAllOnInterrupt ? "on" : "off"}`,
    );
  }

  get midRunUpdates(): boolean {
    return this._midRunUpdates;
  }

  /** Default prompt inheritance for agents without an explicit `inherit_prompt`. */
  get promptInheritance(): PromptInheritance {
    return this._promptInheritance.def;
  }

  /** Per-provider inheritance overrides, keyed by provider id of the child's model. */
  get promptInheritanceProviders(): Record<string, PromptInheritance> {
    return this._promptInheritance.providers;
  }

  /**
   * Flip whether a background child may interrupt the parent with a mid-run
   * update, persist, and return the toast.
   */
  toggleMidRunUpdates(): { message: string; level: "info" | "warning" } {
    this._midRunUpdates = !this._midRunUpdates;
    return this.saveAndNotify(
      `Mid-run updates from background subagents: ${this._midRunUpdates ? "on" : "off"}`,
    );
  }

  /**
   * Persist the current snapshot, emit `subagents:settings_changed`,
   * and return the toast the UI should display.
   */
  saveAndNotify(successMsg: string): { message: string; level: "info" | "warning" } {
    const snap = this.snapshot();
    const persisted = saveSettings(snap, this.cwd);
    this.emit("subagents:settings_changed", { settings: snap, persisted });
    return persistToastFor(successMsg, persisted);
  }
}

// Sanity ceilings — prevent hand-edited configs from asking for values that
// make no operational sense (e.g. 1e6 concurrent subagents). Permissive enough
// that any realistic power-user setting passes through.
const MAX_CONCURRENT_CEILING = 1024;
const MAX_TURNS_CEILING = 10_000;
const GRACE_TURNS_CEILING = 1_000;
// Retention windows: 1 minute floor, two-week ceiling (60 * 24 * 14).
const RETENTION_MINUTES_CEILING = 20_160;

/** Clamp a retention window to [1, RETENTION_MINUTES_CEILING] minutes. */
function clampRetentionMinutes(n: number): number {
  return Math.min(RETENTION_MINUTES_CEILING, Math.max(1, n));
}

/** True when a value is an integer minute count within the accepted retention range. */
function isRetentionMinutes(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= RETENTION_MINUTES_CEILING;
}

/** Drop fields that don't match the expected shape. Silent — garbage becomes absent. */
function sanitize(raw: unknown): SubagentsSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: SubagentsSettings = {};
  sanitizeTuningFields(out, r);
  if (isRetentionMinutes(r.consumedSessionRetentionMinutes)) {
    out.consumedSessionRetentionMinutes = r.consumedSessionRetentionMinutes;
  }
  if (isRetentionMinutes(r.unconsumedSessionRetentionMinutes)) {
    out.unconsumedSessionRetentionMinutes = r.unconsumedSessionRetentionMinutes;
  }
  if (typeof r.abortAllOnInterrupt === "boolean") {
    out.abortAllOnInterrupt = r.abortAllOnInterrupt;
  }
  if (typeof r.midRunUpdates === "boolean") {
    out.midRunUpdates = r.midRunUpdates;
  }
  applyPromptInheritance(out, r.promptInheritance);
  if (Array.isArray(r.excludedExtensionPackages)) {
    const sources = r.excludedExtensionPackages
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    out.excludedExtensionPackages = [...new Set(sources)];
  }
  return out;
}

/**
 * Sanitize the concurrency and turn-limit tuning fields into `out`.
 * Extracted from `sanitize` so the dispatcher stays under the complexity
 * thresholds the audit gate enforces on changed files.
 */
function sanitizeTuningFields(out: SubagentsSettings, r: Record<string, unknown>): void {
  if (isBoundedInt(r.maxConcurrent, 1, MAX_CONCURRENT_CEILING)) {
    out.maxConcurrent = r.maxConcurrent;
  }
  if (isBoundedInt(r.defaultMaxTurns, 0, MAX_TURNS_CEILING)) {
    out.defaultMaxTurns = r.defaultMaxTurns;
  }
  if (isBoundedInt(r.graceTurns, 1, GRACE_TURNS_CEILING)) {
    out.graceTurns = r.graceTurns;
  }
}

/** Integer within [min, max] — the shape every tuning-field check shares. */
function isBoundedInt(n: unknown, min: number, max: number): n is number {
  return Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
}

function projectPath(cwd: string): string {
  return join(cwd, ".pi", "subagents.json");
}

/** Load merged settings: global provides defaults, project overrides. */
export function loadSettings(agentDir: string, cwd: string): SubagentsSettings {
  return loadLayeredSettings({
    agentDir,
    cwd,
    filename: "subagents.json",
    sanitize,
    warnLabel: "pi-subagents",
  } satisfies LayeredSettingsSource<SubagentsSettings>);
}

/**
 * Write project-local settings. Global is never touched from code.
 * Returns `true` on success, `false` if the write (or mkdir) failed so the
 * caller can surface a warning — persistence isn't fatal but isn't silent.
 */
export function saveSettings(s: SubagentsSettings, cwd: string = process.cwd()): boolean {
  const path = projectPath(cwd);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(s, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Format the user-facing toast for a settings mutation. Pure function —
 * routes the success/failure of `saveSettings` into the right message + level
 * so the UI layer (index.ts) stays a thin wire between input and notification.
 */
export function persistToastFor(
  successMsg: string,
  persisted: boolean,
): { message: string; level: "info" | "warning" } {
  return persisted
    ? { message: successMsg, level: "info" }
    : { message: `${successMsg} (session only; failed to persist)`, level: "warning" };
}
