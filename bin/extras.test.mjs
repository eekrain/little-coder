import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseExtraExtensions } from "./extras.mjs";

function setupTmp() {
  return mkdtempSync(join(tmpdir(), "lc-extras-"));
}

describe("parseExtraExtensions", () => {
  it("returns no entries when env is unset / empty", () => {
    expect(parseExtraExtensions(undefined).entries).toEqual([]);
    expect(parseExtraExtensions("").entries).toEqual([]);
    expect(parseExtraExtensions(delimiter + delimiter).entries).toEqual([]);
  });

  it("forwards a direct file path verbatim", () => {
    const dir = setupTmp();
    try {
      const file = join(dir, "ponytail.js");
      writeFileSync(file, "export default function(){}");
      const { entries, warnings } = parseExtraExtensions(file);
      expect(entries).toEqual([file]);
      expect(warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("resolves a directory entry to its index.ts (preferred)", () => {
    const dir = setupTmp();
    try {
      const extDir = join(dir, "ponytail");
      mkdirSync(extDir);
      writeFileSync(join(extDir, "index.ts"), "");
      writeFileSync(join(extDir, "index.js"), "");
      const { entries } = parseExtraExtensions(extDir);
      expect(entries).toEqual([join(extDir, "index.ts")]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("falls back to index.js when index.ts is absent", () => {
    const dir = setupTmp();
    try {
      const extDir = join(dir, "ponytail");
      mkdirSync(extDir);
      writeFileSync(join(extDir, "index.js"), "");
      const { entries } = parseExtraExtensions(extDir);
      expect(entries).toEqual([join(extDir, "index.js")]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("warns and skips a directory without index.ts/index.js", () => {
    const dir = setupTmp();
    try {
      const extDir = join(dir, "empty");
      mkdirSync(extDir);
      const { entries, warnings } = parseExtraExtensions(extDir);
      expect(entries).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("no index.ts/index.js");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("warns and skips a missing path (typo doesn't kill the session)", () => {
    const { entries, warnings } = parseExtraExtensions("/tmp/does-not-exist-zzz-xyz-123");
    expect(entries).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("path not found");
  });

  it("expands a leading ~/ using the supplied home", () => {
    const dir = setupTmp();
    try {
      const extDir = join(dir, "fake-home", "ext");
      mkdirSync(extDir, { recursive: true });
      writeFileSync(join(extDir, "index.js"), "");
      const { entries } = parseExtraExtensions("~/ext", {
        home: join(dir, "fake-home"),
      });
      expect(entries).toEqual([join(extDir, "index.js")]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("layers multiple extensions from one path-delimited list", () => {
    const dir = setupTmp();
    try {
      const a = join(dir, "a.js");
      writeFileSync(a, "");
      const b = join(dir, "b.js");
      writeFileSync(b, "");
      const { entries } = parseExtraExtensions([a, b].join(delimiter));
      expect(entries).toEqual([a, b]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("trims whitespace around list entries", () => {
    const dir = setupTmp();
    try {
      const a = join(dir, "a.js");
      writeFileSync(a, "");
      const { entries } = parseExtraExtensions(`  ${a}  `);
      expect(entries).toEqual([a]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
