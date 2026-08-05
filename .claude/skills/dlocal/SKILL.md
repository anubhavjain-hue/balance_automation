---
name: dlocal
description: Navigate and interact with the dLocal payment dashboard
disable-model-invocation: false
---

# dLocal Dashboard

You are operating on the **dLocal** payment dashboard via Playwright MCP.

## User's Request
$ARGUMENTS

## About

dLocal is a LatAm/emerging-market payment processor. Tazapay's account is **Tazapay Canada Corp (ID: 66107)** — single account, IDR-denominated (Indonesian Rupiah), no merchant sub-accounts. The dashboard is a Next.js SPA behind Auth0 SSO with Cloudflare protection.

Key capabilities: balance reporting (4 summary cards), payin transaction history (CSV via email), withdrawal/payout tracking.

## Dashboard Details

- **URL:** https://dashboard.dlocal.com/
- **Auth:** Auth0 SSO at `auth-dashboard.dlocal.com` — two-step login (email then password)
- **Tech:** Next.js SPA with **MUI** components. Wait 3s after every navigation.
- **Credentials:** `.env` → `DLOCAL_USERNAME` and `DLOCAL_PASSWORD`
- **Account:** Tazapay Canada Corp (ID: 66107) — single account, no merchant filtering
- **Cloudflare:** Wait 5-8s on first navigation for security verification to pass
- **Currency:** All balances in IDR (Indonesian Rupiah)

## Dashboard Map

```
Sidebar
├── Home (/home)                          — Overview dashboard
├── Payins
│   ├── Transactions (/payins/transactions) — Full payin list; URL date filter; Export → email CSV ✓ AUTOMATED
│   ├── Disputes                           — Chargeback/dispute management
│   └── Refunds                            — Refund history
├── Balance
│   ├── Balance Report (/balance/report)   — 4 summary cards + daily balance table ✓ AUTOMATED
│   └── Withdrawals (/balance/withdrawals) — Payout/withdrawal history and requests
├── Reports (/reports)                     — Pre-built downloadable reports (settlements, fees)
├── Merchants                              — Merchant configuration (not relevant for single-account)
└── Settings                               — Account settings, API keys, webhooks
```

**Automated:** Payins → Transactions export (`report`), Balance → Balance Report (`balances`).

**Candidates for new processes:** Balance → Withdrawals (payout records), Reports (settlement/fee reports — direct download, not emailed).

## Login Procedure

1. Read `.env` for credentials
2. Navigate to https://dashboard.dlocal.com/
3. **Wait 5-8s** for Cloudflare → redirects to `auth-dashboard.dlocal.com`
4. Fill Email textbox → click CONTINUE
5. Fill Password textbox → click CONTINUE
6. Wait 3-5s for dashboard to load (redirects to `/home`)

## Selectors

Use these FIRST before taking screenshots.

| Name | Selector | Notes |
|------|----------|-------|
| login_email | role: `textbox[name=Email]` | Auth0 email step |
| login_password | role: `textbox[name=Password]` | Auth0 password step |
| login_submit | role: `button[name=CONTINUE]` | Both login steps |
| nav_payins | role: `button[name=Payins]` | Expandable — click to reveal submenu |
| nav_transactions | `a[href="/payins/transactions"]` | Inside Payins |
| nav_balance | role: `button[name=Balance]` | Expandable — click to reveal submenu |
| nav_balance_report | `a[href="/balance/report"]` | Inside Balance |
| nav_reports | `a[href="/reports"]` | Direct sidebar link |
| transactions_export_btn | role: `button[name=Export]` | On transactions page |
| export_dialog_send_btn | role: `button[name='SEND REPORT']` | In export dialog |
| balance_report_export_btn | role: `button[name=Export]` | On balance report page |
| balance_cards_list | `main ul li` | 4 summary cards; each `li` has `p[0]`=title, `p[1]`=value, `p[2]`=currency |
| transactions_table | `[role='grid']` | MUI DataGrid |
| date_picker_apply_btn | role: `button[name='APPLY']` | In date picker popup |

## Balance Report Page (`/balance/report`)

- **Summary cards:** AVAILABLE BALANCE, IN TRANSIT TO YOUR BANK, PAYINS IN TRANSIT, CURRENT BALANCE (all IDR)
- **Daily balance table:** Date, Gross Amount, Fees, Net Amount, Withdrawals, Balance

## Transactions Page (`/payins/transactions`)

- **URL-based date filtering (PREFERRED):** `/payins/transactions?periodLabel=Custom&start=YYYY-MM-DD&end=YYYY-MM-DD`
- **Date picker fallback:** Click filter → triple-click start date input → type MM/DD/YYYY → click APPLY
- **Export:** Opens dialog with format (CSV/XLSX), pre-filled email, and SEND REPORT button. No direct download — report emailed.

## Common Tasks

