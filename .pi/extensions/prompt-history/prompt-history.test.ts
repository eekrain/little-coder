import { describe, it, expect } from "vitest";
import { makeHistory } from "./index.ts";

describe("prompt history recall", () => {
  it("records prompts, skipping blanks and consecutive duplicates", () => {
    const h = makeHistory();
    h.add("first");
    h.add("  "); // blank
    h.add("second");
    h.add("second"); // dup
    expect(h.items).toEqual(["first", "second"]);
  });

  it("persists on add via the provided callback", () => {
    const saved: string[][] = [];
    const h = makeHistory([], (items) => saved.push([...items]));
    h.add("one");
    h.add("two");
    expect(saved).toEqual([["one"], ["one", "two"]]);
  });

  it("seeds from initial (cross-session) history", () => {
    const h = makeHistory(["older", "newer"]);
    expect(h.recall("up", "")).toBe("newer");
    expect(h.recall("up", "newer")).toBe("older");
  });

  it("up from an empty prompt recalls most-recent-first and clamps", () => {
    const h = makeHistory(["a", "b", "c"]);
    expect(h.recall("up", "")).toBe("c");
    expect(h.recall("up", "c")).toBe("b");
    expect(h.recall("up", "b")).toBe("a");
    expect(h.recall("up", "a")).toBe("a"); // clamps at oldest
  });

  it("down walks forward and clears past the newest", () => {
    const h = makeHistory(["a", "b"]);
    h.recall("up", ""); // → b
    h.recall("up", "b"); // → a
    expect(h.recall("down", "a")).toBe("b");
    expect(h.recall("down", "b")).toBe(""); // past newest → empty
  });

  it("does NOT hijack up when the prompt is non-empty (editor handles it)", () => {
    const h = makeHistory(["a"]);
    expect(h.recall("up", "draft text")).toBeNull();
  });

  it("does nothing on up when there is no history", () => {
    const h = makeHistory([]);
    expect(h.recall("up", "")).toBeNull();
  });

  it("down with no active navigation is a no-op (editor handles it)", () => {
    const h = makeHistory(["a"]);
    expect(h.recall("down", "")).toBeNull();
  });

  it("reset() ends navigation so the next up starts fresh", () => {
    const h = makeHistory(["a", "b"]);
    h.recall("up", ""); // → b (navigating)
    h.reset();
    expect(h.recall("up", "b")).toBeNull(); // non-empty + not navigating → editor handles
  });

  it("caps stored history at the maximum", () => {
    const many = Array.from({ length: 150 }, (_, i) => `p${i}`);
    const h = makeHistory(many);
    expect(h.items.length).toBe(100);
    expect(h.items[0]).toBe("p50"); // kept the newest 100
  });
});
