# /write-script — Deterministic Playwright Script Writer

Write, live-test, and verify a deterministic TypeScript Playwright automation script for a partner dashboard task.

**Usage:** `/write-script <partner-id> <task-name>`
**Example:** `/write-script total-processing balances`

---

## What This Produces

A TypeScript file at `scripts/<partner-id>/<task-name>.ts` that:
- Runs headlessly via `npx tsx scripts/<partner-id>/<task-name>.ts`
- Exits `0` on success, `1` on any failure
- Handles the full flow: login → navigate → extract/download → deliver
- Is the primary execution path (no AI needed at runtime)

---

## Step 1 — Load Context

Read these files before touching a browser:

```
partners/<partner-id>.yaml        → dashboard URL, credentials env vars, task definition
.claude/skills/<partner-id>/SKILL.md  → login procedure, known selectors, quirks
selectors/<partner-id>.json       → known CSS selectors with confidence scores
```

If a script already exists at `scripts/<partner-id>/<task-name>.ts`, read it too — you may be repairing rather than writing from scratch.

---

## Step 2 — Live Exploration (required before writing)

Open the actual dashboard using the partner's real credentials from `.env`.

Walk through the exact task flow step by step:

For each action (click, fill, navigate, extract):
1. Try the known selector from `selectors/<partner-id>.json`
2. If it works → mark it **confirmed**
3. If it fails → take a screenshot (`browser_take_screenshot`), identify the element visually, find the correct selector
4. Record every confirmed selector in **Playwright locator form** (not raw CSS):
   - `page.locator('#username')` not `#username`
   - `page.getByRole('button', { name: 'Login' })` when appropriate

Pay special attention to:
- Timing: does the page need a wait after navigation? (SPAs always do)
- Auth branches: TOTP prompt — does it appear or is there a saved session?
- Optional elements: popups, cookie banners, survey modals — wrap in `try/catch`
- Downloads: note which click triggers the download event
- Readonly inputs: can they be typed into directly, or does `removeAttribute('readonly')` need calling first?

---

## Step 3 — Map the Full Flow

Before writing code, write pseudocode of the complete sequence, including all branches:

```
navigate(dashboard_url)
waitForTimeout(3000)          // SPA settle
[if cloudflare] waitForTimeout(8000)

// Auth
fill(username_selector, USERNAME)
fill(password_selector, PASSWORD)
click(submit_selector)
waitForTimeout(3000)
[if TOTP prompt visible] {
  generate totp code
  fill(totp_input, code)
  [if trust checkbox] page.evaluate(() => el.click())
  click(totp_submit)
  waitForTimeout(3000)
}

// Task
...
```

---

## Step 3b — Cloudflare Check

Before writing the script, determine if the partner uses Cloudflare bot protection:

- Check the partner YAML for `cloudflare_wait_ms` or Cloudflare notes in the SKILL.md
- Or open the dashboard and check whether the first navigation stays on the dashboard URL (Cloudflare present) vs redirecting directly to the login form

**If Cloudflare is present → write Python with camoufox (Step 4-Python below).**
**If no Cloudflare → write TypeScript (Step 4-TypeScript below).**

Known partners by runtime:
| Partner | Runtime | Reason |
|---------|---------|--------|
| dLocal | Python/camoufox | Cloudflare Bot Management blocks headless Chromium |
| DOKU | TypeScript | No Cloudflare |
| Total Processing | TypeScript | No Cloudflare |
| Unlimit | TypeScript | No Cloudflare |

---

## Step 4-TypeScript — Write the Script (no Cloudflare)

Create `scripts/<partner-id>/<task-name>.ts`.

**Standard template:**

