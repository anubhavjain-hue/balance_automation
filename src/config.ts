import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BASE_DIR = resolve(__dirname, "..");
export const PARTNERS_DIR = resolve(BASE_DIR, "partners");
export const SELECTORS_DIR = resolve(BASE_DIR, "selectors");
export const TMP_DIR = resolve(BASE_DIR, ".tmp");
export const SKILLS_DIR = resolve(BASE_DIR, ".claude", "skills");

// --- Types ---

export interface PartnerTask {
  description: string;
  depends_on?: string;
  merchants?: string[];
  steps: Array<Record<string, string | string[]>>;
  delivery?: {
    type: string;
    url_env: string;
    format: string;
    content_type?: string;
  };
}

export interface PartnerConfig {
  partner: {
    id: string;
    name: string;
    dashboard_url: string;
    credentials: {
      username_env: string;
      password_env: string;
    };
    spa: {
      wait_strategy: string;
      post_nav_delay_ms: number;
      dismiss_popups: boolean;
    };
    tasks: Record<string, PartnerTask>;
    selectors_file: string;
  };
}

export interface SelectorEntry {
  css: string;
  source: string;
  confidence: number;
  last_verified: string;
  previous?: SelectorEntry;
}

export interface SelectorsFile {
  partner_id: string;
  last_updated: string;
  selectors: Record<string, SelectorEntry>;
}

// --- Loaders ---

export function loadPartnerConfig(partnerId: string): PartnerConfig {
  const configPath = resolve(PARTNERS_DIR, `${partnerId}.yaml`);
  if (!existsSync(configPath)) {
    const available = listPartners();
    throw new Error(
      `Partner config not found: ${configPath}\nAvailable: ${available.join(", ") || "none"}`
    );
  }
  return yaml.load(readFileSync(configPath, "utf-8")) as PartnerConfig;
}

export function loadSelectors(partnerId: string): Record<string, string> {
  const filePath = resolve(SELECTORS_DIR, `${partnerId}.json`);
  if (!existsSync(filePath)) {
    return {};
  }
  const data: SelectorsFile = JSON.parse(readFileSync(filePath, "utf-8"));
  const flat: Record<string, string> = {};
  for (const [name, entry] of Object.entries(data.selectors)) {
    flat[name] = entry.css;
  }
  return flat;
}

export function listPartners(): string[] {
  if (!existsSync(PARTNERS_DIR)) return [];
  return readdirSync(PARTNERS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(".yaml", ""));
}

export function listTasks(partnerId: string): Record<string, string> {
  const config = loadPartnerConfig(partnerId);
  const result: Record<string, string> = {};
  for (const [name, task] of Object.entries(config.partner.tasks)) {
    result[name] = task.description;
  }
  return result;
}

export function resolveEnv(config: PartnerConfig, taskName: string): {
  username: string;
  password: string;
  webhookUrl: string;
} {
  const creds = config.partner.credentials;
  const task = config.partner.tasks[taskName];
  return {
    username: process.env[creds.username_env] || "",
    password: process.env[creds.password_env] || "",
    webhookUrl: task?.delivery?.url_env
      ? process.env[task.delivery.url_env] || ""
      : "",
  };
}

export function loadSkill(partnerId: string): string {
  const skillPath = resolve(SKILLS_DIR, partnerId, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillPath}`);
  }
  return readFileSync(skillPath, "utf-8");
}

export function validateEnv(
  config: PartnerConfig,
  taskName: string,
  dryRun: boolean
): string[] {
  const errors: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push("ANTHROPIC_API_KEY not set in .env");
  }
  const creds = config.partner.credentials;
  if (!process.env[creds.username_env]) {
    errors.push(`${creds.username_env} not set in .env`);
  }
  if (!process.env[creds.password_env]) {
    errors.push(`${creds.password_env} not set in .env`);
  }
  const task = config.partner.tasks[taskName];
  if (task?.delivery?.url_env && !dryRun) {
    if (!process.env[task.delivery.url_env]) {
      errors.push(`${task.delivery.url_env} not set in .env`);
    }
  }
  return errors;
}
