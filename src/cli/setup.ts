#!/usr/bin/env node
/**
 * npx @mnemopay/sdk setup
 *
 * Auto-configures Claude Code hooks for MnemoPay session lifecycle:
 *   - Stop hook: blocks exit once, prompts Claude to save session summary
 *   - UserPromptSubmit hook: injects recall reminder on each message
 *
 * Works on Windows, macOS, and Linux.
 */

import fs from "fs";
import path from "path";
import os from "os";

const AUTO_CAPTURE_HOOK_CONTENT = `#!/bin/bash
# MnemoPay auto-capture hook — PostToolUse
# Detects high-signal tool outcomes and instructs Claude to save them to memory.
INPUT=$(cat)
TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | grep -o '[^"]*"$' | tr -d '"' 2>/dev/null)
COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"' 2>/dev/null)
EXIT_CODE=$(echo "$INPUT" | grep -o '"exit_code":[0-9]*' | grep -o '[0-9]*' 2>/dev/null)

MSG=""

# git commit — always worth remembering
if echo "$COMMAND" | grep -q "git commit"; then
    MSG="A git commit was just made. Call mcp__mnemopay__remember with what was committed and why. Importance: 0.7, tags: [commit, progress]."
fi

# git push — milestone
if echo "$COMMAND" | grep -q "git push"; then
    MSG="Code was just pushed to remote. Call mcp__mnemopay__remember with what shipped. Importance: 0.75, tags: [shipped, milestone]."
fi

# npm publish — release
if echo "$COMMAND" | grep -q "npm publish"; then
    MSG="A package was just published to npm. Call mcp__mnemopay__remember with the version and what changed. Importance: 0.8, tags: [release, shipped]."
fi

# test run completed successfully
if [ "$TOOL" = "Bash" ] && echo "$COMMAND" | grep -qE "vitest|jest|pytest|npm test|npm run test"; then
    if [ "$EXIT_CODE" = "0" ]; then
        MSG="Tests just passed. Call mcp__mnemopay__remember with what was tested and that it passed. Importance: 0.6, tags: [tests, progress]."
    fi
fi

# File written — significant new file
if [ "$TOOL" = "Write" ]; then
    FILE=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"' 2>/dev/null)
    if echo "$FILE" | grep -qvE "node_modules|dist|.git|tmp|temp"; then
        MSG="A new file was just written: $FILE. If this is significant (new feature, config, doc), call mcp__mnemopay__remember with what it does. Importance: 0.55, tags: [file, progress]."
    fi
fi

if [ -n "$MSG" ]; then
    printf '{"systemMessage":"%s"}\n' "$MSG"
else
    printf '{}\n'
fi
`;

const STOP_HOOK_CONTENT = `#!/bin/bash
MARKER="$HOME/.claude/hooks/.mnemo-stop"

if [ ! -f "$MARKER" ]; then
    touch "$MARKER"
    printf '{"decision":"block","reason":"Before stopping: call mcp__mnemopay__remember with a concise summary of this session (what was accomplished, decisions made, follow-up needed). Use importance 0.85 and tags [\\"session-summary\\"]."}\n'
else
    rm "$MARKER"
    printf '{}\n'
fi
`;

const USER_PROMPT_HOOK_COMMAND =
  `bash -c "echo '{\\"systemMessage\\":\\"You have persistent memory via MnemoPay MCP. ` +
  `If this is the start of a new topic or session, call mcp__mnemopay__recall to load relevant context. ` +
  `Store any important new facts or decisions with mcp__mnemopay__remember.\\"}'"\n`.trimEnd();

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

function err(msg: string) {
  process.stderr.write("✗ " + msg + "\n");
}

function claudeDir(): string {
  return path.join(os.homedir(), ".claude");
}

function hooksDir(): string {
  return path.join(claudeDir(), "hooks");
}

function settingsPath(): string {
  return path.join(claudeDir(), "settings.json");
}

function stopHookPath(): string {
  return path.join(hooksDir(), "stop-hook.sh");
}

function autoCaptureHookPath(): string {
  return path.join(hooksDir(), "auto-capture-hook.sh");
}

