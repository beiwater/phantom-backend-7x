#!/usr/bin/env node
/**
 * SimCompanies Minecraft-Style Command Console (类我的世界指令控制台)
 *
 * Usage:
 *   1. Interactive REPL:
 *      npm run console
 *      node --experimental-strip-types scripts/console.ts
 *
 *   2. One-Shot Command Execution:
 *      node --experimental-strip-types scripts/console.ts "/give 1 water 5000"
 *      node --experimental-strip-types scripts/console.ts "/economy boom"
 */

import readline from 'node:readline';
import { executeCommand, getCommandRegistry } from '../server/game/commands/command-engine.ts';
import { CONFIG } from '../server/config.ts';

const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_GRAY = '\x1b[90m';

async function checkServerOnline(): Promise<string | null> {
  const urls = [
    process.env.TIME_WARP_URL,
    process.env.BASE_URL,
    `http://127.0.0.1:${CONFIG.PORT}`,
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080'
  ].filter(Boolean) as string[];

  for (const url of Array.from(new Set(urls))) {
    const cleanUrl = url.replace(/\/$/, '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 800);
      const res = await fetch(`${cleanUrl}/api/v2/debug/state/`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        return cleanUrl;
      }
    } catch {
      // not running on this url
    }
  }

  return null;
}

async function runCommandOverHttp(baseUrl: string, rawCmd: string): Promise<{ success: boolean; message: string; assistantReply?: string }> {
  const res = await fetch(`${baseUrl}/api/v2/debug/command/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: rawCmd })
  });

  const json = await res.json() as { success: boolean; message: string; assistantReply?: string; error?: string };
  if (!res.ok) {
    return {
      success: false,
      message: json.error || json.message || `HTTP ${res.status} Error`,
      assistantReply: json.assistantReply
    };
  }

  return json;
}

function printBanner(onlineUrl: string | null): void {
  console.log(`${ANSI_CYAN}========================================================================${ANSI_RESET}`);
  console.log(`  ${ANSI_BOLD}SimCompanies Minecraft Command Console${ANSI_RESET} [类我的世界游戏调控控制台]`);
  if (onlineUrl) {
    console.log(`  Mode: ${ANSI_GREEN}● ONLINE (HTTP API @ ${onlineUrl})${ANSI_RESET}`);
  } else {
    console.log(`  Mode: ${ANSI_YELLOW}● OFFLINE (Direct Local SQLite & Game Engine)${ANSI_RESET}`);
  }
  console.log(`  Type ${ANSI_BOLD}/help${ANSI_RESET} for commands list, ${ANSI_BOLD}/exit${ANSI_RESET} or Ctrl+C to quit.`);
  console.log(`${ANSI_CYAN}========================================================================${ANSI_RESET}\n`);
}

function formatMcMessage(msg: string): string {
  // Replace Minecraft formatting codes (e.g. §a, §c, §e, §r) with ANSI codes
  return msg
    .replace(/§a/g, ANSI_GREEN)
    .replace(/§c/g, ANSI_RED)
    .replace(/§e/g, ANSI_YELLOW)
    .replace(/§b/g, ANSI_CYAN)
    .replace(/§r/g, ANSI_RESET);
}

async function executeLine(line: string, onlineUrl: string | null): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Prefix with / if omitted
  const formattedCmd = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  try {
    let result: { success: boolean; message: string; assistantReply?: string };

    if (onlineUrl) {
      result = await runCommandOverHttp(onlineUrl, formattedCmd);
    } else {
      result = await executeCommand(formattedCmd, {
        executorCompanyId: null,
        isOp: true,
        source: 'cli'
      });
    }

    if (result.success) {
      console.log(`${ANSI_GREEN}✔${ANSI_RESET} ${formatMcMessage(result.message)}`);
      if (result.assistantReply && !result.assistantReply.includes(result.message)) {
        console.log(`${ANSI_GRAY}  [PA]: ${result.assistantReply}${ANSI_RESET}`);
      }
    } else {
      console.log(`${ANSI_RED}✘ ${formatMcMessage(result.message)}${ANSI_RESET}`);
      if (result.assistantReply) {
        console.log(`${ANSI_GRAY}  [PA]: ${result.assistantReply}${ANSI_RESET}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${ANSI_RED}✘ Execution failed: ${msg}${ANSI_RESET}`);
  }
}

async function main() {
  const onlineUrl = await checkServerOnline();

  // One-shot execution if arguments provided
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    const commandToRun = cliArgs.join(' ');
    await executeLine(commandToRun, onlineUrl);
    process.exit(0);
  }

  // Interactive REPL
  printBanner(onlineUrl);

  const registry = getCommandRegistry();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ANSI_CYAN}simcomp${ANSI_RESET}> `,
    completer: (line: string) => {
      const completions = registry.getCompletions(line);
      return [completions, line];
    }
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const clean = line.trim();
    if (clean === 'exit' || clean === 'quit' || clean === '/exit' || clean === '/quit') {
      rl.close();
      return;
    }

    await executeLine(clean, onlineUrl);
    console.log();
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${ANSI_CYAN}Console session closed. Goodbye!${ANSI_RESET}`);
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal console error:', err);
  process.exit(1);
});
