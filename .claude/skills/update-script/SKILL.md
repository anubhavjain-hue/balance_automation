# /update-script — Deterministic Playwright Script Updater

Diagnose, repair, and re-verify an existing automation script when a dashboard changes or the script starts failing.

**Usage:** `/update-script <partner-id> <task-name> <description-of-change-or-failure>`
**Examples:**
```
/update-script doku balances "Login form changed — email field selector no longer works"
/update-script total-processing balances "Dashboard redesign — balance card moved to new layout"
/update-script dlocal report "Date picker component replaced with a new calendar widget"
```

---

## When to Use This (vs `/write-script`)

| Situation | Use |
|-----------|-----|
| Script exits 1 / selector timeout | `/update-script` |
| Dashboard UI redesigned | `/update-script` |
| New login flow (TOTP added, OTP flow changed) | `/update-script` |
| New field to extract or webhook format change | `/update-script` |
| Cloudflare now blocking a previously working TypeScript script | `/update-script` (migrate to Python/camoufox — see below) |
| Script doesn't exist yet | `/write-script` |
| Adding a completely new task for an existing partner | `/write-script` |

---

## Step 1 — Load Full Context

Read all four sources before touching a browser:

```
scripts/<partner-id>/<task-name>.ts       → the current script (read every line)
partners/<partner-id>.yaml                → dashboard URL, credentials, task definition
.claude/skills/<partner-id>/SKILL.md      → login procedure, known selectors, quirks
selectors/<partner-id>.json               → known selectors with confidence scores
```

From the script, identify:
- Every selector used (CSS, XPath, role-based)
- Every timing assumption (`waitForTimeout` values)
- The login flow and any special handling (JS clicks, try/catch blocks)
- The exact line(s) most likely related to the reported failure

---

## Step 2 — Reproduce the Failure

Run the current script as-is and capture the exact error:

```bash
npx tsx scripts/<partner-id>/<task-name>.ts 2>&1
```

Note:
- The **exact error message** and stack trace
- Which log line was last emitted before failure
- The **timeout value** that expired (helps pinpoint the selector)

If the error is a `TimeoutError: locator.waitFor`, the selector at that line is broken.
If the error is a navigation/URL check, the login flow changed.
If the error is a delivery failure, the webhook or payload format changed.

---

## Step 3 — Live Investigation

Open the dashboard and walk through only the **broken section** identified in Step 2.

### For broken selectors:
1. Navigate to the page where the failure occurs
2. Take a `browser_snapshot` — do NOT take a screenshot first
3. Search the snapshot for the expected content (e.g. "Jumlah Bruto", "Sign in", balance value)
4. If found: note the new surrounding structure, derive the updated selector
5. If not found: the page may have changed navigation — take a `browser_take_screenshot` to see the visual state

### For broken login flows:
1. Navigate to the login URL
2. Walk through each step: fill email, fill password, submit
3. Note any new steps (CAPTCHA, new MFA method, new redirect URL)
4. Check if OTP mechanism changed (email → TOTP, single input → 6-box, etc.)

### For layout/structure changes:
1. Snapshot the relevant page section
2. Find the target data in the new structure
3. Derive the minimal selector change needed

**Only investigate what's broken.** Do not re-verify working parts of the script.

---

## Step 4 — Identify the Minimal Change

Before editing, state clearly:

```
BROKEN: <what is failing and why>
FIX:    <the minimal change needed>
LINES:  <line numbers in the script to change>
```

Examples:
```
BROKEN: input[type='email'] not found — field now renders as type='text' on this browser
FIX:    Change selector to "input[type='email'], input[type='text']" with .first()
LINES:  scripts/doku/balances.ts:71

BROKEN: .balance-amount selector returns null — card moved inside a new wrapper div
FIX:    Update XPath to new parent structure: //div[@class='new-wrapper']//span[@class='amount']
LINES:  scripts/total-processing/balances.ts:94

BROKEN: KirimDOKU submit click throws immediately — button changed from input#start to button#submit
FIX:    Change getElementById('start') to getElementById('submit')
LINES:  scripts/doku/balances.ts:157
```

Make the smallest possible change. Do not refactor working code.

---

## Step 5 — Apply the Fix

Edit only the identified lines. Use the `Edit` tool for surgical changes.

**Rules:**
- Change selectors, timing, or structure only where broken
- Do not touch working login/extract/deliver code unless it's part of the failure
- If a timing value needs increasing, add 2–3s at a time — do not jump to 30s
- If a selector needs updating, use the most specific stable selector found in the snapshot
- Preserve all existing error handling, try/catch blocks, and logging

---

## Step 6 — Re-run and Verify

```bash
npx tsx scripts/<partner-id>/<task-name>.ts 2>&1
```

Check:
- Exit code 0
- `{"level":"info","msg":"completed",...}` in stdout
- Correct values in the log (spot-check the extracted numbers/data)
- Webhook delivery confirmed

If it fails again:
1. Read the new error — it may be a different broken selector downstream
2. Return to Step 3 for the new failure point
3. Apply another targeted fix
4. Re-run

**Maximum 5 fix iterations.** If still failing after 5, take a full screenshot and snapshot of the failure point and re-examine the entire flow from scratch.

