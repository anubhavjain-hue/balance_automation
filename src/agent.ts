#!/usr/bin/env tsx
/**
 * Hybrid Agentic Dashboard Scraper
 *
 * Uses Claude Agent SDK with Playwright MCP for browser automation.
 * Fast path (CSS selectors) with vision fallback (screenshots).
 *
 * Usage:
 *   npx tsx src/agent.ts -p total-processing -t balances
 *   npx tsx src/agent.ts -p total-processing -t report --days 14
 *   npx tsx src/agent.ts -p total-processing -t all --dry-run
 *   npx tsx src/agent.ts -p total-processing --prompt "find failed transactions"
 *   npx tsx src/agent.ts --prompt "go to example.com and extract the heading"
 *   npx tsx src/agent.ts --list-partners
 *   npx tsx src/agent.ts -p total-processing --list-tasks
 */

import { parseArgs } from "util";
import { mkdirSync } from "fs";
import { config } from "dotenv";
import { resolve } from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  loadPartnerConfig,
  loadSelectors,
  listPartners,
  listTasks,
  validateEnv,
  BASE_DIR,
  TMP_DIR,
  SELECTORS_DIR,
  PartnerConfig,
} from "./config.js";
import { buildTaskPrompts, buildFreeformPrompts } from "./prompt.js";

const MODEL_MAP: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-5-20250929",
  opus: "claude-opus-4-6",
};

// Load .env from project root
config({ path: resolve(BASE_DIR, ".env") });

// --- CLI Parsing ---

