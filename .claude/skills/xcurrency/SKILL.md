# xCurrency Hubs Partner Dashboard

**Dashboard URL:** https://partner.xcurrency.com/
**Partner ID:** xcurrency
**Credentials:** `XCURRENCY_USERNAME` / `XCURRENCY_PASSWORD` (from `.env`)

---

## Login Procedure

1. Navigate to `https://partner.xcurrency.com/`
2. Wait 3 seconds — SPA redirects to `https://partner.xcurrency.com/tauth/login`
3. The login form lives inside a **cross-origin iframe** pointing to `https://auth.xcurrency.com/login`
4. Fill email: `page.frameLocator('iframe').getByRole('textbox', { name: 'Email' })`
5. Fill password: `page.frameLocator('iframe').getByRole('textbox', { name: 'Password' })`
6. Check "Sign in Automatically": **click the label**, NOT the checkbox:
   `page.frameLocator('iframe').locator('label[for="ck-auto-login"]').click()`
   > The `<label>` element intercepts pointer events on the checkbox. Direct `setChecked` or checkbox click will timeout.
7. Click Sign In: `page.frameLocator('iframe').getByRole('button', { name: 'Sign in' })`
8. Wait for URL to match `**/wallets/balance/**` (auto-redirects after login)

---

## Navigation Map

```
/ → tauth/login (login page with cross-origin iframe)
/wallets/balance/list → Balance page (default after login)
```

---

## Selectors

| Name | Playwright Locator | Notes |
|------|--------------------|-------|
| login_email | `page.frameLocator('iframe').getByRole('textbox', { name: 'Email' })` | Cross-origin iframe |
| login_password | `page.frameLocator('iframe').getByRole('textbox', { name: 'Password' })` | Cross-origin iframe |
| login_auto_label | `page.frameLocator('iframe').locator('label[for="ck-auto-login"]')` | Click label, not checkbox |
| login_submit | `page.frameLocator('iframe').getByRole('button', { name: 'Sign in' })` | Cross-origin iframe |
| balance_cards | JS evaluate targeting `main .ant-pro-card` | See extraction pattern below |

---

## Balance Extraction Pattern

Balance page URL: `https://partner.xcurrency.com/wallets/balance/list`

Cards are Ant Design Pro Card components. Currency code is a leaf `<div>` with no children;
the card container has class `ant-pro-card` in its class list.

```typescript
const balances: Record<string, number> = await page.evaluate(() => {
  const result: Record<string, number> = {};
  const main = document.querySelector('main');
  if (!main) return result;

  for (const el of main.querySelectorAll('*')) {
    const text = el.textContent?.trim() ?? '';
    if (!/^[A-Z]{2,4}$/.test(text) || el.children.length !== 0) continue;

    // Walk up to the card container
    let card: Element | null = el.parentElement;
    while (card && !card.className.split(' ').includes('ant-pro-card')) {
      card = card.parentElement;
    }
    if (!card) continue;

    // First leaf numeric element in the card is the available balance
    for (const ce of card.querySelectorAll('*')) {
      const ct = ce.textContent?.trim() ?? '';
      if (ct && ce.children.length === 0 && /^[\d,\.]+$/.test(ct)) {
        result[text] = parseFloat(ct.replace(/,/g, ''));
        break;
      }
    }
  }
  return result;
});
```

**Confirmed currencies (2026-03-24):** USD, SGD, CNY, XC

---

## Dashboard Quirks

| Quirk | Detail |
|-------|--------|
| Cross-origin login iframe | Login form is at `auth.xcurrency.com` inside an iframe — cannot use `page.evaluate()` to interact with it; use `page.frameLocator('iframe')` |
| Checkbox label intercept | `label[for="ck-auto-login"]` blocks direct checkbox clicks — must click the label |
| Auto-redirect after login | No manual navigation needed; login sends you directly to `/wallets/balance/list` |
| No networkidle | SPA (React + Ant Design) — use `waitForTimeout(3000)` instead |
| XC currency | Internal token currency — always shows 0.00 unless applied for |

---

## Tasks

| Task | Script | Description |
|------|--------|-------------|
| balances | `scripts/xcurrency/balances.ts` | Extract per-currency balances and POST to `BALANCES_WEBHOOK_URL` |

---

## Webhook

All balance results post to `BALANCES_WEBHOOK_URL` (shared across all partners).

---

## Error Handling

Any unhandled error in a script calls `notifySlackError(PARTNER, TASK, err)` before `process.exit(1)`.

```typescript
import { notifySlackError } from '../../src/utils/slack.js';

} catch (err) {
  log.error('failed', { error: String(err) });
  await notifySlackError(PARTNER, TASK, err);
  process.exit(1);
}
```

Posts to the ops Slack channel via `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` from `.env`. Message includes provider (`xcurrency`), process (e.g. `balances`), error text, and UTC timestamp. No-ops silently if env vars are absent.
