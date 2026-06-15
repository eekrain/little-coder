import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  runSubCoder,
  runSubCodersConcurrent,
  truncateReport,
  type SubCoderItem,
  type SubCoderResult,
} from "./spawn.ts";
import { SubCoderTracker } from "./tracker.ts";

// The `dispatch` tool: the main little-coder spawns isolated child little-coder
// sessions ("sub-coders") to research a focused question — they read the repo
// and browse online, then return a CONCISE report. The full child transcript
// lives in the tool's `details` (UI-only); only the short report enters the
// parent model's context. A live panel above the input tracks them while they
// run. See spawn.ts for the engine and the read-only constraints.

const MAX_PARALLEL = 4;

/** "provider/id" of the current model, so children run on the same backend. */
export function currentModelId(ctx: any): string | undefined {
  const m = ctx?.model;
  if (!m || typeof m.id !== "string") return undefined;
  return m.provider ? `${m.provider}/${m.id}` : m.id;
}

/** A short label for a single-mode task (first few words). */
function shortLabel(task: string): string {
  const words = task.trim().split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return words.length > 28 ? `${words.slice(0, 27)}…` : words || "sub-coder";
}

function buildContent(results: SubCoderResult[]): string {
  if (results.length === 1) {
    const r = results[0];
    if (r.exitCode !== 0) return `Sub-coder "${r.label}" ${r.stopReason || "failed"}: ${r.errorMessage || "(no output)"}`;
    return truncateReport(r.report) || "(no report)";
  }
  const ok = results.filter((r) => r.exitCode === 0).length;
  const blocks = results.map((r) => {
    const status = r.exitCode === 0 ? "" : ` [${r.stopReason || "failed"}]`;
    const body = r.exitCode === 0 ? truncateReport(r.report) : r.errorMessage || "(no output)";
    return `### ${r.label}${status}\n${body || "(no report)"}`;
  });
  return `${ok}/${results.length} sub-coders succeeded.\n\n${blocks.join("\n\n")}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "dispatch",
    label: "Dispatch sub-coder",
    description: [
      "Dispatch one or more isolated sub-coders to research a focused question.",
      "Each runs in its own context window, can read the repo and browse online",
      "(read, grep, glob, webfetch, websearch, browser, read-only bash) but CANNOT",
      "edit or write files. Each returns a concise report. Use this to gather",
      "information without cluttering your own context.",
      "Single: { task }. Parallel: { tasks: [{ label, task }] } (max 4).",
    ].join(" "),
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "A single research task (single mode)" })),
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            label: Type.String({ description: "Short name for this sub-coder (shown in the tracker)" }),
            task: Type.String({ description: "The research task delegated to this sub-coder" }),
          }),
          { description: `Up to ${MAX_PARALLEL} tasks to run in parallel` },
        ),
      ),
      cwd: Type.Optional(Type.String({ description: "Working directory for the sub-coders (default: current)" })),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const hasSingle = typeof params.task === "string" && params.task.trim().length > 0;
      const hasTasks = Array.isArray(params.tasks) && params.tasks.length > 0;
      if (hasSingle === hasTasks) {
        return {
          content: [{ type: "text", text: "Provide exactly one of `task` (single) or `tasks` (parallel)." }],
          details: { results: [] },
          isError: true,
        };
      }
      if (hasTasks && params.tasks!.length > MAX_PARALLEL) {
        return {
          content: [{ type: "text", text: `Too many parallel tasks (${params.tasks!.length}). Max is ${MAX_PARALLEL}.` }],
          details: { results: [] },
          isError: true,
        };
      }

      const cwd = params.cwd || ctx.cwd;
      const items: SubCoderItem[] = hasSingle
        ? [{ id: "1", label: shortLabel(params.task!), task: params.task!, cwd }]
        : params.tasks!.map((t, i) => ({ id: String(i + 1), label: t.label, task: t.task, cwd }));

      const model = currentModelId(ctx);
      const tracker = new SubCoderTracker(ctx as any);
      tracker.begin(items.map((it) => ({ id: it.id, label: it.label })));

      const streamToToolCard = (results: SubCoderResult[]) => {
        if (!onUpdate) return;
        const done = results.filter((r) => r.exitCode !== -1).length;
        onUpdate({
          content: [{ type: "text", text: `${done}/${results.length} sub-coders done…` }],
          details: { results },
        });
      };

      let results: SubCoderResult[];
      try {
        if (hasSingle) {
          const r = await runSubCoder({
            ...items[0],
            model,
            signal,
            onUpdate: (live) => {
              tracker.update([live]);
              streamToToolCard([live]);
            },
          });
          results = [r];
        } else {
          results = await runSubCodersConcurrent(items, {
            model,
            signal,
            onUpdate: (all) => {
              tracker.update(all);
              streamToToolCard(all);
            },
          });
        }
      } finally {
        tracker.end();
      }

      const anyError = results.some((r) => r.exitCode !== 0);
      const allError = results.every((r) => r.exitCode !== 0);
      return {
        content: [{ type: "text", text: buildContent(results) }],
        details: { results },
        isError: allError && anyError,
      };
    },

    // Renderers return a duck-typed Component ({ render→lines, invalidate }).
    // pi 0.79 stopped hoisting pi-tui, so we build colored lines via `theme`
    // rather than importing pi-tui primitives (same approach as branding).
    renderCall(args: any, theme: any) {
      const lines: string[] = [];
      const title = theme.fg("toolTitle", theme.bold("dispatch "));
      if (Array.isArray(args.tasks) && args.tasks.length > 0) {
        lines.push(title + theme.fg("accent", `${args.tasks.length} sub-coders`));
        for (const t of args.tasks.slice(0, MAX_PARALLEL)) {
          const preview = t.task.length > 48 ? `${t.task.slice(0, 48)}…` : t.task;
          lines.push(`  ${theme.fg("accent", t.label)}${theme.fg("dim", ` — ${preview}`)}`);
        }
      } else {
        const task = String(args.task ?? "…");
        lines.push(title + theme.fg("dim", task.length > 64 ? `${task.slice(0, 64)}…` : task));
      }
      return makeComponent(lines);
    },

    renderResult(result: any, options: any, theme: any) {
      const expanded = !!options?.expanded;
      const results: SubCoderResult[] = result?.details?.results ?? [];
      if (results.length === 0) {
        const t = result?.content?.[0];
        return makeComponent([t?.type === "text" ? t.text : "(no output)"]);
      }
      const ok = results.filter((r) => r.exitCode === 0).length;
      const lines: string[] = [
        theme.fg("toolTitle", theme.bold("dispatch ")) + theme.fg("accent", `${ok}/${results.length} sub-coders`),
      ];
      for (const r of results) {
        const icon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
        lines.push("");
        lines.push(`${icon} ${theme.fg("accent", r.label)}`);
        const body = r.exitCode === 0 ? r.report : r.errorMessage || r.stderr || "(no output)";
        const bodyLines = body.trim() ? body.trim().split("\n") : ["(no output)"];
        const shown = expanded ? bodyLines : bodyLines.slice(0, 4);
        for (const bl of shown) lines.push(theme.fg("toolOutput", bl));
        if (!expanded && bodyLines.length > shown.length) lines.push(theme.fg("muted", "  …"));
      }
      if (!expanded) lines.push(theme.fg("muted", "(Ctrl+O to expand)"));
      return makeComponent(lines);
    },
  });
}

/** A minimal pi-tui Component backed by precomputed lines. */
function makeComponent(lines: string[]) {
  return {
    render(_width: number): string[] {
      return lines;
    },
    invalidate() {},
  };
}