const { values } = parseArgs({
  options: {
    partner: { type: "string", short: "p" },
    task: { type: "string", short: "t" },
    prompt: { type: "string" },
    model: { type: "string", short: "m", default: "haiku" },
    "max-budget": { type: "string", default: "0.50" },
    days: { type: "string", default: "7" },
    "dry-run": { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    "list-partners": { type: "boolean", default: false },
    "list-tasks": { type: "boolean", default: false },
  },
  strict: true,
});

// --- Input Validation ---

function validateId(value: string, name: string): void {
  if (!/^[a-z0-9-_]+$/.test(value)) {
    console.error(`Error: invalid ${name} "${value}" — only lowercase letters, numbers, hyphens, and underscores are allowed`);
    process.exit(1);
  }
}

if (values.partner) validateId(values.partner, "partner");
if (values.task && values.task !== "all") validateId(values.task, "task");

// --- Commands ---

if (values["list-partners"]) {
  const partners = listPartners();
  if (partners.length) {
    console.log("Available partners:");
    for (const p of partners.sort()) console.log(`  - ${p}`);
  } else {
    console.log("No partners configured. Add YAML files to partners/");
  }
  process.exit(0);
}

if (values["list-tasks"]) {
  if (!values.partner) {
    console.error("Error: --partner required with --list-tasks");
    process.exit(1);
  }
  const tasks = listTasks(values.partner);
  console.log(`Tasks for ${values.partner}:`);
  for (const [name, desc] of Object.entries(tasks)) {
    console.log(`  - ${name}: ${desc}`);
  }
  process.exit(0);
}

// Validate: need either (partner + task) or (prompt)
if (!values.prompt && (!values.partner || !values.task)) {
  console.log(`Usage:
  npx tsx src/agent.ts -p <partner> -t <task> [options]     # Task mode
  npx tsx src/agent.ts -p <partner> --prompt "instruction"  # Freeform with partner
  npx tsx src/agent.ts --prompt "instruction"               # Freeform (no partner)

Options:
  -p, --partner <id>      Partner ID (e.g., total-processing)
  -t, --task <name>       Task name (e.g., report, balances, all)
  --prompt <text>         Freeform instruction for the agent
  -m, --model <id>        Model: haiku (default), sonnet, opus
  --days <n>              Report lookback days (default: 7)
  --dry-run               Skip webhook delivery
  --headed                Run browser in visible mode
  -v, --verbose           Debug-level logging
  --list-partners         List available partners
  --list-tasks            List tasks for a partner`);
  process.exit(1);
}

if (values.partner && !values.task && !values.prompt) {
  console.error("Error: --task or --prompt required with --partner");
  process.exit(1);
}

// --- Shared Agent Execution ---

interface TaskArgs {
  days: number;
  dryRun: boolean;
  headed: boolean;
}

async function executeAgent(
  agentSystemPrompt: string,
  prompt: string,
  label: string,
  args: TaskArgs,
  selectorCount: number
): Promise<boolean> {
  console.log(`[INFO] Starting: ${label}`);
  console.log(`[INFO] Known selectors: ${selectorCount}`);
  console.log(
    `[INFO] Model: ${values.model || "haiku"}, mode: ${args.headed ? "headed" : "headless"}, dry_run=${args.dryRun}`
  );

  const startTime = Date.now();

  // Build Playwright MCP args
  const playwrightArgs = ["@playwright/mcp@latest"];
  if (!args.headed) {
    playwrightArgs.push("--headless");
  }
  playwrightArgs.push("--caps", "core,vision");
  playwrightArgs.push("--viewport-size", "1920x1080");

  try {
    let resultText: string | null = null;

    const agentQuery = query({
      prompt,
      options: {
        model: MODEL_MAP[values.model || "haiku"],
        systemPrompt: agentSystemPrompt,

        mcpServers: {
          playwright: {
            type: "stdio",
            command: "npx",
            args: ["-y", ...playwrightArgs],
          },
        },

        allowedTools: [
          "mcp__playwright__*",
          "Read",
          "Write",
          "Bash",
          "Glob",
        ],

        maxTurns: 50,
        maxBudgetUsd: parseFloat(values["max-budget"] || "0.50"),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd: BASE_DIR,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
          PATH: process.env.PATH || "",
          HOME: process.env.HOME || "",
        },
      },
    });

    for await (const message of agentQuery) {
      const msg = message as Record<string, unknown>;

      // Intercept API-level errors on assistant messages
      if (msg.type === "assistant") {
        const error = (msg as any).message?.error;
        if (error) {
          const errorType = error.type || "unknown";
          console.error(`[ERROR] API error: ${errorType}`);
          if (["authentication_failed", "billing_error"].includes(errorType)) {
            resultText = `Error: ${errorType}`;
            break;
          }
        }

        if (values.verbose) {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                console.log(`[AGENT] ${block.text.slice(0, 200)}`);
              } else if (block.type === "tool_use") {
                console.log(`[TOOL] ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
              }
            }
          }
        }
      }

      if (msg.type === "result") {
        if (msg.subtype === "success") {
          resultText = (msg as any).result || "Task completed";
          const cost = (msg as any).total_cost_usd;
          const turns = (msg as any).num_turns;
          console.log(`[INFO] Agent completed (${turns} turns, $${cost?.toFixed(4)})`);
        } else if (msg.subtype === "error_max_budget_usd") {
          console.error(`[ERROR] Budget exceeded ($0.50 cap)`);
          resultText = `Error: budget_exceeded`;
        } else if (
          msg.subtype === "error_during_execution" ||
          msg.subtype === "error_max_turns"
        ) {
          const errors = (msg as any).errors;
          console.error(`[ERROR] Agent failed: ${msg.subtype}`);
          if (errors) console.error(errors);
          resultText = `Error: ${msg.subtype}`;
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[INFO] ${label} finished in ${elapsed}s`);

    // Check for agent-reported errors (fail-fast from prompt rules)
    if (resultText?.startsWith("ERROR:")) {
      console.error(`[AGENT_ERROR] ${resultText}`);
      return false;
    }

    if (resultText) {
      console.log("\n" + "=".repeat(60));
      console.log(`RESULT: ${label}`);
      console.log("=".repeat(60));
      console.log(resultText);
      console.log("=".repeat(60));
    }

    return resultText !== null && !resultText.startsWith("Error");
  } catch (err) {
    console.error(`[ERROR] Agent execution failed:`, err);
    return false;
  }
}

// --- Task Mode ---

async function runTask(
  partnerId: string,
  taskName: string,
  args: TaskArgs
): Promise<boolean> {
  const partnerConfig = loadPartnerConfig(partnerId);
  const selectors = loadSelectors(partnerId);

  const envErrors = validateEnv(partnerConfig, taskName, args.dryRun);
  if (envErrors.length) {
    for (const e of envErrors) console.error(`[ERROR] ${e}`);
    return false;
  }

  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(SELECTORS_DIR, { recursive: true });

  const { systemPrompt, userPrompt } = buildTaskPrompts(partnerConfig, taskName, selectors, {
    days: args.days,
    dryRun: args.dryRun,
    headed: args.headed,
  });

  return executeAgent(systemPrompt, userPrompt, `${partnerId}/${taskName}`, args, Object.keys(selectors).length);
}

async function runAllTasks(
  partnerId: string,
  args: TaskArgs
): Promise<boolean> {
  const partnerConfig = loadPartnerConfig(partnerId);
  const tasks = Object.keys(partnerConfig.partner.tasks).filter(
    (t) => t !== "login"
  );

  const results: Record<string, boolean> = {};
  for (const taskName of tasks) {
    console.log(`\n${"=".repeat(40)}\nRunning: ${partnerId}/${taskName}\n${"=".repeat(40)}`);
    results[taskName] = await runTask(partnerId, taskName, args);
  }

  console.log(`\nResults: ${JSON.stringify(results, null, 2)}`);
  return Object.values(results).every(Boolean);
}

// --- Freeform Mode ---

async function runFreeform(
  userPrompt: string,
  partnerId: string | undefined,
  args: TaskArgs
): Promise<boolean> {
  let partnerConfig: PartnerConfig | null = null;
  let selectors: Record<string, string> = {};

  if (partnerId) {
    partnerConfig = loadPartnerConfig(partnerId);
    selectors = loadSelectors(partnerId);

    // Validate credentials (but not webhook URLs — freeform may not deliver)
    const creds = partnerConfig.partner.credentials;
    if (!process.env[creds.username_env] || !process.env[creds.password_env]) {
      console.error("[ERROR] Dashboard credentials not set in .env");
      return false;
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[ERROR] ANTHROPIC_API_KEY not set in .env");
    return false;
  }

  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(SELECTORS_DIR, { recursive: true });

  const { systemPrompt, userPrompt: agentPrompt } = buildFreeformPrompts(userPrompt, partnerConfig, selectors, {
    days: args.days,
    dryRun: args.dryRun,
    headed: args.headed,
  });

  const label = partnerId ? `${partnerId}/freeform` : "freeform";
  return executeAgent(systemPrompt, agentPrompt, label, args, Object.keys(selectors).length);
}

// --- Main ---

const taskArgs: TaskArgs = {
  days: parseInt(values.days || "7", 10),
  dryRun: values["dry-run"] ?? false,
  headed: values.headed ?? false,
};

let success: boolean;

if (values.prompt) {
  success = await runFreeform(values.prompt, values.partner, taskArgs);
} else if (values.task === "all") {
  success = await runAllTasks(values.partner!, taskArgs);
} else {
  success = await runTask(values.partner!, values.task!, taskArgs);
}

process.exit(success ? 0 : 1);
