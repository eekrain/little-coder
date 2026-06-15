import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Up-arrow prompt history, persisted across sessions.
//
// pi's default editor exposes an `addToHistory` hook (which pi calls on every
// submit) but ships no actual navigation, so up-arrow does nothing. We provide a
// custom editor — a subclass of pi's own CustomEditor, so pi copies all the
// app keybindings, autocomplete, and submit wiring onto it (see
// interactive-mode.setCustomEditorComponent) — that implements `addToHistory`
// and recalls history on ↑ / ↓.
//
// Why a custom editor and not raw onTerminalInput key-matching: pi runs the
// Kitty keyboard protocol (flags=7), so arrows arrive as CSI-u sequences with
// press/repeat/release events. The editor path (a) only sees press/repeat —
// the TUI filters releases before handleInput — and (b) lets us detect ↑/↓ via
// keybindings.matches(), which already understands every encoding. Both are
// brittle to reproduce from raw bytes.
//
// History is stored in <agentDir>/little-coder-prompt-history.json so a brand
// new session (even one with no messages) can recall prompts from earlier runs.

const MAX = 100;

function agentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env && env.trim().length > 0) {
    if (env === "~") return homedir();
    if (env.startsWith("~/")) return homedir() + env.slice(1);
    return env;
  }
  return join(homedir(), ".pi", "agent");
}

function historyFile(): string {
  return join(agentDir(), "little-coder-prompt-history.json");
}

export function loadHistory(): string[] {
  try {
    const raw = JSON.parse(readFileSync(historyFile(), "utf-8"));
    if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string").slice(-MAX);
  } catch {
    // missing / unreadable / corrupt — start empty
  }
  return [];
}

function saveHistory(items: string[]): void {
  try {
    const dir = dirname(historyFile());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(historyFile(), JSON.stringify(items.slice(-MAX)));
  } catch {
    // best-effort; recall still works in-process this session
  }
}

/**
 * Pure history store. `recall("up"|"down", currentText)` returns the text to
 * place in the editor, or null to let the editor handle the key normally.
 * Navigation only STARTS from an empty prompt (so it never clobbers a draft or
 * fights multi-line cursor movement); once navigating, ↑/↓ walk the list.
 */
export function makeHistory(initial: string[] = [], persist: (items: string[]) => void = () => {}) {
  const items = initial.slice(-MAX);
  let nav = -1;

  return {
    items,
    add(text: string) {
      const t = (text ?? "").trim();
      if (!t) return;
      if (items[items.length - 1] !== text) {
        items.push(text);
        while (items.length > MAX) items.shift();
        persist(items);
      }
      nav = -1;
    },
    reset() {
      nav = -1;
    },
    recall(dir: "up" | "down", current: string): string | null {
      if (dir === "up") {
        if (nav === -1) {
          if (current !== "" || items.length === 0) return null; // only from empty
          nav = items.length - 1;
        } else if (nav > 0) {
          nav -= 1;
        }
        return items[nav];
      }
      // down
      if (nav === -1) return null;
      if (nav < items.length - 1) {
        nav += 1;
        return items[nav];
      }
      nav = -1;
      return ""; // past the newest → empty prompt
    },
  };
}

export default function (pi: ExtensionAPI) {
  const store = makeHistory(loadHistory(), saveHistory);

  // A CustomEditor that adds history recall. pi copies app keybindings,
  // autocomplete, and submit/change wiring onto it after construction.
  class HistoryEditor extends CustomEditor {
    private kb: any;
    private tuiRef: any;
    constructor(tui: any, theme: any, keybindings: any, options?: any) {
      super(tui, theme, keybindings, options);
      this.kb = keybindings;
      this.tuiRef = tui;
    }

    // pi calls this on every submit — our hook to record + persist the prompt.
    addToHistory(text: string): void {
      store.add(text);
    }

    handleInput(data: string): void {
      const up = this.kb?.matches?.(data, "tui.editor.cursorUp");
      const down = this.kb?.matches?.(data, "tui.editor.cursorDown");
      // Don't hijack ↑/↓ while the autocomplete dropdown is open — it owns them.
      const autocompleting = (this as any).isShowingAutocomplete?.() === true;
      if ((up || down) && !autocompleting) {
        const next = store.recall(up ? "up" : "down", this.getText());
        if (next !== null) {
          this.setText(next);
          this.tuiRef?.requestRender?.();
          return;
        }
      }
      // Any non-navigation key ends the current recall walk.
      if (!up && !down) store.reset();
      super.handleInput(data);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || typeof (ctx.ui as any).setEditorComponent !== "function") return;
    store.reset();
    (ctx.ui as any).setEditorComponent(
      (tui: any, theme: any, keybindings: any) => new HistoryEditor(tui, theme, keybindings),
    );
  });
}
