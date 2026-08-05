#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { notifySlackError } from '../../src/utils/slack.js';
import { fetchOtp } from '../../src/email-otp.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });

const PARTNER = 'doku';
const TASK = 'balances';
const log = createLogger(PARTNER, TASK);

// ---------------------------------------------------------------------------
// Number parsing for mixed Indonesian/US formats
// Examples: "IDR 157.902.336" → 157902336, "2.352.945.915,120000 IDR" → 2352945915
// ---------------------------------------------------------------------------
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

async function main(): Promise<void> {
  const { browser, page } = await launchBrowser(PARTNER, TASK);

  try {
    log.info('starting');

    // -------------------------------------------------------------------------
    // PHASE 1: dashboard.doku.com — Gross Volume + Next Payout
    // -------------------------------------------------------------------------
    log.info('phase1_login');
    await page.goto('https://dashboard.doku.com/bo/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Cookie banner — click before interacting with the form
    try {
      await page.locator("button[data-test='accept-cookie']").click({ timeout: 5000 });
      await page.waitForTimeout(500);
    } catch {}

    // Wait for login form to mount (React SPA).
    // The email field may render as type='text' in some browser contexts.
    const emailInput = page.locator("input[type='email'], input[type='text']").first();
    await emailInput.waitFor({ timeout: 15000 });

    // Fill credentials
    await emailInput.fill(process.env.DOKU_USERNAME!);
    await page.locator("input[type='password']").fill(process.env.DOKU_PASSWORD!);

    // Submit — use JS click to bypass any overlay
    await page.evaluate(() => {
      (document.querySelector('button[type="submit"]') as HTMLButtonElement)?.click();
    });

    // Wait for OTP email to arrive
    await page.waitForTimeout(10000);

    // Fetch OTP via IMAP
    const otp = await fetchOtp();
    if (!otp) throw new Error('otp_fetch_failed');
    log.info('otp_fetched');

    // Fill 6 individual OTP input boxes (auto-submits after last digit)
    const otpInputs = page.locator('input.input-otp');
    for (let i = 0; i < otp.length; i++) {
      await otpInputs.nth(i).fill(otp[i]);
      await page.waitForTimeout(100);
    }

    // Wait for dashboard to load after auto-submit
    await page.waitForTimeout(5000);

    if (!page.url().includes('/bo/dashboard')) {
      throw new Error('login_failed: still not on dashboard after OTP');
    }
    log.info('phase1_logged_in');

    // Wait for the DOKU summary iframe to appear (skip hidden GTM iframe)
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('iframe')).some(f => f.offsetWidth > 0 && f.offsetHeight > 0),
      { timeout: 30000 }
    );
    // Give the iframe content time to fully render
    await page.waitForTimeout(3000);

    // Use the first visible (non-zero-size) iframe
    const frame = page.frameLocator('iframe[width]:not([width="0"]), iframe:not([width])').first();
    await frame.locator('text=Jumlah Bruto').first().waitFor({ timeout: 30000 });

    const grossVolumeRaw = (await frame
      .locator('xpath=//div[text()[normalize-space()="Jumlah Bruto"]]/following-sibling::div[1]')
      .first()
      .textContent()) ?? '0';

    let nextPayoutRaw = '0';
    try {
      const txt = await frame
        .locator('xpath=//div[text()[normalize-space()="Transfer Berikutnya"]]/following-sibling::div[1]')
        .first()
        .textContent({ timeout: 3000 });
      if (txt && txt.trim()) nextPayoutRaw = txt.trim();
    } catch {}

    const grossVolume = parseIndonesianNumber(grossVolumeRaw);
    const nextPayout = parseIndonesianNumber(nextPayoutRaw);
    const balanceA = grossVolume + nextPayout;
    log.info('phase1_done', { grossVolume, nextPayout, balanceA });

    // -------------------------------------------------------------------------
    // PHASE 2: kirimdoku.com — Credit Left
    // -------------------------------------------------------------------------
    log.info('phase2_start');
    await page.goto('https://kirimdoku.com/v2/dashboard');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('/v2/login')) {
      log.info('phase2_login_required');
      // Navigate directly to the login page (clean load)
      await page.goto('https://kirimdoku.com/v2/login', { waitUntil: 'networkidle' });
      log.info('phase2_login_page_loaded', { url: page.url() });

      // Retry loop: handle "currently logged in" conflict (2-min server lock)
      let loginSuccess = false;
      for (let attempt = 1; attempt <= 4; attempt++) {
        log.info('phase2_login_attempt', { attempt });

        // Navigate to login page fresh each attempt so the form is always present
        await page.goto('https://kirimdoku.com/v2/login', { waitUntil: 'networkidle' });

        // Use role-based selectors (confirmed in MCP browser exploration)
        await page.getByRole('textbox', { name: 'Email:' }).fill(process.env.DOKU_USERNAME!);
        await page.getByRole('textbox', { name: 'Your password' }).fill(process.env.DOKU_PASSWORD!);

        // Submit via JS click (bypasses overlay/stability checks) then wait for page settle
        await page.evaluate(() => { (document.getElementById('start') as HTMLElement)?.click(); });
        await page.waitForTimeout(2000);
        await page.waitForLoadState('networkidle');

        log.info('phase2_login_attempt_result', { attempt, url: page.url() });

        if (page.url().includes('/v2/dashboard')) {
          loginSuccess = true;
          break;
        }

        // Check for "currently logged in" conflict
        const bodyText = await page.locator('body').textContent().catch(() => '') ?? '';
        const isConflict = bodyText.includes('currently logged in');

        if (isConflict) {
          log.info('phase2_session_conflict', { attempt });
          // Navigate direct — session cookie may still be valid
          await page.goto('https://kirimdoku.com/v2/dashboard', { waitUntil: 'networkidle' });
          if (page.url().includes('/v2/dashboard')) {
            loginSuccess = true;
            break;
          }
          // Wait for server-side lock to expire, then retry
          if (attempt < 4) await page.waitForTimeout(30000);
        }
      }

      if (!loginSuccess) throw new Error('kirimdoku_login_failed');
      log.info('phase2_logged_in');
    }

    // Extract Credit Left
    const creditLeftEl = page.locator('.stat-agent:nth-child(2) > .text-statagent.fleft').first();
    await creditLeftEl.waitFor({ timeout: 10000 });
    const creditLeftRaw = (await creditLeftEl.textContent()) ?? '0';

    const balanceB = parseIndonesianNumber(creditLeftRaw);
    log.info('phase2_done', { creditLeftRaw, balanceB });

    // -------------------------------------------------------------------------
    // AGGREGATE + DELIVER
    // -------------------------------------------------------------------------
    const totalBalance = balanceA + balanceB;
    const result = {
      scrape_timestamp: new Date().toISOString(),
      balances: {
        IDR: { available: totalBalance, pending: 0 },
      },
      detail: {
        gross_volume: grossVolume,
        next_payout: nextPayout,
        kirimdoku_credit_left: balanceB,
      },
    };

    log.info('delivering', { totalBalance });
    await deliverJson(process.env.BALANCES_WEBHOOK_URL!, result, log, PARTNER);

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
