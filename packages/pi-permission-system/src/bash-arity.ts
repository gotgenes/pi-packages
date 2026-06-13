/**
 * Curated arity dictionary for common CLI commands.
 *
 * Keys are lowercase, space-joined command prefixes.
 * Values are the total token count that defines the "human-understandable
 * subcommand" — i.e. how many tokens to include in a session-approval pattern.
 *
 * Multi-level entries (e.g. "npm run": 3) take precedence over shorter entries
 * ("npm": 2) because `prefix()` uses longest-match-wins.
 *
 * Exported for testability.
 */
export const ARITY: Record<string, number> = {
  // Version control
  git: 2,
  hg: 2,
  svn: 2,

  // Node.js package managers
  npm: 2,
  "npm run": 3,
  "npm exec": 3,
  npx: 2,
  pnpm: 2,
  "pnpm run": 3,
  "pnpm exec": 3,
  "pnpm dlx": 3,
  yarn: 2,
  "yarn run": 3,
  bun: 2,
  "bun run": 3,
  "bun add": 2,
  "bun x": 3,

  // Runtimes
  deno: 2,
  "deno run": 3,
  "deno task": 3,
  "deno compile": 3,

  // Python
  pip: 2,
  pip3: 2,
  uv: 2,
  "uv run": 3,
  "uv pip": 3,

  // Rust
  cargo: 2,

  // Go
  go: 2,
  "go run": 3,

  // Ruby
  bundle: 2,
  "bundle exec": 3,

  // Docker / container
  docker: 2,
  "docker compose": 3,
  "docker container": 3,
  "docker image": 3,
  "docker network": 3,
  "docker volume": 3,
  podman: 2,
  "podman compose": 3,

  // Kubernetes
  kubectl: 2,
  helm: 2,

  // Cloud CLIs
  aws: 3,
  az: 3,
  gcloud: 3,
  gh: 2,
  "gh pr": 3,
  "gh issue": 3,
  "gh repo": 3,
  fly: 2,
  vercel: 2,
  wrangler: 2,

  // Build tools
  make: 1,
  bazel: 2,

  // Infrastructure
  terraform: 2,
  tofu: 2,
  pulumi: 2,

  // System service management
  systemctl: 2,
  service: 2,

  // Shell file-ops — args are paths/targets, not subcommands
  ls: 1,
  ll: 1,
  la: 1,
  cat: 1,
  less: 1,
  more: 1,
  head: 1,
  tail: 1,
  grep: 1,
  rg: 1,
  ag: 1,
  find: 1,
  touch: 1,
  mkdir: 1,
  rm: 1,
  cp: 1,
  mv: 1,
  ln: 1,
  chmod: 1,
  chown: 1,
  du: 1,
  df: 1,
  echo: 1,
  printf: 1,
  diff: 1,
  patch: 1,
  wc: 1,
  sort: 1,
  uniq: 1,
  awk: 1,
  sed: 1,
  tar: 1,
  zip: 1,
  unzip: 1,

  // Network
  curl: 1,
  wget: 1,
  ssh: 1,
  scp: 1,
  rsync: 1,
  ping: 1,

  // Process management
  kill: 1,
  killall: 1,
  pkill: 1,

  // Package managers (system)
  brew: 2,
  apt: 2,
  "apt-get": 2,
  yum: 2,
  dnf: 2,
};

/**
 * Return the semantically meaningful prefix tokens for a tokenized command.
 *
 * Performs a longest-match-wins lookup against the `ARITY` dictionary:
 * iterates from the longest possible prefix down to a single token, returning
 * the first (longest) match. Lookup is case-insensitive; the returned tokens
 * preserve their original casing.
 *
 * When no entry matches, defaults to arity 1 (first token only).
 * When the resolved arity exceeds the available tokens, it is clamped.
 *
 * @param tokens - The command split by whitespace (e.g. `["git", "checkout", "main"]`).
 * @returns The prefix tokens defining the meaningful subcommand.
 */
export function prefix(tokens: string[]): string[] {
  if (tokens.length === 0) return [];

  for (let n = tokens.length; n >= 1; n--) {
    const key = tokens
      .slice(0, n)
      .map((t) => t.toLowerCase())
      .join(" ");
    const arity = ARITY[key];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ARITY record type hides that a key may be absent at runtime
    if (arity !== undefined) {
      return tokens.slice(0, Math.min(arity, tokens.length));
    }
  }

  // Unknown command — default arity 1.
  return [tokens[0]];
}

/**
 * Remove shell comment lines from a bash command string.
 *
 * A comment line is one whose first non-whitespace character is `#`. Agents
 * frequently prepend descriptive comments before the real command
 * (e.g. `"# Check debug logs\nfind ..."`); such prefixes defeat wildcard
 * pattern matching and session-approval suggestions, which tokenize the
 * leading text. Stripping comment lines lets matching operate on the actual
 * command.
 *
 * The original command is never returned: when every line is a comment (or
 * the input is blank) an empty string is returned, and each caller applies
 * its own fallback.
 *
 * @param command - Raw bash command, possibly multi-line.
 * @returns The command with comment lines removed and surrounding whitespace
 *   trimmed, or an empty string when nothing meaningful remains.
 */
export function stripBashCommentLines(command: string): string {
  const lines = command.split("\n");
  const meaningful = lines.filter((line) => !/^\s*#/.test(line));
  return meaningful.join("\n").trim();
}
