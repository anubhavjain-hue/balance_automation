---
name: total-processing
description: Navigate and interact with the Total Processing (Nomupay) dashboard
disable-model-invocation: false
---

# Total Processing Dashboard

You are operating on the **Total Processing (Nomupay)** payment dashboard via Playwright MCP.

## User's Request
$ARGUMENTS

## About

Total Processing (operating as **Nomupay**) is a UK-based payment gateway. Tazapay uses it for EU and HK merchant accounts — **Tazapay - EU** and **Tazapay - HK**. The dashboard is a Vuetify SPA hosted on Keycloak SSO.

Key capabilities: transaction reporting (CSV export), merchant funding/balance tracking, payout scheduling.

## Dashboard Details

- **URL:** https://dashboard.totalprocessing.com/
- **Auth:** Keycloak SSO
- **Tech:** Vuetify SPA — NEVER use `networkidle` (it never settles). Wait 3s after every navigation.
- **Credentials:** `.env` → `TP_USERNAME` and `TP_PASSWORD`
- **Webhook:** `.env` → `BALANCES_WEBHOOK_URL`
- **Accounts:** Tazapay - EU, Tazapay - HK (selected via merchant autocomplete)

## Dashboard Map

```
Sidebar
├── Dashboard (/)                    — Overview stats, recent transactions
├── Transactions (/transactions)     — Full transaction list; date filter; CSV export (ALL COLUMNS)
├── Finance
│   └── Merchant Funding (Beta)      — /finance/merchant-funding-embed (Retool iframe)
│       ├── PROCESSING tab           — Total GMV (EUR-converted), transaction list
│       ├── SCHEDULED tab            — Pending bank clearance + scheduled merchant funding per currency
│       ├── FUNDED tab               — Funded history
│       └── RESERVE tab              — Latest reserve balance
├── Reports                          — Pre-built report templates
├── Users                            — User management
├── Credentials                      — API credentials
└── Settings                         — Account settings
```

**Automated:** Transactions → CSV export (`report`), Finance → Merchant Funding → Balances (`balances`).

## Login Procedure

