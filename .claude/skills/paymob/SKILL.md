# Paymob Partner Skill

Paymob has **two separate dashboards** that must be scraped independently for balance data.

## Dashboards

| Dashboard | URL | Currency | Auth |
|-----------|-----|----------|------|
| UAE Payouts | https://payouts-uae.paymobsolutions.com/ | AED | Username + Password + TOTP |
| KSA Portal | https://ksa.paymob.com/portal2/ | SAR | Phone + Password (no MFA) |

## Credentials (from `.env`)

| Variable | Description |
|----------|-------------|
| `PAYMOB_UAE_USERNAME` | UAE dashboard username (e.g. `Anubhav-Jain-3-2`) |
| `PAYMOB_UAE_PASSWORD` | UAE dashboard password |
| `PAYMOB_UAE_TOTP_SECRET` | TOTP secret for UAE 2FA |
| `PAYMOB_SA_PHONE_NUMBER` | KSA login phone number (local only, e.g. `567897542`) |
| `PAYMOB_SA_PASSWORD` | KSA dashboard password |

---

## UAE Dashboard — Login Procedure

1. Navigate to `https://payouts-uae.paymobsolutions.com/user/login/`
2. Fill `Username` textbox → `PAYMOB_UAE_USERNAME`
3. Fill `Password` textbox → `PAYMOB_UAE_PASSWORD`
4. Click `Login` button
5. Wait ~3s — redirects to `/account/token/` (TOTP page)
6. Generate TOTP with `generateTotp(process.env.PAYMOB_UAE_TOTP_SECRET!)`
7. Fill `Enter Authentication Code:` textbox → TOTP code
8. Click `submit` button (lowercase)
9. Wait ~3s — redirects to `/home/`

### UAE Balance Extraction

On `/home/`, the AED balance is displayed as an `<h2>` element containing text like `"42537.33 AED"`.

```typescript
const aedEl = page.locator('h2').filter({ hasText: /AED/ }).first();
await aedEl.waitFor({ timeout: 10000 });
const aedRaw = (await aedEl.textContent()) ?? '0';
// Parse: "42537.33 AED" → 42537.33
const aedBalance = parseFloat(aedRaw.replace(/[^\d.]/g, ''));
```

---

## KSA Dashboard — Login Procedure

1. Navigate to `https://ksa.paymob.com/portal2/` (redirects to `/portal2/en/login`)
2. Wait 3s (React SPA)
3. The phone field shows `+966` country code pre-filled — **do not clear it**, just fill the local number
4. Fill `Phone number` textbox → `PAYMOB_SA_PHONE_NUMBER` (local number only, e.g. `567897542`)
5. Fill `Password` textbox → `PAYMOB_SA_PASSWORD`
6. The `Sign in` button is **disabled** until both fields are filled — it enables automatically after fill
7. Click `Sign in` button (normal click, no JS needed)
8. Wait ~4s — redirects to `/portal2/en/home`
9. No MFA / TOTP required

### KSA Balance Extraction

Navigate to Transfers via sidebar: click `link " Transfers"` (note leading space — icon glyph prefix).

On `/portal2/en/transfers`, the page has two sections:
- **Bank Account** — Net Volume, Gross Volume, Fees, VAT, Subscriptions
- **Bills balance** — Net Volume, Gross Volume, Fees

The balance we want is **Net Volume under "Bank Account"** (first `<p>Net Volume</p>` on the page).

Structure:
```html
<div> <!-- card -->
  <img>
  <h3>
    9,650.77           <!-- text node — the number -->
    <span>SAR</span>  <!-- child element — currency glyph (may render as 瘟 in some contexts) -->
  </h3>
  <p>Net Volume</p>
</div>
```

**Important**: Extract only text nodes from the `<h3>` to avoid the garbled currency glyph:

```typescript
const netVolumeLabel = page.locator('p').filter({ hasText: 'Net Volume' }).first();
await netVolumeLabel.waitFor({ timeout: 10000 });

const sarRaw = await netVolumeLabel.evaluate((el) => {
  const h3 = el.parentElement?.querySelector('h3');
  if (!h3) return '0';
  return Array.from(h3.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent?.trim())
    .join('');
});
// sarRaw = "9,650.77"
const sarBalance = parseFloat(sarRaw.replace(/,/g, ''));
```

---

## Dashboard Quirks

- **UAE TOTP**: Single input field (not 6 separate boxes like DOKU). Standard `fill()` works.
- **KSA Sign-in button**: Disabled until form is filled — no need to force-click, just fill fields first.
- **KSA currency glyph**: The SAR symbol renders as a garbled character (`瘟`) in Playwright's accessibility tree. Always extract text nodes only from the `<h3>`, not `textContent()` of the whole element.
- **KSA "Transfers" link name**: Has a leading space (` Transfers`) due to an icon glyph — use `{ name: ' Transfers' }` (with space).
- **No Cloudflare**: Both dashboards load directly, TypeScript is the right runtime (no camoufox needed).
- **UAE TOTP timing**: Generate the code immediately before submitting. TOTP codes are valid for 30s, so no timing issues in practice.

---

## Script

```
scripts/paymob/balances.ts
```

Run:
```bash
npx tsx scripts/paymob/balances.ts
```

Delivers to `BALANCES_WEBHOOK_URL` with payload:
```json
{
  "partner": "paymob",
  "scrape_timestamp": "2026-03-25T09:00:00.000Z",
  "balances": {
    "AED": { "available": 42537.33, "pending": 0 },
    "SAR": { "available": 9650.77, "pending": 0 }
  },
  "detail": {
    "uae_aed_balance": 42537.33,
    "ksa_sar_net_volume": 9650.77
  }
}
```
