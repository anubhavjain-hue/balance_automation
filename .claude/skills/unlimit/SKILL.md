---
name: unlimit
description: Navigate and interact with the Unlimit payment dashboard
disable-model-invocation: false
---

# Unlimit Dashboard

You are operating on the **Unlimit** payment dashboard via Playwright MCP.

## User's Request
$ARGUMENTS

## About

Unlimit (formerly Cardpay) is a global payment processor. Tazapay uses it for multi-currency card and alternative payment processing. The dashboard is an Angular SPA behind Keycloak SSO with mandatory Google Authenticator 2FA (trust device for 15 days after each TOTP entry).

Key capabilities: payment transaction export (CSV, 42 columns), settlement reporting, refund management.

## Dashboard Details

- **URL:** https://unlimit.com/ma-new/
- **Auth:** Keycloak SSO at `sso.unlimit.com` — username/password + Google Authenticator TOTP (2FA)
- **2FA Trust:** After entering TOTP, check "trust for 15 days" — subsequent logins skip 2FA for 15 days
- **Tech:** Angular SPA. Wait 3s after every navigation.
- **Credentials:** `.env` → `UNLIMIT_USERNAME`, `UNLIMIT_PASSWORD`, `UNLIMIT_TOTP_SECRET`
- **Session file:** `.tmp/unlimit-session.json` — persists Keycloak trust cookie (deterministic scripts)

## Dashboard Map

```
Sidebar
├── Home (#/home)                        — Overview: volume, approval rate, recent activity
├── Payments
│   ├── All Payments (#/payments/all)    — Full payment list; date/status/method filters; CSV export ✓ AUTOMATED
│   ├── Recurring (#/payments/recurring) — Subscription/recurring payment management
│   └── Disputes (#/payments/disputes)  — Chargeback/dispute tracking
├── Payouts (#/payouts)                  — Payout/settlement records and status
├── Reports (#/reports)                  — Pre-built report templates (settlements, reconciliation)
├── Invoices (#/invoices)                — Invoice generation and history
└── Settings (#/settings)               — Account settings, API keys, webhooks
```

**Automated:** Payments → All Payments export (`report`).

**Candidates for new processes:** Payouts (settlement records), Reports (reconciliation/settlement templates), Disputes (chargeback monitoring).

**Export details:** All Payments CSV has 42 columns; delimiter is `;` (semicolon, not comma); download lands in `.playwright-mcp/` during agent runs, in `downloadDir` during script runs.

## Login Procedure

1. Read `.env` for credentials
2. Navigate to https://unlimit.com/ma-new/ → redirects to `sso.unlimit.com` Keycloak login
3. Wait 3s for page to load
4. Fill Username and Password fields, click "Sign In"
5. Wait 3s — check if TOTP "OTP verification" page appears
6. **If TOTP prompt appears:**
   a. Generate TOTP code by running this Bash command:
      ```bash
      node -e "require('dotenv').config(); const { TOTP } = require('otpauth'); const totp = new TOTP({ issuer: 'Unlimit', algorithm: 'SHA1', digits: 6, period: 30, secret: process.env.UNLIMIT_TOTP_SECRET }); console.log(totp.generate())"
      ```
   b. Fill the TOTP code into the "One-time code" textbox
   c. Check "Trust my device" checkbox — **use JS click**: `document.getElementById('trustOtpDevice').click()` (overlay intercepts normal clicks)
   d. Click "Submit" button
7. **If no TOTP prompt** (trusted session): proceed directly
8. Wait 3-5s for dashboard to fully load
9. Dismiss popups in order: video dialog (X button) → "I have read and accept" → "I agree" (cookies)

## Selectors

Use these FIRST before taking screenshots.

| Name | Selector | Notes |
|------|----------|-------|
| login_username | role: `textbox[name=Username]` | Keycloak SSO login |
| login_password | role: `textbox[name=Password]` | Keycloak SSO login |
| login_submit | role: `button[name='Sign In']` | Keycloak SSO login |
| totp_input | role: `textbox[name='One-time code']` | OTP verification page |
| totp_trust_checkbox | `input#trustOtpDevice` | **Must use JS click** — overlay intercepts pointer |
| totp_submit | role: `button[name=Submit]` | OTP verification page |
| nav_payments | role: `link[name=Payments]` | Sidebar — navigates to #/payments/all |
| nav_all_payments | `a[href='#/payments/all']` | Submenu under Payments |
| filter_btn | role: `button[name=Filter]` | Opens query options panel |
| export_btn | role: `button[name=Export]` | Opens export dialog |
| refresh_btn | role: `button[name=Refresh]` | Refreshes table data |
| filter_confirm_btn | role: `button[name=Confirm]` | In date picker — confirms date |
| filter_apply_btn | role: `button[name=Apply]` | In filter panel — applies filters |
| export_xlsx_checkbox | `label:has(> :text('XLSX'))` | Click label to **deselect** XLSX (selected by default) |
| export_csv_checkbox | `label:has(> :text('CSV'))` | Click label to **select** CSV format |
| export_all_columns_btn | role: `button[name=All]` | Selects all 42 columns |
| cookie_agree_btn | role: `button[name='I agree']` | Cookie/privacy notice |
| data_notice_accept_btn | role: `button[name='I have read and accept']` | Data access notice |