1. Read `.env` for credentials
2. Navigate to https://dashboard.totalprocessing.com/ with `waitUntil: 'domcontentloaded'`
3. Wait 3s for Keycloak redirect
4. Fill `#username`, fill `#password`, click `#kc-login`
5. Wait 4s for SPA to load
6. Dismiss Shepherd.js popup — click `.shepherd-cancel-icon` (or `.button-skip`, `.button-secondary`) with 5s timeout; ignore if absent
7. **Force-remove any lingering overlay scrim** (Shepherd's scrim blocks all clicks):
   ```typescript
   await page.evaluate(() => {
     document.querySelectorAll('.v-overlay--active').forEach((el) => el.remove());
   });
   ```

## Selectors

Use these FIRST before taking screenshots.

| Name | Selector / Playwright Locator | Notes |
|------|-------------------------------|-------|
| login_username | `#username` | Keycloak login |
| login_password | `#password` | Keycloak login |
| login_submit | `#kc-login` | Keycloak login |
| shepherd_dismiss | `.shepherd-cancel-icon, .button-skip, .button-secondary` | Onboarding popup — always try, scrim blocks clicks if not dismissed |
| overlay_scrim | `.v-overlay--active` | JS-remove if Shepherd dismiss fails |
| nav_finance | `getByRole('button', { name: 'Finance' })` | Sidebar nav — role=button NOT v-list-group |
| nav_merchant_funding | `getByRole('link', { name: 'Merchant Funding (Beta)' })` | Shown after Finance expands |
| merchant_input | `getByRole('textbox', { name: 'Merchant' })` | Autocomplete — type name, wait 1.5s |
| merchant_option_eu | `getByRole('option', { name: 'Tazapay - EU' })` | |
| merchant_option_hk | `getByRole('option', { name: 'Tazapay - HK' })` | |
| merchant_clear | `getByRole('button', { name: 'clear icon' })` | |
| retool_iframe | `page.frameLocator('iframe[title="Retool Embed"]')` | All Merchant Funding content |
| tab_processing | `retoolFrame.getByTestId('tabs2--0').getByTestId('Tabs::Tab::0')` | Scope to tabs2--0! |
| tab_scheduled | `retoolFrame.getByTestId('tabs2--0').getByTestId('Tabs::Tab::1')` | Scope to tabs2--0! |
| tab_reserve | `retoolFrame.getByTestId('tabs2--0').getByTestId('Tabs::Tab::3')` | Scope to tabs2--0! |
| processing_gmv_label | `retoolFrame.getByText('TOTAL GROSS TRANSACTION VALUE', { exact: true })` | Value in nextElementSibling |
| scheduled_nested_iframe | `retoolFrame.frameLocator('[data-testid="CustomComponentIframe::scheduled_component"]')` | Nested iframe for SCHEDULED |
| pending_label | `scheduledFrame.getByText('PENDING BANK CLEARANCE', { exact: true })` | |
| funding_label | `scheduledFrame.getByText('SCHEDULED MERCHANT FUNDING', { exact: true })` | |
| reserve_text | `retoolFrame.locator('p:has-text("Balance:")')` | "Balance: EUR 100,001.00" |
| nav_transactions | `a[href="/transactions"]` | Direct sidebar link |
| download_btn | `button[data-test-id="download-report-btn"]` | Downloads report |
| csv_all_columns | `text=/CSV.*ALL COLUMNS/i` | Format option in download dialog |

## Known Merchants

- Tazapay - EU (UUID: 995f123c-e61f-46bd-8061-5e32161997c4)
- Tazapay - HK (UUID: 2b4f7fba-3001-4ee9-b745-2034b20bc53b)

## Common Tasks

### Check Balances (→ `scripts/total-processing/balances.ts`)
1. Login → dismiss Shepherd popup → remove overlay scrim
2. Click Finance button → click Merchant Funding (Beta)
3. For each merchant [EU, HK]:
   a. Type "Tazapay" in merchant input, wait 1.5s, click option
   b. Wait for Retool iframe (poll GMV element until non-empty, up to 20s)
   c. **PROCESSING**: read `TOTAL GROSS TRANSACTION VALUE` nextElementSibling → "EUR 180,145.24"
   d. **SCHEDULED**: click tab (tabs2--0 > Tabs::Tab::1), wait 3s for nested iframe, read pending + scheduled funding totals
   e. **RESERVE**: click tab (tabs2--0 > Tabs::Tab::3), read `p:has-text("Balance:")` → "Balance: EUR 100,001.00"
   f. Clear merchant
4. Aggregate and POST to `BALANCES_WEBHOOK_URL`

### Download Transaction Report (→ `scripts/total-processing/report.ts`)
1. Login → dismiss Shepherd popup → remove overlay scrim
2. Click Transactions nav link
3. Set date range: remove `readonly` via JS, fill as `DD/MM/YYYY ~ DD/MM/YYYY`, press Enter
4. Wait 3s for filtered data
5. Click download button → click "CSV (ALL COLUMNS)"
6. POST file to `TP_REPORT_WEBHOOK_URL`

## Dashboard Quirks

- **Shepherd.js popup + scrim**: After login, a Shepherd.js tour popup appears. Its `v-overlay__scrim` overlay blocks ALL pointer events on the page. You must dismiss the popup AND then force-remove `.v-overlay--active` elements via JS. Do this before any navigation click.
- **Finance nav is a button (not v-list-group)**: `getByRole('button', { name: 'Finance' })` — the old `.v-list-group__header` selector is WRONG.
- **Merchant Funding renamed**: Now "Merchant Funding (Beta)" at `/finance/merchant-funding-embed`, not `/finance/merchant-funding/balances`.
- **Retool iframe**: All Merchant Funding content is inside `iframe[title="Retool Embed"]`. Use `page.frameLocator()`.
- **Two tabsets inside Retool**: `tabs2--0` = main PROCESSING/SCHEDULED/FUNDED/RESERVE tabs; `tabs1--0` = transaction type filter (ALL/SALE/REFUND). Always scope tab clicks to `tabs2--0`.
- **SCHEDULED tab = nested iframe**: The SCHEDULED tab content lives inside a second iframe (`[data-testid="CustomComponentIframe::scheduled_component"]`) inside the Retool iframe. Two iframes exist in the Retool frame — using `frameLocator('iframe')` without scoping causes strict mode violation.
- **GMV data loads asynchronously**: After selecting a merchant, the Retool app fires API calls. The GMV value appears as "EUR 0" for 2-8 seconds before real data arrives. Always poll until the value is non-zero (up to 20 iterations × 1s).
- **Date inputs are readonly**: Must remove `readonly` attribute via `browser_evaluate` before filling.
- **Merchant autocomplete**: Type name, wait 1.5s for suggestions, click the option by role.

## Execution Rules

- Login first before any interaction
- Try known selectors before screenshots (fast path)
- If a selector fails, screenshot → identify element → try new selector → save to `selectors/total-processing.json` if it works
- Wait 3s after any navigation or page-changing click
- If login fails: output `ERROR: login_failed` and stop
- Max 3 retries per selector — then output `ERROR: selector_failed:<name>` and stop

---

## Script Pattern (for `/write-script`)

Use this section when writing `scripts/total-processing/<task>.ts`.

### Import Block

```typescript
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson, deliverFile } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { notifySlackError } from '../../src/utils/slack.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });
```

### Login + Popup Dismissal (confirmed pattern)

```typescript
await page.goto('https://dashboard.totalprocessing.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

await page.locator('#username').fill(process.env.TP_USERNAME!);
await page.locator('#password').fill(process.env.TP_PASSWORD!);
await page.locator('#kc-login').click();
await page.waitForTimeout(4000);

// Dismiss Shepherd popup (scrim blocks all clicks if not dismissed)
try {
  await page.locator('.shepherd-cancel-icon, .button-skip, .button-secondary').first().click({ timeout: 5000 });
  await page.waitForTimeout(1000);
} catch { /* not present */ }

// Force-remove any lingering Vuetify overlay scrim
await page.evaluate(() => {
  document.querySelectorAll('.v-overlay--active').forEach((el) => el.remove());
});
await page.waitForTimeout(500);
```

### Navigate to Merchant Funding

```typescript
await page.getByRole('button', { name: 'Finance' }).click();
await page.waitForTimeout(1000);
await page.getByRole('link', { name: 'Merchant Funding (Beta)' }).click();
await page.waitForTimeout(3000);
```

### Select Merchant + Poll for GMV

```typescript
// Select merchant
await page.getByRole('textbox', { name: 'Merchant' }).fill('Tazapay');
await page.waitForTimeout(1500);
await page.getByRole('option', { name: 'Tazapay - EU' }).click();
await page.waitForTimeout(3000);

const retoolFrame = page.frameLocator('iframe[title="Retool Embed"]');

// Wait for GMV to populate (Retool API takes 2-8s)
const gmvLabel = retoolFrame.getByText('TOTAL GROSS TRANSACTION VALUE', { exact: true });
await gmvLabel.waitFor({ state: 'visible', timeout: 30000 });

let gmvText = '';
for (let attempt = 0; attempt < 20; attempt++) {
  gmvText = await gmvLabel.evaluate(
    (el: Element) => (el.nextElementSibling as HTMLElement | null)?.textContent?.trim() ?? ''
  );
  if (gmvText && gmvText !== 'EUR 0' && gmvText !== 'EUR 0.00') break;
  await page.waitForTimeout(1000);
}
// gmvText = "EUR 180,145.24"
```

### Read Scheduled Tab (nested iframe)

```typescript
// Click SCHEDULED — must use tabs2--0 to avoid collision with tabs1--0 (transaction type subtabs)
await retoolFrame.getByTestId('tabs2--0').getByTestId('Tabs::Tab::1').click();
await page.waitForTimeout(3000);

// SCHEDULED content is in a nested custom component iframe
const scheduledFrame = retoolFrame.frameLocator('[data-testid="CustomComponentIframe::scheduled_component"]');

// Pending bank clearance totals
const pendingText = await scheduledFrame
  .getByText('PENDING BANK CLEARANCE', { exact: true })
  .evaluate((el: Element) => {
    const sib = el.nextElementSibling as HTMLElement | null;
    if (!sib) return '';
    const kids = Array.from(sib.children);
    return kids.length > 0
      ? kids.map((c) => (c as HTMLElement).textContent?.trim() ?? '').join('\n')
      : sib.textContent?.trim() ?? '';
  });
// EU: "No pending totals" | HK: "USD: $22.73"

// Scheduled merchant funding totals
const scheduledFundingText = await scheduledFrame
  .getByText('SCHEDULED MERCHANT FUNDING', { exact: true })
  .evaluate((el: Element) => {
    const sib = el.nextElementSibling as HTMLElement | null;
    if (!sib) return '';
    const kids = Array.from(sib.children);
    return kids.length > 0
      ? kids.map((c) => (c as HTMLElement).textContent?.trim() ?? '').join('\n')
      : sib.textContent?.trim() ?? '';
  });
// EU: "GBP: £40,417.88\nEUR: €326,047.68\nUSD: $8,204.97"
```

### Read Reserve Tab

```typescript
await retoolFrame.getByTestId('tabs2--0').getByTestId('Tabs::Tab::3').click();
await page.waitForTimeout(2000);

const reserveText = await retoolFrame.locator('p:has-text("Balance:")').first().textContent();
// "Balance: EUR 100,001.00"
```

### Clear Merchant + Advance to Next

```typescript
try {
  await page.getByRole('button', { name: 'clear icon' }).click();
  await page.waitForTimeout(1000);
} catch { /* safe to ignore */ }
```

### Timing Requirements

- `waitForTimeout(3000)` after `page.goto()` and page-changing clicks
- `waitForTimeout(1500)` after merchant autocomplete fill (wait for dropdown)
- `waitForTimeout(3000)` after switching to SCHEDULED tab (nested iframe load)
- `waitForTimeout(2000)` after switching to RESERVE tab
- **Never** use `waitUntil: 'networkidle'` — Vuetify SPA never settles
- **Poll GMV** for up to 20s (1s intervals) before reading — Retool API response delay

### Delivery

```typescript
// JSON (balances)
await deliverJson(process.env.BALANCES_WEBHOOK_URL!, result, log, PARTNER);

// File (report)
await deliverFile(process.env.TP_REPORT_WEBHOOK_URL!, csvPath!, 'text/csv', log, PARTNER);
```

### Error Notification

```typescript
} catch (err) {
  log.error('failed', { error: String(err) });
  await notifySlackError(PARTNER, TASK, err);
  process.exit(1);
}
```

`notifySlackError` posts to the ops Slack channel via Bot Token (`SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID`). Message includes provider, process, error text, and UTC timestamp. No-ops silently if env vars are absent.

### Currency Text Parsing

```typescript
// "GBP: £40,417.88" | "USD: $22.73" | "HKD: HK$95,637.68"
function parseCurrencyColonAmount(text: string): { currency: string; amount: number } | null {
  const match = text.match(/^([A-Z]{3}):\s*[^\d-]*([-\d,]+\.?\d*)$/);
  if (!match) return null;
  return { currency: match[1], amount: parseFloat(match[2].replace(/,/g, '')) };
}

// "EUR 180,145.24"
function parseSpaceSeparated(text: string): { currency: string; amount: number } {
  const i = text.indexOf(' ');
  return { currency: text.slice(0, i), amount: parseFloat(text.slice(i + 1).replace(/,/g, '')) };
}

// "Balance: EUR 100,001.00"
function parseReserveText(text: string): { currency: string; amount: number } {
  const m = text.match(/Balance:\s+([A-Z]{3})\s+([-\d,]+\.?\d*)/);
  if (!m) throw new Error(`Cannot parse: "${text}"`);
  return { currency: m[1], amount: parseFloat(m[2].replace(/,/g, '')) };
}
```