```typescript
#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson, deliverFile } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { notifySlackError } from '../../src/utils/slack.js';
// [DOKU only]    import { fetchOtp } from '../../src/email-otp.js';
// [Unlimit only] import { generateTotp } from '../../src/utils/totp.js';
// [Unlimit only] import { saveSession } from '../../src/utils/browser.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });

const PARTNER = '<partner-id>';
const TASK = '<task-name>';
const log = createLogger(PARTNER, TASK);

async function main(): Promise<void> {
  const { browser, context, page, downloadDir } = await launchBrowser(PARTNER, TASK, {
    // [Unlimit only] storageStatePath: resolve(..., '.tmp/unlimit-session.json'),
  });

  try {
    log.info('starting');

    // --- LOGIN ---
    // [steps here]

    // --- TASK ---
    // [steps here]

    // --- DELIVER ---
    // result MUST include scrape_timestamp (full ISO 8601) — never date-only
    // deliverJson(url, result, log, PARTNER) automatically prepends { partner: PARTNER, ...result }
    await deliverJson(process.env.PARTNER_WEBHOOK_URL!, result, log, PARTNER);
    // OR: await deliverFile(process.env.PARTNER_REPORT_WEBHOOK_URL!, csvPath, 'text/csv', log, PARTNER);

    log.info('completed');
    process.exit(0);
  } catch (err) {
    log.error('failed', { error: String(err) });
    await notifySlackError(PARTNER, TASK, err);
    process.exit(1);
  } finally {
    await teardown(browser);
  }
}

main();
```

**Hard rules for the script body:**

| Rule | Why |
|------|-----|
| Never use `waitUntil: 'networkidle'` on SPAs | Vuetify/MUI/Angular never reach networkidle |
| Always `page.waitForTimeout(3000)` after `page.goto()` on SPAs | SPA JS hydration delay |
| Wrap optional elements (`try/catch`) | Popups appear unpredictably |
| Downloads: `page.waitForEvent('download')` BEFORE the click | Race condition otherwise |
| Readonly inputs: `page.evaluate(() => el.removeAttribute('readonly'))` first | Direct fill silently fails |
| JS-only clicks: `page.evaluate(() => el.click())` | Overlay intercepts pointer events |
| TOTP trust checkbox (Unlimit): `page.evaluate(() => document.getElementById('trustOtpDevice')?.click())` | `<div>` overlay blocks normal click |
| Session persistence (Unlimit): `saveSession(context, path)` after login | Avoids TOTP every run |
| DOKU number parsing: use the `parseIndonesianNumber()` helper (see DOKU SKILL.md) | Mixed IDR format |
| Always include `scrape_timestamp: new Date().toISOString()` in result (never date-only) | Webhook receiver needs exact time, not just date |
| Always pass `PARTNER` as 4th arg to `deliverJson` | Prepends `{ partner: "..." }` to every webhook payload |
| Always call `await notifySlackError(PARTNER, TASK, err)` in the `catch` block before `process.exit(1)` | Sends a Slack message to the ops channel (via `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID`) with provider, process, error, and timestamp |

---

## Step 4-Python — Write the Script (Cloudflare present)

Create `scripts/<partner-id>/<task-name>.py`.

Use camoufox (headless Firefox with anti-fingerprinting). **Do not use playwright-extra/Chromium for Cloudflare-protected dashboards** — it will be blocked regardless of the stealth plugin.

**Prerequisites** (already installed globally):
```bash
pip3 install camoufox        # if not already installed
python3 -m camoufox fetch    # downloads Firefox binary (one-time)
```

**Standard Python/camoufox template:**

```python
#!/usr/bin/env python3
"""
<Partner> <task> scraper using camoufox (Firefox + anti-fingerprinting).
Run: python3 scripts/<partner-id>/<task-name>.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from datetime import date

# Load .env
env_path = Path(__file__).parents[2] / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from camoufox.async_api import AsyncCamoufox


async def main() -> None:
    username = os.environ["<PARTNER>_USERNAME"]
    password = os.environ["<PARTNER>_PASSWORD"]
    webhook_url = os.environ.get("<PARTNER>_WEBHOOK_URL")

    print("[info] starting with camoufox")

    async with AsyncCamoufox(headless=True) as browser:
        page = await browser.new_page()
        page.set_default_timeout(90000)

        # --- LOGIN ---
        print("[info] navigating to dashboard")
        await page.goto("<dashboard_url>", wait_until="domcontentloaded")
        await page.wait_for_timeout(15000)  # Cloudflare → login redirect

        current_url = page.url
        print(f"[info] url after cloudflare wait: {current_url}")

        try:
            await page.get_by_role("textbox", name="Email").fill(username)
            await page.get_by_role("button", name="CONTINUE").click()
            await page.wait_for_timeout(3000)
        except Exception as e:
            print(f"[error] cloudflare_blocked — login form not reached: {e}", file=sys.stderr)
            screenshot = Path(__file__).parents[2] / ".tmp/<partner>_blocked.png"
            screenshot.parent.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(screenshot))
            print(f"[info] screenshot saved: {screenshot}")
            sys.exit(1)

        await page.get_by_role("textbox", name="Password").fill(password)
        await page.get_by_role("button", name="CONTINUE").click()
        await page.wait_for_timeout(4000)

        if "<dashboard_hostname>" not in page.url:
            print(f"[error] login_failed — url: {page.url}", file=sys.stderr)
            sys.exit(1)

        print("[info] logged_in")

        # --- TASK ---
        # [steps here]

        # --- DELIVER ---
        result = { "partner": "<partner-id>", "scrape_timestamp": datetime.now(timezone.utc).isoformat(), ... }
        # import: from datetime import datetime, timezone
        print(f"[info] result: {json.dumps(result, indent=2)}")

        if webhook_url:
            import urllib.request
            req = urllib.request.Request(
                webhook_url,
                data=json.dumps(result).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"[info] webhook delivered — status {resp.status}")

        print("[info] completed")


asyncio.run(main())
```