## Common Tasks

### Export Transaction Report (CSV download)
1. Login (see Login Procedure above)
2. Click **Payments** in sidebar → lands on All Payments (`#/payments/all`)
3. Set date filter:
   - Click **Filter** button → opens "Query options" side panel
   - Click the **Date** section to expand date picker
   - Click the Start date textbox → calendar opens → select the start day
   - Click the End date textbox → calendar opens → select the end day
   - **Important:** Close calendar (Escape) before clicking Confirm if calendar overlays the button
   - Click **Confirm** → then click **Apply**
4. **Wait for table to load (retry-on-error pattern):**
   - After applying the filter, the table loads asynchronously. **Use a single `browser_wait_for` call with `time: 15`** (15 seconds) instead of polling with repeated snapshots — this saves tokens.
   - After the wait, take ONE snapshot to check the result:
     - **Success:** Table shows transaction rows → proceed to step 5
     - **Error:** Page shows "Unable to get data" or a red error/cross icon → click **Refresh** button and wait another 15s
   - **Max 3 retries.** If the table still fails after 3 Refresh attempts, output `ERROR: data_load_failed` and stop.
   - **Do NOT** take snapshots or screenshots while the page is loading. Only check ONCE after each 15s wait.
5. Click **Export** button on the toolbar (role: `button[name=Export]`) → export dialog opens
6. In the export dialog:
   a. **Deselect XLSX** — click the XLSX label/checkbox area to uncheck it (it is checked by default). The Export button will become disabled.
   b. **Select CSV** — click the CSV label/checkbox area to check it. The Export button re-enables.
   c. Click **All** button to select all 42 columns (default is 18)
   d. Click the **Export** button **inside the dialog** (NOT the toolbar one) → download starts
7. **Wait 10s** (`browser_wait_for` with `time: 10`) for the file to download. Playwright MCP saves it to `.playwright-mcp/` directory with the filename shown in the download event (e.g. `20260225_115315_orders_report.csv`).
8. **Post the file to webhook:**
    ```bash
    source .env
    # Playwright MCP saves downloads to .playwright-mcp/ directory
    CSV_FILE=$(ls -t .playwright-mcp/*orders_report*.csv 2>/dev/null | head -1)
    if [ -z "$CSV_FILE" ]; then echo "ERROR: no download found"; exit 1; fi
    echo "Posting: $CSV_FILE"
    curl -X POST "$UNLIMIT_REPORT_WEBHOOK_URL" -F "file=@$CSV_FILE" -H "Content-Type: multipart/form-data"
    ```

## Dashboard Quirks

- **Keycloak SSO:** Login page is at `sso.unlimit.com`, not on the main dashboard domain
- **TOTP trust checkbox:** Must use `document.getElementById('trustOtpDevice').click()` via JS — a `<div>` overlay intercepts normal Playwright clicks
- **Popups on first load:** Three popups appear after login: (1) video player dialog, (2) data access notice, (3) cookie/privacy notice. Dismiss in order.
- **Survey popup:** "Help us improve" / "Your opinion matters" popup appears periodically. The Dismiss button is often outside the viewport so normal Playwright click fails. **Use JS click:** `document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('Dismiss')) b.click() })`
- **Slow queries / data load errors:** The `/all_transactions` API frequently times out, especially for 7-day ranges. The page will show "Unable to get data" with an error/cross icon. Click Refresh and wait again. Use `browser_wait_for` with `time: 15` between attempts — do NOT poll with repeated snapshots. Max 3 retries before aborting.
- **Export format selection:** XLSX is checked by default. You must **deselect XLSX first** (Export button disables), then **select CSV** (Export button re-enables). If you only click CSV without deselecting XLSX, both formats will be checked.
- **Download location:** Playwright MCP saves downloads to `.playwright-mcp/` directory (NOT `~/Downloads/`). The filename is like `20260225_115315_orders_report.csv`. When only CSV is selected, the download is a plain CSV file (not a ZIP).
- **CSV delimiter is semicolon (`;`)** not comma — standard for European-style CSVs
- **All columns = 42:** Default export includes 18 columns; clicking "All" gives 42 columns
- **Buttons disable during load:** Filter, Export, Refresh, Customization buttons are disabled while the table loads. Wait for them to become enabled before clicking.
- **Large snapshots:** After applying a date filter, the table may have hundreds of rows, making `browser_snapshot` exceed token limits. If a snapshot is too large, do NOT retry it — the table loaded successfully. Proceed directly to clicking Export (ref stays the same: `button[name=Export]`).

## Execution Rules