function stopHookCommand(): string {
  const p = stopHookPath().replace(/\\/g, "/");
  return `bash ${p}`;
}

function autoCaptureHookCommand(): string {
  const p = autoCaptureHookPath().replace(/\\/g, "/");
  return `bash ${p}`;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`  created ${dir}`);
  }
}

function writeStopHook() {
  const p = stopHookPath();
  fs.writeFileSync(p, STOP_HOOK_CONTENT, { encoding: "utf8" });
  if (process.platform !== "win32") fs.chmodSync(p, 0o755);
  log(`  wrote   ${p}`);
}

function writeAutoCaptureHook() {
  const p = autoCaptureHookPath();
  fs.writeFileSync(p, AUTO_CAPTURE_HOOK_CONTENT, { encoding: "utf8" });
  if (process.platform !== "win32") fs.chmodSync(p, 0o755);
  log(`  wrote   ${p}`);
}

type HookEntry = {
  type: string;
  command: string;
  timeout: number;
};

type HookGroup = {
  matcher: string;
  hooks: HookEntry[];
};

type Settings = {
  hooks?: {
    Stop?: HookGroup[];
    UserPromptSubmit?: HookGroup[];
    PostToolUse?: HookGroup[];
    [key: string]: HookGroup[] | undefined;
  };
  [key: string]: unknown;
};

function readSettings(): Settings {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Settings;
  } catch {
    err(`Could not parse ${p} — backing up and starting fresh`);
    fs.copyFileSync(p, p + ".bak");
    return {};
  }
}

function hasHook(groups: HookGroup[] | undefined, matcher: string): boolean {
  if (!groups) return false;
  return groups.some((g) => g.matcher === matcher);
}

function injectHooks(settings: Settings): { settings: Settings; changed: boolean } {
  let changed = false;

  if (!settings.hooks) {
    settings.hooks = {};
    changed = true;
  }

  // Stop hook
  if (!hasHook(settings.hooks.Stop, "")) {
    settings.hooks.Stop = [
      ...(settings.hooks.Stop ?? []),
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: stopHookCommand(),
            timeout: 10000,
          },
        ],
      },
    ];
    changed = true;
    log("  injected Stop hook");
  } else {
    log("  Stop hook already present — skipped");
  }

  // UserPromptSubmit hook
  if (!hasHook(settings.hooks.UserPromptSubmit, "")) {
    settings.hooks.UserPromptSubmit = [
      ...(settings.hooks.UserPromptSubmit ?? []),
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: USER_PROMPT_HOOK_COMMAND,
            timeout: 5000,
          },
        ],
      },
    ];
    changed = true;
    log("  injected UserPromptSubmit hook");
  } else {
    log("  UserPromptSubmit hook already present — skipped");
  }

  // PostToolUse auto-capture hook
  if (!hasHook(settings.hooks.PostToolUse, "")) {
    settings.hooks.PostToolUse = [
      ...(settings.hooks.PostToolUse ?? []),
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: autoCaptureHookCommand(),
            timeout: 5000,
          },
        ],
      },
    ];
    changed = true;
    log("  injected PostToolUse auto-capture hook");
  } else {
    log("  PostToolUse hook already present — skipped");
  }

  return { settings, changed };
}

function main() {
  log("\nMnemoPay Claude Code Setup\n");

  // 1. Ensure directories
  ensureDir(claudeDir());
  ensureDir(hooksDir());

  // 2. Write hook scripts
  writeStopHook();
  writeAutoCaptureHook();

  // 3. Read + patch settings.json
  const raw = readSettings();
  const { settings, changed } = injectHooks(raw);

  if (changed) {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
    log(`  saved   ${settingsPath()}`);
  }

  log("\nDone! Claude Code hooks are configured for MnemoPay.\n");
  log("What happens now:");
  log("  • On session end   — Claude is prompted to save a session summary");
  log("  • On each message  — Claude is reminded to recall relevant memories");
  log("  • After tool use   — git commits, publishes, writes auto-trigger memory saves\n");
  log("Make sure MnemoPay MCP is connected:");
  log("  claude mcp add mnemopay -s user -- npx -y @mnemopay/sdk\n");
}

main();
