import { PartnerConfig, resolveEnv, loadSkill, TMP_DIR } from "./config.js";

interface PromptArgs {
  days?: number;
  dryRun?: boolean;
  headed?: boolean;
}

interface SplitPrompt {
  systemPrompt: string;
  userPrompt: string;
}

function buildSkillSystemPrompt(partnerId: string, selectors: Record<string, string>): string {
  const skill = loadSkill(partnerId);
  const selectorsJson = JSON.stringify(selectors, null, 2);

  return `${skill}

## Selectors (JSON)
\`\`\`json
${selectorsJson}
\`\`\`

CRITICAL: Do NOT narrate, explain, or summarize your actions. Do NOT describe what you are doing or what you found. Your ONLY text output must be the final result data (JSON or file path). No prose before, during, or after.

FAIL FAST RULES:
- If login fails (wrong credentials, CAPTCHA, 2FA prompt, error message on page): output "ERROR: login_failed" and stop immediately
- If a page returns 403/404/500 or shows an unexpected error: output "ERROR: http_error" and stop
- If after 3 attempts a selector still fails and screenshot shows nothing useful: output "ERROR: selector_failed:<name>" and stop
- Do NOT retry the same failed action more than 3 times
- Do NOT try creative workarounds for blocked or broken pages`;
}

