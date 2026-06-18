// Helpers for layering third-party pi extensions onto little-coder's bundled
// set. Extracted from the launcher so the parsing rules — path-delimited list,
// `~/` expansion, directory-with-index resolution, missing-path warning — are
// directly unit-testable without spawning the whole CLI.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// Given the value of LITTLE_CODER_EXTRA_EXTENSIONS (path-delimited list of
// extension paths), return the resolved entry files that should be passed to pi
// as `--extension <entry>` flags. Skips empty segments, expands a leading `~/`,
// resolves a directory entry to its `index.ts` (preferred) or `index.js`, and
// records a one-line warning for each missing/unusable path so a typo in the
// env var doesn't kill the session — it just doesn't load that extension.
export function parseExtraExtensions(
  envValue,
  { home = homedir(), exists = existsSync, stat = statSync } = {},
) {
  const entries = [];
  const warnings = [];
  for (const raw of String(envValue ?? "").split(delimiter)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const expanded = trimmed === "~"
      ? home
      : trimmed.startsWith("~/")
        ? home + trimmed.slice(1)
        : trimmed;
    if (!exists(expanded)) {
      warnings.push(
        `little-coder: LITTLE_CODER_EXTRA_EXTENSIONS path not found, skipping: ${expanded}`,
      );
      continue;
    }
    let entry = expanded;
    try {
      if (stat(expanded).isDirectory()) {
        const candidates = [join(expanded, "index.ts"), join(expanded, "index.js")];
        const found = candidates.find((p) => exists(p));
        if (!found) {
          warnings.push(
            `little-coder: LITTLE_CODER_EXTRA_EXTENSIONS dir has no index.ts/index.js, skipping: ${expanded}`,
          );
          continue;
        }
        entry = found;
      }
    } catch {
      // unreadable / racing stat — skip silently
      continue;
    }
    entries.push(entry);
  }
  return { entries, warnings };
}
