---
name: doku
description: Navigate and interact with the DOKU payment dashboard
disable-model-invocation: false
---

# DOKU Dashboard

You are operating on the **DOKU** payment dashboard via Playwright MCP.

## User's Request
$ARGUMENTS

## About

DOKU is an Indonesian payment gateway. Tazapay operates **two separate dashboards** for different products:

1. **dashboard.doku.com** — Main merchant dashboard (React SPA, Indonesian UI). Shows gross volume, next payout, transaction history.
2. **kirimdoku.com** — KirimDOKU remittance platform (jQuery/server-rendered, English UI). Shows credit limit and credit left for remittance operations.

Both use the same credentials. The main dashboard requires email OTP on each new session; KirimDOKU does not. Currency is IDR throughout.

Key capabilities: balance aggregation across both platforms, transaction history, payout tracking.

## Dashboard Details

- **URL:** https://dashboard.doku.com/
- **Auth:** Email + password → email OTP (6-digit code sent to `noreply@doku.com`, auto-fetched via IMAP)
- **Tech:** React SPA. Wait 3–5s after every navigation.
- **Language:** Indonesian UI — "Masuk" = Login, "Daftar" = Register, "Lanjutkan" = Continue
- **Credentials:** `.env` → `DOKU_USERNAME`, `DOKU_PASSWORD`
- **Gmail IMAP:** `.env` → `GMAIL_USERNAME`, `GMAIL_APP_PASSWORD`
- **Currency:** IDR throughout both dashboards

## Dashboard Map

### dashboard.doku.com (React SPA, Indonesian UI)

```
Sidebar
├── Dashboard (/bo/dashboard)        — Summary: Gross Volume + Next Payout in iframe ✓ AUTOMATED (Phase 1)
├── Transaksi (/bo/transactions)     — Full transaction list; date filter; CSV export
├── Settlement (/bo/settlement)      — Settlement/payout history
├── Rekening (/bo/accounts)          — Bank account management
├── Laporan (/bo/reports)            — Downloadable reports (transactions, settlements)
└── Pengaturan (/bo/settings)        — Account/profile settings
```

### kirimdoku.com (jQuery, English UI, server-rendered — use `networkidle`)

```
├── Dashboard (/v2/dashboard)        — Credit Limit section: Credit Left ✓ AUTOMATED (Phase 2)
├── Transactions (/v2/transactions)  — Remittance transaction history
├── Reports (/v2/reports)            — Export remittance reports
└── Settings (/v2/settings)          — Account settings
```

**Automated:** Phase 1 (Gross Volume + Next Payout) + Phase 2 (Credit Left) → aggregated `balances`.

**Candidates for new processes:** Transaksi CSV export, Settlement history, KirimDOKU remittance report.

## Login Procedure

**For scripts: always navigate directly to `/bo/login` (never `/bo/dashboard` first in a fresh browser).**

1. Read `.env` for `DOKU_USERNAME` and `DOKU_PASSWORD`
2. Navigate to `https://dashboard.doku.com/bo/login`
3. Wait 5s (`domcontentloaded` + React hydration)
4. Click cookie banner if present (`button[data-test='accept-cookie']`) — optional, wrap in try/catch
5. Wait for email input: `input[type='email'], input[type='text']` — use `.first()` (type may vary by browser context)
6. Fill email, fill password (`input[type='password']`)
7. **JS click the submit button** — `document.querySelector('button[type="submit"]')?.click()` — do NOT use Playwright's `.click()`, a `<div>` overlay intercepts it
8. Wait 10s for OTP email to arrive
9. Run: `npx tsx src/email-otp.ts` → outputs 6-digit code (or import `fetchOtp()` in scripts)
10. Fill OTP: **6 individual `input.input-otp` boxes** — fill digit-by-digit with `otpInputs.nth(i).fill(otp[i])`
11. **Auto-submits after the last digit** — no button click needed
12. Wait 5s for dashboard to load

**For MCP agent use:** Always check URL first — if already at `/bo/dashboard`, session is active, skip login.

## Selectors

Use these FIRST before taking screenshots.