**Hard rules for Python/camoufox scripts:**

| Rule | Why |
|------|-----|
| `wait_until="domcontentloaded"` not `networkidle` | SPAs never reach networkidle |
| `await page.wait_for_timeout(15000)` after first nav | Cloudflare challenge + redirect takes 10-15s |
| Wrap login form fill in `try/except` with screenshot on failure | Detect Cloudflare block early with evidence |
| Use `page.get_by_role()` / `page.locator()` same as Playwright Python | camoufox exposes full Playwright Page API |
| `page.evaluate("""() => { ... }""")` for JS extraction | Triple-quoted string avoids JS quote escaping |
| No external dependencies — use `urllib.request` for webhook delivery | Keeps the script self-contained |
| Always include `"partner"` and `"scrape_timestamp"` in result payload | Webhook receiver needs to identify source and exact time; use full ISO 8601 (`datetime.now(timezone.utc).isoformat()`) — never date-only |

**Update partners YAML after writing:**
```yaml
scripts:
  <task-name>: "scripts/<partner-id>/<task-name>.py"
  runtime: python3
  notes: "Uses camoufox (headless Firefox) to bypass Cloudflare bot protection"
```

---

## Step 5 — Run and Verify

```bash
# TypeScript
npx tsx scripts/<partner-id>/<task-name>.ts

# Python/camoufox
python3 scripts/<partner-id>/<task-name>.py
```

Check:
- Exit code 0
- Log line `{"level":"info","msg":"completed",...}` in stdout
- Delivery confirmed (check webhook endpoint received data)

If it fails:
1. Read the error from stderr
2. Take a screenshot at the point of failure if browser-related
3. Fix the specific line
4. Re-run (up to 5 iterations)

Do not move on until exit code is 0 and delivery is confirmed.

---

## Step 6 — Update Selectors

For every selector you confirmed or discovered during live exploration:

Update `selectors/<partner-id>.json` with:
```json
"selector_name": {
  "selector": "...",
  "source": "script_verified",
  "confidence": 1.0,
  "last_verified": "YYYY-MM-DDTHH:MM:SSZ",
  "notes": "..."
}
```

---

## Step 7 — Update Partner YAML

Add to `partners/<partner-id>.yaml` under `scripts:`:
```yaml
scripts:
  <task-name>: "scripts/<partner-id>/<task-name>.ts"
```

---

## Step 8 — Update Partner SKILL.md

**This step is mandatory.** The SKILL.md is the living knowledge base for the partner — it must reflect everything learned during live exploration and script verification.

Open `.claude/skills/<partner-id>/SKILL.md` and update:

- **Selectors table** — add or correct any selector that was confirmed, changed, or discovered
- **Login Procedure** — correct any steps that differed from what was documented (e.g. button needs JS click, OTP has 6 boxes not 1)
- **Dashboard Quirks** — add a new entry for every non-obvious behaviour encountered (overlays, hidden iframes, auto-submit, session conflicts, type mismatches)
- **Script Pattern section** — update code snippets to match what actually worked in the verified script
- **Timing Requirements** — update any wait values that had to be changed from the defaults

The goal: the next time someone writes or updates a script for this partner, the SKILL.md alone should be sufficient to get it right without rediscovering the same issues.

---

## Output

When done, say:
```
Script written and verified: scripts/<partner-id>/<task-name>.ts
Selectors updated: selectors/<partner-id>.json
SKILL.md updated: .claude/skills/<partner-id>/SKILL.md
```