- Login first, handle TOTP if prompted
- Try known selectors before screenshots (fast path)
- If a selector fails, screenshot → identify element → try new selector → save to `selectors/unlimit.json` if it works
- Wait 3s after any navigation or page-changing click
- **Token-saving waits:** When waiting for data to load (after filter apply or refresh), use `browser_wait_for` with `time: 15` instead of taking repeated snapshots. Only snapshot ONCE after the wait to check success/failure.
- If login fails: output `ERROR: login_failed` and stop
- If TOTP generation or entry fails: output `ERROR: 2fa_failed` and stop
- If table data fails to load after 3 Refresh retries: output `ERROR: data_load_failed` and stop
- Max 3 retries per selector — then output `ERROR: selector_failed:<name>` and stop

---

## Script Pattern (for `/write-script`)

Use this section when writing `scripts/unlimit/<task>.ts`.

### Import Block

```typescript
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { launchBrowser, saveSession, teardown } from '../../src/utils/browser.js';
import { deliverFile } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { generateTotp } from '../../src/utils/totp.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });

const SESSION_FILE = resolve(fileURLToPath(import.meta.url), '../../../.tmp/unlimit-session.json');
```

### Session Persistence + Login Flow

The Keycloak trust cookie survives for 15 days — always load it to skip TOTP re-entry:

```typescript
const { browser, context, page, downloadDir } = await launchBrowser('unlimit', TASK, {
  storageStatePath: SESSION_FILE,  // loads if exists, ignored if not
});

await page.goto('https://unlimit.com/ma-new/');
await page.waitForTimeout(3000);

// If redirected away from the dashboard, we need to login
if (!page.url().includes('unlimit.com/ma-new')) {
  await page.getByRole('textbox', { name: 'Username' }).fill(process.env.UNLIMIT_USERNAME!);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.UNLIMIT_PASSWORD!);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForTimeout(3000);

  // TOTP prompt (appears if session expired or first login)
  if (page.url().includes('sso.unlimit.com') && await page.getByRole('textbox', { name: 'One-time code' }).isVisible().catch(() => false)) {
    const code = generateTotp(process.env.UNLIMIT_TOTP_SECRET!);
    await page.getByRole('textbox', { name: 'One-time code' }).fill(code);
    // Trust checkbox MUST use JS click — div overlay intercepts pointer events
    await page.evaluate(() => document.getElementById('trustOtpDevice')?.click());
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForTimeout(3000);
  }

  // Save session after successful login (persists trust cookie for 15 days)
  await saveSession(context, SESSION_FILE);
}

// Dismiss popups (appear on first load or periodically)
try {
  await page.locator('[aria-label="Close"], button:has-text("×")').first().click({ timeout: 3000 });
} catch {}
try {
  await page.getByRole('button', { name: 'I have read and accept' }).click({ timeout: 3000 });
} catch {}
try {
  await page.getByRole('button', { name: 'I agree' }).click({ timeout: 3000 });
} catch {}
// Survey popup — use JS click (Dismiss button may be off-screen)
await page.evaluate(() => {
  document.querySelectorAll('button').forEach(b => {
    if (b.textContent?.includes('Dismiss')) b.click();
  });
});
```

### Export Report Flow

```typescript
// Navigate to All Payments
await page.getByRole('link', { name: 'Payments' }).click();
await page.waitForTimeout(1000);
await page.locator("a[href='#/payments/all']").click();
await page.waitForTimeout(3000);

// Set date filter
await page.getByRole('button', { name: 'Filter' }).click();
await page.waitForTimeout(1000);
// [expand Date section, pick start/end dates in calendar]
await page.getByRole('button', { name: 'Confirm' }).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Apply' }).click();

// Wait for table to load (retry up to 3 times)
for (let attempt = 0; attempt < 3; attempt++) {
  await page.waitForTimeout(15000);
  const hasError = await page.locator("text=Unable to get data").isVisible().catch(() => false);
  if (!hasError) break;
  if (attempt === 2) throw new Error('data_load_failed');
  await page.getByRole('button', { name: 'Refresh' }).click();
}

// Export as CSV (deselect XLSX first, then select CSV)
await page.getByRole('button', { name: 'Export' }).click();
await page.waitForTimeout(1000);
await page.locator("label:has(> :text('XLSX'))").click();  // deselect XLSX
await page.waitForTimeout(500);
await page.locator("label:has(> :text('CSV'))").click();   // select CSV
await page.getByRole('button', { name: 'All' }).click();   // all 42 columns

// Wait for download event BEFORE clicking Export in dialog
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('.cdk-overlay-container button:has(> :text("Export"))').click(),
]);
await page.waitForTimeout(10000);  // let file fully write to disk
const csvPath = await download.path();
```

### Timing Requirements

- `waitForTimeout(3000)` after every navigation (Angular SPA)
- `waitForTimeout(15000)` while waiting for table data (not polling — single wait)
- `waitForTimeout(10000)` after download event fires (let file fully write)
- Never use `waitUntil: 'networkidle'` — Angular SPA never settles

### Delivery

```typescript
await deliverFile(process.env.UNLIMIT_REPORT_WEBHOOK_URL!, csvPath!, 'text/csv', log);
```

### `.gitignore` addition needed

`.tmp/unlimit-session.json` must be excluded from git (contains auth cookies).
