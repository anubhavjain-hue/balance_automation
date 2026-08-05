#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { notifySlackError } from '../../src/utils/slack.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });

const PARTNER = 'xcurrency';
const TASK = 'balances';
const log = createLogger(PARTNER, TASK);

async function main(): Promise<void> {
  const { browser, page } = await launchBrowser(PARTNER, TASK);

  try {
    log.info('starting');

    // --- LOGIN ---
    log.info('navigating_to_login');
    await page.goto('https://partner.xcurrency.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Login form is inside a cross-origin iframe (auth.xcurrency.com)
    const frame = page.frameLocator('iframe');

    await frame.getByRole('textbox', { name: 'Email' }).fill(process.env.XCURRENCY_USERNAME!);
    await frame.getByRole('textbox', { name: 'Password' }).fill(process.env.XCURRENCY_PASSWORD!);

    // The checkbox is blocked by its label overlay — click the label directly
    await frame.locator('label[for="ck-auto-login"]').click();

    await frame.getByRole('button', { name: 'Sign in' }).click();
    log.info('sign_in_clicked');

    // Wait for redirect to wallets/balance/list
    await page.waitForURL('**/wallets/balance/**', { timeout: 30000 });
    await page.waitForTimeout(3000);
    log.info('logged_in', { url: page.url() });

    // --- EXTRACT BALANCES ---
    // Balance cards use Ant Design Pro Card components.
    // Currency code is a leaf div; the card container has class 'ant-pro-card'.
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

    if (Object.keys(balances).length === 0) {
      throw new Error('extraction_failed: no balance cards found');
    }

    log.info('balances_extracted', { currencies: Object.keys(balances) });

    // --- DELIVER ---
    const result = {
      scrape_timestamp: new Date().toISOString(),
      balances: Object.fromEntries(
        Object.entries(balances).map(([currency, amount]) => [
          currency,
          { available: amount, pending: 0 },
        ])
      ),
    };

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
