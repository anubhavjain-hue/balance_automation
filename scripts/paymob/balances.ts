#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { notifySlackError } from '../../src/utils/slack.js';
import { generateTotp } from '../../src/utils/totp.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });

const PARTNER = 'paymob';
const TASK = 'balances';
const log = createLogger(PARTNER, TASK);

// ---------------------------------------------------------------------------
// Parse a balance string like "42,537.33 AED" or "9,650.77" → number
// ---------------------------------------------------------------------------
function parseBalance(raw: string): number {
  const cleaned = raw.replace(/[^\d.]/g, '');
  return parseFloat(cleaned) || 0;
}

async function main(): Promise<void> {
  const { browser, page } = await launchBrowser(PARTNER, TASK);

  try {
    log.info('starting');

    // -------------------------------------------------------------------------
    // PHASE 1: payouts-uae.paymobsolutions.com — AED balance
    // -------------------------------------------------------------------------
    log.info('phase1_login');
    await page.goto('https://payouts-uae.paymobsolutions.com/user/login/', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2000);

    await page.getByRole('textbox', { name: 'Username' }).fill(process.env.PAYMOB_UAE_USERNAME!);
    await page.getByRole('textbox', { name: 'Password' }).fill(process.env.PAYMOB_UAE_PASSWORD!);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL('**/account/token/**', { timeout: 15000 }).catch(() => {});

    // Expect TOTP page
    if (!page.url().includes('/account/token/')) {
      throw new Error(`phase1_totp_page_not_reached: current url=${page.url()}`);
    }
    log.info('phase1_totp_page');

    const totpCode = generateTotp(process.env.PAYMOB_UAE_TOTP_SECRET!);
    log.info('phase1_totp_generated');

    await page.getByRole('textbox', { name: 'Enter Authentication Code:' }).fill(totpCode);
    await page.getByRole('button', { name: 'submit' }).click();
    await page.waitForTimeout(3000);

    if (!page.url().includes('/home/')) {
      throw new Error(`phase1_login_failed: current url=${page.url()}`);
    }
    log.info('phase1_logged_in');

    // Balance is a h2 containing "AED" on the home screen
    const aedEl = page.locator('h2').filter({ hasText: /AED/ }).first();
    await aedEl.waitFor({ timeout: 10000 });
    const aedRaw = (await aedEl.textContent()) ?? '0';
    const aedBalance = parseBalance(aedRaw);
    log.info('phase1_done', { aedRaw, aedBalance });

    // -------------------------------------------------------------------------
    // PHASE 2: ksa.paymob.com/portal2/ — SAR net volume
    // -------------------------------------------------------------------------
    log.info('phase2_login');
    await page.goto('https://ksa.paymob.com/portal2/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const phoneField = page.getByRole('textbox', { name: 'Phone number' });
    await phoneField.click();
    await phoneField.pressSequentially(process.env.PAYMOB_SA_PHONE_NUMBER!);
    await page.getByRole('textbox', { name: 'Password' }).fill(process.env.PAYMOB_SA_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForTimeout(4000);

    if (!page.url().includes('/portal2/en/home')) {
      throw new Error(`phase2_login_failed: current url=${page.url()}`);
    }
    log.info('phase2_logged_in');

    // Navigate to Transfers
    await page.getByRole('link', { name: ' Transfers' }).click();
    await page.waitForTimeout(3000);

    if (!page.url().includes('/portal2/en/transfers')) {
      throw new Error(`phase2_transfers_nav_failed: current url=${page.url()}`);
    }
    log.info('phase2_transfers_page');

    // Net Volume is the h3 preceding the first <p>Net Volume</p> in Bank Account section
    const netVolumeLabel = page.locator('p').filter({ hasText: 'Net Volume' }).first();
    await netVolumeLabel.waitFor({ timeout: 10000 });

    const sarRaw = await netVolumeLabel.evaluate((el) => {
      const h3 = el.parentElement?.querySelector('h3');
      // Extract only text nodes (skip currency symbol child span/generic)
      if (!h3) return '0';
      return Array.from(h3.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim())
        .join('');
    });

    const sarBalance = parseBalance(sarRaw);
    log.info('phase2_done', { sarRaw, sarBalance });

    // -------------------------------------------------------------------------
    // AGGREGATE + DELIVER
    // -------------------------------------------------------------------------
    const result = {
      scrape_timestamp: new Date().toISOString(),
      balances: {
        AED: { available: aedBalance, pending: 0 },
        SAR: { available: sarBalance, pending: 0 },
      },
      detail: {
        uae_aed_balance: aedBalance,
        ksa_sar_net_volume: sarBalance,
      },
    };

    log.info('delivering', { aedBalance, sarBalance });
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