| Name | Selector | Notes |
|------|----------|-------|
| login_email | `input[type='email'], input[type='text']` | Use `.first()`. Type may differ in headless vs headed. |
| login_password | `input[type='password']` | Password field |
| login_submit | JS: `document.querySelector('button[type="submit"]')?.click()` | Must use JS click — overlay blocks Playwright click |
| cookie_accept | `button[data-test='accept-cookie']` | Optional, wrap in try/catch |
| otp_input | `input.input-otp` | 6 individual boxes — use `.nth(i)` for each digit |
| otp_auto_submit | — | Auto-submits after 6th digit, no button needed |
| session_timeout_modal | `button.d-btn-primary` | JS click: `document.querySelectorAll('button.d-btn-primary').forEach(b=>b.click())` |
| gross_volume | XPath in iframe: `//div[text()[normalize-space()="Jumlah Bruto"]]/following-sibling::div[1]` | Format: `IDR 157.902.336` |
| next_payout | XPath in iframe: `//div[text()[normalize-space()="Transfer Berikutnya"]]/following-sibling::div[1]` | Usually blank — treat as 0 |
| kirimdoku_login_email | `getByRole('textbox', { name: 'Email:' })` | Role-based — CSS type selectors unreliable here |
| kirimdoku_login_password | `getByRole('textbox', { name: 'Your password' })` | |
| kirimdoku_login_submit | JS: `document.getElementById('start')?.click()` | `<input id="start" type="submit">` — must JS click |
| kirimdoku_credit_left | `.stat-agent:nth-child(2) > .text-statagent.fleft` | Format: `3.636.160.238,010000 IDR` |

## Iframe Access (dashboard.doku.com)

The "Ringkasan Hari Ini" summary block is inside an embedded `<iframe src="/rr/homepage?uniq_id=...">`.

**Critical:** The Google Tag Manager iframe (`width="0" height="0"`) appears FIRST in the DOM — it must be skipped.

```typescript
// Wait for the visible iframe to appear
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('iframe')).some(f => f.offsetWidth > 0 && f.offsetHeight > 0),
  { timeout: 30000 }
);
await page.waitForTimeout(3000); // Let iframe content render

// Target the visible iframe (skip hidden GTM iframe)
const frame = page.frameLocator('iframe[width]:not([width="0"]), iframe:not([width])').first();
await frame.locator('text=Jumlah Bruto').first().waitFor({ timeout: 30000 });
```

In accessibility snapshots, iframe content refs are prefixed `f3e` or `f6e` depending on the run.

## Number Parsing (Both Dashboards)

Both dashboards use mixed Indonesian/US number formatting. Apply to **every** extracted number:

1. Strip currency labels (` IDR`, ` Rp`) and whitespace
2. Both `.` and `,` present → rightmost is decimal separator → discard decimal part, remove remaining separators → integer
3. Only `,` present multiple times → thousand separators → remove all → integer
4. Only `,` present once → decimal separator → discard decimal part → integer
5. Same logic for `.` only

| Example | Result |
|---------|--------|
| `IDR 157.902.336` | 157902336 |
| `2.352.945.915,120000 IDR` | 2352945915 |
| `3.636.160.238,010000 IDR` | 3636160238 |
| `372,146,700 IDR` | 372146700 |

---

## Check Balances (Two-Phase)

### Phase 1: dashboard.doku.com

1. Navigate to `https://dashboard.doku.com/bo/login`
2. Wait 5s → login (see Login Procedure)
3. After OTP auto-submit, wait 5s
4. Confirm URL includes `/bo/dashboard`
5. Wait for visible iframe (see Iframe Access above)
6. Take a **snapshot** (`browser_snapshot`) to read iframe content
7. Find the text sibling of **"Jumlah Bruto"** → Gross Volume (format: `IDR 157.902.336`)
8. Find the text sibling of **"Transfer Berikutnya"** → Next Payout (usually blank = 0)
9. Apply Number Parsing to both values
10. `balance_A = Gross Volume + Next Payout`

### Phase 2: kirimdoku.com

11. Navigate to `https://kirimdoku.com/v2/login` (direct — cleaner than going to /v2/dashboard first)
12. Wait for `networkidle` (server-rendered, NOT a SPA)
13. Fill credentials, JS click `#start`
14. Wait 2s + `waitForLoadState('networkidle')`
15. If "currently logged in" error → navigate to `/v2/dashboard` directly (session still valid)
16. If still on login after direct navigate → wait 30s, retry (server lock expires in ~2 min)
17. Once on `/v2/dashboard`, extract `.stat-agent:nth-child(2) > .text-statagent.fleft`
18. Apply Number Parsing → `balance_B = Credit Left`

### Aggregation