export function buildTaskPrompts(
  config: PartnerConfig,
  taskName: string,
  selectors: Record<string, string>,
  args: PromptArgs = {}
): SplitPrompt {
  const partner = config.partner;
  const task = partner.tasks[taskName];
  const { username, password, webhookUrl } = resolveEnv(config, taskName);
  const days = args.days ?? 7;
  const dryRun = args.dryRun ?? false;

  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - days * 86400000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtSlash = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const fmtSlashUS = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  const systemPrompt = buildSkillSystemPrompt(partner.id, selectors);

  let userPrompt = `Task: ${taskName} — ${task.description}
Credentials: ${username} / ${password}
`;

  if (taskName === "report") {
    const merchants = task.merchants || [];
    if (partner.id === "dlocal") {
      userPrompt += `Date range: ${fmtSlashUS(dateFrom)} ~ ${fmtSlashUS(dateTo)} (${days} days)\n`;
      userPrompt += `OPTIMIZED: Navigate directly to /payins/transactions?periodLabel=Custom&start=${fmt(dateFrom)}&end=${fmt(dateTo)} — this sets the date range via URL params, bypassing the MUI date picker entirely.\n`;
      userPrompt += `After page loads (wait 3s), verify the date filter chip shows "Custom ${fmtSlashUS(dateFrom)} - ${fmtSlashUS(dateTo)}".\n`;
      userPrompt += `Click Export button, then click SEND REPORT in the dialog to trigger email delivery. Output "REPORT_EMAILED" and stop.\n`;
      if (!dryRun) {
        userPrompt += `No webhook delivery needed — the report is emailed by dLocal directly.\n`;
      }
    } else if (partner.id === "unlimit") {
      userPrompt += `Date range: ${fmtSlash(dateFrom)} ~ ${fmtSlash(dateTo)} (${days} days)\n`;
      userPrompt += `TOTP: If Google Authenticator prompt appears, generate code with:\n`;
      userPrompt += `  node -e "const{TOTP}=require('otpauth');const t=new TOTP({secret:process.env.UNLIMIT_TOTP_SECRET});console.log(t.generate())"\n`;
      userPrompt += `  Then fill the code and check "trust for 15 days".\n`;
      userPrompt += `Navigate to Payments > All Payments. Set date filter to ${fmtSlash(dateFrom)} ~ ${fmtSlash(dateTo)}, confirm/apply, then refresh the table.\n`;
      userPrompt += `Export as CSV (NOT XLSX). Select ALL columns. Wait for download.\n`;
      if (dryRun) {
        userPrompt += `DRY RUN: Skip webhook. Output ONLY the file path, nothing else.\n`;
      } else {
        userPrompt += `Deliver: curl -X POST "${webhookUrl}" -F "file=@<path-to-csv>" -F "partner=${partner.id}" -H "Content-Type: multipart/form-data"\n`;
      }
    } else {
      userPrompt += `Date range: ${fmtSlash(dateFrom)} ~ ${fmtSlash(dateTo)} (${days} days)\n`;
      if (merchants.length > 0) {
        userPrompt += `Merchants: ${merchants.join(", ")}\n`;
      }
      if (dryRun) {
        userPrompt += `DRY RUN: Skip webhook. Output ONLY the file path, nothing else.\n`;
      } else {
        userPrompt += `Deliver: curl -X POST "${webhookUrl}" -F "file=@<path-to-csv>" -F "partner=${partner.id}" -H "Content-Type: multipart/form-data"\n`;
      }
    }
  } else if (taskName === "balances") {
    const merchants = task.merchants || [];
    if (partner.id === "doku") {
      userPrompt += `\n### PHASE 1: dashboard.doku.com\n`;
      userPrompt += `EMAIL OTP: After clicking MASUK, wait 10s, then run:\n`;
      userPrompt += `  npx tsx src/email-otp.ts\n`;
      userPrompt += `Fill the returned 6-digit code into the OTP input field and submit.\n`;
      userPrompt += `On the home page, find "Gross Volume" and "Next Payout".\n`;
      userPrompt += `NUMBER PARSING — apply to every extracted balance value:\n`;
      userPrompt += `  1. Strip currency labels (' IDR', ' Rp', etc.) and whitespace\n`;
      userPrompt += `  2. If both '.' and ',' are present: the RIGHTMOST one is the decimal separator\n`;
      userPrompt += `     → Split at the rightmost separator, discard the right side (decimal part)\n`;
      userPrompt += `     → Remove all remaining separators from the left (integer) part\n`;
      userPrompt += `  3. If only ',' is present and appears MORE THAN ONCE: thousand separators → remove all\n`;
      userPrompt += `  4. If only ',' appears ONCE: decimal separator → split, discard right side\n`;
      userPrompt += `  5. Apply same logic for '.' only\n`;
      userPrompt += `  Examples: "372,146,700 IDR" → 372146700 | "12.262.490.019,620000 IDR" → 12262490019\n`;
      userPrompt += `  balance_A = Gross Volume + Next Payout (if Next Payout present and non-zero, else balance_A = Gross Volume)\n`;
      userPrompt += `\n### PHASE 2: kirimdoku.com\n`;
      userPrompt += `Navigate to https://kirimdoku.com/v2/login\n`;
      userPrompt += `Login with same credentials: ${username} / ${password}\n`;
      userPrompt += `No OTP required. This is a traditional jQuery page (NOT a SPA) — wait for networkidle after each navigation.\n`;
      userPrompt += `On the home/dashboard page, find the "Credit Limit" section and extract the "Credit Left" value.\n`;
      userPrompt += `Apply the same NUMBER PARSING rules above to this value.\n`;
      userPrompt += `  balance_B = Credit Left\n`;
      userPrompt += `\n### AGGREGATION\n`;
      userPrompt += `  total_balance = balance_A + balance_B\n`;
      userPrompt += `Scrape date: ${fmt(dateTo)}\n`;
      userPrompt += `Output ONLY this JSON, nothing else:\n`;
      userPrompt += `{"scrape_date":"${fmt(dateTo)}","partner":"${partner.id}","balances":{"IDR":{"available":<total_balance>,"pending":0}}}\n`;
    } else {
      if (merchants.length > 0) {
        userPrompt += `Merchants: ${merchants.join(", ")}\n`;
      }
      userPrompt += `Scrape date: ${fmt(dateTo)}
Output ONLY this JSON, nothing else:
{"scrape_date":"${fmt(dateTo)}","partner":"${partner.id}","balances":{"<currency>":{"available":<n>,"pending":<n>},...}}
`;
    }
    if (dryRun) {
      userPrompt += `DRY RUN: Skip webhook.\n`;
    } else {
      userPrompt += `Deliver: Save to ${TMP_DIR}/${partner.id}_balances.json, then curl -X POST "${webhookUrl}" -H "Content-Type: application/json" -d @${TMP_DIR}/${partner.id}_balances.json\n`;
    }
  }

  return { systemPrompt, userPrompt };
}

export function buildFreeformPrompts(
  userInstruction: string,
  config: PartnerConfig | null,
  selectors: Record<string, string>,
  args: PromptArgs = {}
): SplitPrompt {
  const dryRun = args.dryRun ?? false;

  if (config) {
    const partner = config.partner;
    const creds = partner.credentials;
    const username = process.env[creds.username_env] || "";
    const password = process.env[creds.password_env] || "";

    const systemPrompt = buildSkillSystemPrompt(partner.id, selectors);

    let userPrompt = `Instruction: ${userInstruction}
Credentials: ${username} / ${password}
`;
    if (dryRun) {
      userPrompt += `DRY RUN: Do not deliver via webhooks.\n`;
    }

    return { systemPrompt, userPrompt };
  }

  // No partner — generic browser agent
  return {
    systemPrompt: `Browser automation agent. Use Playwright tools to complete the instruction. Output only result data.`,
    userPrompt: `Instruction: ${userInstruction}\n${dryRun ? "DRY RUN: Do not deliver via webhooks.\n" : ""}`,
  };
}