### Check Balances
1. Login
2. Expand Balance sidebar → click Balance Report
3. Read summary cards: AVAILABLE BALANCE, IN TRANSIT TO YOUR BANK, PAYINS IN TRANSIT, CURRENT BALANCE
4. Deliver: save JSON to `.tmp/`, POST to `DLOCAL_BALANCES_WEBHOOK_URL` with `curl`

### Export Transaction Report (via email)
1. Login
2. Navigate to `/payins/transactions?periodLabel=Custom&start=YYYY-MM-DD&end=YYYY-MM-DD`
3. Wait 3s, verify date filter chip shows correct "Custom" range
4. Click Export → click SEND REPORT in dialog
5. Output "REPORT_EMAILED"

## Dashboard Quirks

- **Cloudflare:** 5-8s wait on first navigation for verification
- **Auth0 two-step:** Email and password on separate screens, each with CONTINUE
- **MUI components:** `MuiInputBase`, `MuiOutlinedInput` class names
- **Expandable nav:** Payins and Balance are buttons — click to expand, then click sub-items
- **URL date params:** Use `?periodLabel=Custom&start=YYYY-MM-DD&end=YYYY-MM-DD` for reliable date setting
- **Currency:** All balances in IDR (Indonesian Rupiah)
- **Intercom widget:** Chat bubble may overlay elements — dismiss if blocking
- **Export is email-only:** No direct CSV download. Click Export → SEND REPORT → output "REPORT_EMAILED"

## Execution Rules

- Login first, wait for Cloudflare on initial navigation
- Try known selectors before screenshots (fast path)
- If a selector fails, screenshot → identify element → try new selector → save to `selectors/dlocal.json` if it works
- Wait 3s after any navigation or page-changing click
- If login fails: output `ERROR: login_failed` and stop
- Max 3 retries per selector — then output `ERROR: selector_failed:<name>` and stop

---

## Script Pattern (for `/write-script`)

Use this section when writing `scripts/dlocal/<task>.ts`.

### Import Block

```typescript
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });
```

### Confirmed Playwright Locator Forms

```typescript
// Navigate (Cloudflare wait comes before login redirect)
await page.goto('https://dashboard.dlocal.com/');
await page.waitForTimeout(8000);  // Cloudflare security verification

// Auth0 two-step login — redirected to auth-dashboard.dlocal.com
await page.getByRole('textbox', { name: 'Email' }).fill(process.env.DLOCAL_USERNAME!);
await page.getByRole('button', { name: 'CONTINUE' }).click();
await page.waitForTimeout(3000);
await page.getByRole('textbox', { name: 'Password' }).fill(process.env.DLOCAL_PASSWORD!);
await page.getByRole('button', { name: 'CONTINUE' }).click();
await page.waitForTimeout(3000);

// Navigate Balance > Balance Report
await page.getByRole('button', { name: 'Balance' }).click();
await page.waitForTimeout(1000);
await page.locator('a[href="/balance/report"]').click();
await page.waitForTimeout(3000);

// Navigate to Transactions with URL-based date filtering (PREFERRED)
const start = '2026-03-01';
const end = '2026-03-07';
await page.goto(`https://dashboard.dlocal.com/payins/transactions?periodLabel=Custom&start=${start}&end=${end}`);
await page.waitForTimeout(3000);

// Export report (email-only — triggers dLocal email, no file download)
await page.getByRole('button', { name: 'Export' }).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'SEND REPORT' }).click();
```

### Balance Card Extraction

The balance report page (`/balance/report`) shows 4 summary cards in `main ul li`. Navigate directly — no sidebar clicks needed.

```typescript
// Navigate directly (no sidebar needed)
await page.goto('https://dashboard.dlocal.com/balance/report', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.waitForSelector('main ul li', { timeout: 15000 });

// Extract all 4 cards at once — each li: p[0]=title, p[1]=value, p[2]=currency
const cards = await page.evaluate(() => {
  const items = document.querySelectorAll('main ul li');
  const result: Record<string, { value: string; currency: string }> = {};
  for (const item of items) {
    const ps = item.querySelectorAll('p');
    if (ps.length >= 2) {
      const title = ps[0].textContent?.trim() ?? '';
      const value = ps[1].textContent?.trim() ?? '0';
      const currency = ps[2]?.textContent?.trim() ?? 'IDR';
      if (title) result[title] = { value, currency };
    }
  }
  return result;
});
// Keys: 'AVAILABLE BALANCE', 'IN TRANSIT TO YOUR BANK', 'PAYINS IN TRANSIT', 'CURRENT BALANCE'
// Values are formatted like "689,844,628.40" — parse with parseFloat(v.replace(/,/g, ''))
```

### Timing Requirements

- `waitForTimeout(8000)` after first `page.goto('https://dashboard.dlocal.com/')` — Cloudflare
- `waitForTimeout(3000)` after every subsequent navigation
- Use URL-based date params instead of MUI date picker

### Delivery

```typescript
// JSON (balances)
await deliverJson(process.env.DLOCAL_BALANCES_WEBHOOK_URL!, result, log);

// Report task: no delivery — dLocal emails the CSV directly
log.info('report_emailed');
```