19. `total_balance = balance_A + balance_B`
20. Deliver JSON to `DOKU_BALANCES_WEBHOOK_URL`:
    ```json
    {
      "scrape_date": "YYYY-MM-DD",
      "balances": { "IDR": { "available": <total_balance>, "pending": 0 } },
      "detail": { "gross_volume": <n>, "next_payout": <n>, "kirimdoku_credit_left": <n> }
    }
    ```

---

## Dashboard Quirks

- **Login navigate to `/bo/login` directly** — navigating to `/bo/dashboard` in a fresh browser causes a slow React redirect; `/bo/login` loads the form directly.
- **Email input type varies** — in some Playwright contexts the email field renders as `type='text'` not `type='email'`. Always use `input[type='email'], input[type='text']` with `.first()`.
- **Login submit button has overlay** — Playwright's `.click()` is intercepted. Always use `page.evaluate(() => document.querySelector('button[type="submit"]')?.click())`.
- **OTP: 6 individual boxes, auto-submit** — Not one combined input. Fill digit-by-digit with `.nth(i)`. The form auto-submits after the 6th digit — no button click needed.
- **GTM hidden iframe** — `document.querySelectorAll('iframe')[0]` is the GTM iframe (`width=0, height=0`). The DOKU summary iframe is second. Use `iframe:not([width="0"])` to skip it.
- **Transfer Berikutnya is blank** — The label renders but no value appears next to it. Treat as 0.
- **KirimDOKU is NOT a SPA** — Use `networkidle` wait, not the 3-5s SPA wait.
- **KirimDOKU submit is `<input id="start" type="submit">`** — Must use JS click: `document.getElementById('start')?.click()`. The Playwright `.click()` throws when the element detaches on navigation.
- **KirimDOKU session conflict** — If login returns "currently logged in... wait another N minutes", navigate to `/v2/dashboard` directly. If still blocked, wait 30s and retry (server lock is ~2 min).
- **KirimDOKU role selectors required** — `getByRole('textbox', { name: 'Email:' })` not CSS. CSS type selectors don't reliably match the KirimDOKU form fields.
- **Email OTP** — Run `npx tsx src/email-otp.ts` or import `fetchOtp()`. Searches Gmail IMAP for the latest email from `noreply@doku.com`. Retries 3× with 5s gaps. Requires `GMAIL_USERNAME` + `GMAIL_APP_PASSWORD` in `.env`.

## Error Handling

- Login fails (wrong credentials, OTP error) → output `ERROR: login_failed` and stop
- `fetchOtp()` returns null → throw `otp_fetch_failed`
- KirimDOKU login fails after 4 retries → throw `kirimdoku_login_failed`
- Selector not found → take a screenshot, identify element visually, try new selector, save to `selectors/doku.json`
- **Any unhandled error in a script** → `notifySlackError(PARTNER, TASK, err)` sends a Slack message to the ops channel before `process.exit(1)`. Message includes provider (`doku`), process (e.g. `balances`), error text, and UTC timestamp.

---

## Script Pattern (for `/write-script` and `/update-script`)

Use this section when writing or updating `scripts/doku/<task>.ts`.

### Import Block

```typescript
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { notifySlackError } from '../../src/utils/slack.js';
import { fetchOtp } from '../../src/email-otp.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });
```

### Login Flow

```typescript
await page.goto('https://dashboard.doku.com/bo/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// Cookie banner (optional)
try {
  await page.locator("button[data-test='accept-cookie']").click({ timeout: 5000 });
  await page.waitForTimeout(500);
} catch {}

// Wait for login form (email field type varies by context)
const emailInput = page.locator("input[type='email'], input[type='text']").first();
await emailInput.waitFor({ timeout: 15000 });
await emailInput.fill(process.env.DOKU_USERNAME!);
await page.locator("input[type='password']").fill(process.env.DOKU_PASSWORD!);

// JS click to bypass overlay
await page.evaluate(() => {
  (document.querySelector('button[type="submit"]') as HTMLButtonElement)?.click();
});
await page.waitForTimeout(10000); // Wait for OTP email

const otp = await fetchOtp();
if (!otp) throw new Error('otp_fetch_failed');

// Fill 6 individual OTP boxes — auto-submits after last digit
const otpInputs = page.locator('input.input-otp');
for (let i = 0; i < otp.length; i++) {
  await otpInputs.nth(i).fill(otp[i]);
  await page.waitForTimeout(100);
}
await page.waitForTimeout(5000);
if (!page.url().includes('/bo/dashboard')) throw new Error('login_failed');
```

### Iframe Balance Extraction