---

## Step 7 — Update Selectors File

For every selector that changed:

```json
"selector_name": {
  "selector": "<new selector>",
  "source": "script_verified",
  "confidence": 1.0,
  "last_verified": "YYYY-MM-DDTHH:MM:SSZ",
  "notes": "<what changed and why>"
}
```

Mark any selectors that are now **stale** with `"confidence": 0.0` and a note explaining they no longer work.

---

## Step 8 — Update Partner SKILL.md

**This step is mandatory regardless of how small the fix was.** Every update run adds knowledge — that knowledge must be persisted so future runs don't rediscover the same issues.

Open `.claude/skills/<partner-id>/SKILL.md` and update:

1. **Selectors table** — replace stale selectors with confirmed ones; mark removed selectors as deprecated with a note
2. **Login Procedure** — update any steps that changed
3. **Dashboard Quirks** — add a new dated entry describing what changed and the fix. Format:
   ```
   - **[YYYY-MM-DD] <what changed>** — <old behaviour>. Now: <new behaviour and fix>.
   ```
4. **Script Pattern** — update code snippets so they match the now-verified script exactly
5. **Timing Requirements** — update any wait values that had to be adjusted

The SKILL.md is the source of truth for future `/write-script` and `/update-script` runs. If a fix isn't recorded here, the next agent will make the same mistake.

---

## Step 9 — Commit the Changes

Stage and commit only the files that changed:

```bash
git add scripts/<partner-id>/<task-name>.ts selectors/<partner-id>.json .claude/skills/<partner-id>/SKILL.md
git commit -m "fix(<partner-id>/<task-name>): <one-line description of what broke and how it was fixed>"
```

---

## Output

When done, say:
```
Script updated and verified: scripts/<partner-id>/<task-name>.ts
Fix: <one-line description of what broke and how it was fixed>
Selectors updated: selectors/<partner-id>.json
SKILL.md updated: .claude/skills/<partner-id>/SKILL.md  ← always required
```

---

## Common Failure Patterns

| Error | Likely Cause | Investigation |
|-------|-------------|---------------|
| `locator.waitFor: Timeout` | Selector changed or page not loaded | Snapshot the page, find new selector |
| `locator.fill: Timeout` | Input field not found | Check input type, role, placeholder |
| `login_failed: still not on dashboard` | OTP flow changed, submit failed silently | Walk through login step by step |
| `otp_fetch_failed` | OTP email sender or subject changed | Check email-otp.ts DOKU_SENDER constant |
| `kirimdoku_login_failed` | Session lock longer than 2 min, or login URL changed | Increase wait time, check for new redirect |
| `Webhook POST failed: 4xx` | Payload format changed or webhook URL rotated | Check delivery section, verify webhook URL in .env |
| Page renders blank / all timeouts | IP block, Cloudflare, or login session invalid | Screenshot the page, check for block pages |
| Numbers parse to 0 | Currency format changed on dashboard | Snapshot the value, update parseIndonesianNumber or extract logic |
| `cloudflare_blocked` / login form never appears (TypeScript script) | Cloudflare Bot Management blocking headless Chromium | Migrate script to Python/camoufox (see below) |

---

## Cloudflare Block — Migration to Python/camoufox

If a TypeScript script fails because Cloudflare blocks the headless browser (login form never loads, URL stays on the dashboard root, or you see a Cloudflare challenge page in a screenshot):

**Do not** try to fix it by adding more delays or changing Chromium flags. **Migrate to Python/camoufox instead.**

### Migration steps

1. **Check prerequisites** (run once per machine):
   ```bash
   pip3 install camoufox
   python3 -m camoufox fetch
   ```

2. **Create `scripts/<partner-id>/<task-name>.py`** using the Python/camoufox template from `write-script` SKILL.md (Step 4-Python). Port the logic from the existing `.ts` file:
   - `page.goto()` → `await page.goto()` (same Playwright API, Python async)
   - `page.waitForTimeout(ms)` → `await page.wait_for_timeout(ms)`
   - `page.getByRole(...)` → `page.get_by_role(...)` (snake_case)
   - `page.evaluate(() => {...})` → `await page.evaluate("""() => {...}""")`
   - `process.env.X` → `os.environ["X"]`
   - Webhook delivery → `urllib.request` (no extra deps)

3. **Delete the old `.ts` file** once the Python script is verified.

4. **Update `partners/<partner-id>.yaml`**:
   ```yaml
   scripts:
     <task-name>: "scripts/<partner-id>/<task-name>.py"
     runtime: python3
     notes: "Uses camoufox (headless Firefox) to bypass Cloudflare bot protection"
   ```

5. **Run and verify**:
   ```bash
   python3 scripts/<partner-id>/<task-name>.py
   ```
   Confirm exit 0, `[info] completed`, and webhook delivery.

6. **Update the partner SKILL.md** — add a quirk entry:
   ```
   - **[YYYY-MM-DD] Cloudflare blocks headless Chromium** — TypeScript/playwright-extra script timed out on login form. Migrated to Python/camoufox (scripts/<partner>/<task>.py).
   ```
