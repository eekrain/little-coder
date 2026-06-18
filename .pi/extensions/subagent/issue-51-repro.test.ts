import { describe, it, expect } from "vitest";
import { makeComponent } from "./index.ts";

// Live regression for issue #51 (and the #48 reopen — same root cause from a
// different code path). pi paints the dispatch tool-result panel with a 1-char
// background-color left margin + fill; any line we return wider than
// `width - 1` overflows pi-tui and crashes the session, including on
// `--resume` because pi re-renders saved tool results from session history.
//
// The user's crash log showed a 134-char sub-coder report sentence rendered
// at terminal width 133 → 135 > 133. This test drives makeComponent at the
// same width with the same shape and asserts no emitted line exceeds.

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
const visibleWidth = (s: string) => stripAnsi(s).length;

describe("issue #51 — dispatch renderResult doesn't overflow", () => {
  it("caps a wide sub-coder report line to fit the pi-supplied width", () => {
    const wideSentence =
      "There is **no `rate_limits` table**. The entire file defines a single class, `ConversationStore`, which manages only one SQLite table:";
    // Sanity: this is the exact 134-char shape from the user's crash log.
    expect(wideSentence.length).toBeGreaterThan(133);
    const comp = makeComponent([
      "✓ Storage schema",
      "**Report: `bot/storage.py` Schema Analysis**",
      "",
      wideSentence,
      "",
      "  …",
      "(Ctrl+O to expand)",
    ]);
    const out = comp.render(133);
    const max = Math.max(...out.map((l) => visibleWidth(l)));
    expect(max).toBeLessThanOrEqual(133);
    // The truncated wide sentence keeps its prefix verbatim — it's not blanked
    // out, just clipped with an ellipsis so the user can still read most of it.
    const truncated = out[3];
    expect(stripAnsi(truncated).startsWith("There is **no")).toBe(true);
  });

  it("survives a narrow terminal (40 cols) without throwing", () => {
    const comp = makeComponent([
      "very long content " + "x".repeat(500),
      "another long line " + "y".repeat(200),
    ]);
    const out = comp.render(40);
    expect(Math.max(...out.map((l) => visibleWidth(l)))).toBeLessThanOrEqual(40);
  });

  it("preserves short lines unchanged", () => {
    const comp = makeComponent(["short", "tiny"]);
    expect(comp.render(133)).toEqual(["short", "tiny"]);
  });
});