```typescript
// Wait for the visible iframe (skip hidden GTM iframe)
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('iframe')).some(f => f.offsetWidth > 0 && f.offsetHeight > 0),
  { timeout: 30000 }
);
await page.waitForTimeout(3000);

const frame = page.frameLocator('iframe[width]:not([width="0"]), iframe:not([width])').first();
await frame.locator('text=Jumlah Bruto').first().waitFor({ timeout: 30000 });

const grossVolumeRaw = (await frame
  .locator('xpath=//div[text()[normalize-space()="Jumlah Bruto"]]/following-sibling::div[1]')
  .first().textContent()) ?? '0';

let nextPayoutRaw = '0';
try {
  const txt = await frame
    .locator('xpath=//div[text()[normalize-space()="Transfer Berikutnya"]]/following-sibling::div[1]')
    .first().textContent({ timeout: 3000 });
  if (txt && txt.trim()) nextPayoutRaw = txt.trim();
} catch {}
```

### KirimDOKU Login Flow

```typescript
await page.goto('https://kirimdoku.com/v2/login', { waitUntil: 'networkidle' });

let loginSuccess = false;
for (let attempt = 1; attempt <= 4; attempt++) {
  await page.getByRole('textbox', { name: 'Email:' }).fill(process.env.DOKU_USERNAME!);
  await page.getByRole('textbox', { name: 'Your password' }).fill(process.env.DOKU_PASSWORD!);

  // JS click — Playwright click throws when element detaches on navigation
  await page.evaluate(() => { (document.getElementById('start') as HTMLElement)?.click(); });
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/v2/dashboard')) { loginSuccess = true; break; }

  const bodyText = await page.locator('body').textContent().catch(() => '') ?? '';
  if (bodyText.includes('currently logged in')) {
    await page.goto('https://kirimdoku.com/v2/dashboard', { waitUntil: 'networkidle' });
    if (page.url().includes('/v2/dashboard')) { loginSuccess = true; break; }
    if (attempt < 4) await page.waitForTimeout(30000);
  }
}
if (!loginSuccess) throw new Error('kirimdoku_login_failed');
```

### Number Parsing Helper

```typescript
function parseIndonesianNumber(raw: string): number {
  let s = raw.replace(/\s*(IDR|Rp)\s*/gi, '').trim();
  const dotCount = (s.match(/\./g) || []).length;
  const commaCount = (s.match(/,/g) || []).length;

  if (dotCount > 0 && commaCount > 0) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      s = s.substring(0, lastComma).replace(/\./g, '');
    } else {
      s = s.substring(0, lastDot).replace(/,/g, '');
    }
  } else if (commaCount > 1) {
    s = s.replace(/,/g, '');
  } else if (commaCount === 1) {
    s = s.substring(0, s.indexOf(',')).replace(/\./g, '');
  } else if (dotCount > 1) {
    s = s.replace(/\./g, '');
  } else if (dotCount === 1) {
    s = s.substring(0, s.indexOf('.')).replace(/,/g, '');
  }

  return parseInt(s.replace(/\D/g, ''), 10) || 0;
}
```

### Delivery

```typescript
const result = {
  scrape_date: new Date().toISOString().split('T')[0],
  balances: {
    IDR: { available: totalBalance, pending: 0 },
  },
  detail: {
    gross_volume: grossVolume,
    next_payout: nextPayout,
    kirimdoku_credit_left: balanceB,
  },
};
await deliverJson(process.env.DOKU_BALANCES_WEBHOOK_URL!, result, log);
```

### Error Notification

```typescript
} catch (err) {
  log.error('failed', { error: String(err) });
  await notifySlackError(PARTNER, TASK, err);
  process.exit(1);
}
```

`notifySlackError` reads `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` from `.env` and posts to Slack via `chat.postMessage`. The message includes provider, process name, error text, and UTC timestamp. It silently no-ops if the env vars are missing.

### Timing Requirements

- `waitForTimeout(5000)` after `goto('/bo/login', { waitUntil: 'domcontentloaded' })` — React hydration
- `waitForTimeout(10000)` after login submit — wait for OTP email to arrive
- `waitForTimeout(5000)` after last OTP digit — dashboard load after auto-submit
- `waitForLoadState('networkidle')` on kirimdoku.com — server-rendered, safe to use
- `waitForTimeout(2000)` after KirimDOKU JS click submit — before waitForLoadState
- Never use `networkidle` on dashboard.doku.com (React SPA)
