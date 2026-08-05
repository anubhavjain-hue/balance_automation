#!/usr/bin/env tsx
/**
 * Total Processing (Nomupay) — Merchant Funding Balance Fetcher
 *
 * Scrapes Finance → Merchant Funding (Beta) for:
 *   - Tazapay - EU: Processing GMV, Scheduled balances, Reserve balance
 *   - Tazapay - HK: Processing GMV, Scheduled balances, Reserve balance
 *
 * Posts granular + aggregated data to BALANCES_WEBHOOK_URL.
 *
 * Run: npx tsx scripts/total-processing/balances.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, teardown } from '../../src/utils/browser.js';
import { deliverJson } from '../../src/utils/deliver.js';
import { createLogger } from '../../src/utils/logger.js';
import { notifySlackError } from '../../src/utils/slack.js';

config({ path: resolve(fileURLToPath(import.meta.url), '../../../.env') });

const PARTNER = 'total-processing';
const TASK = 'balances';
const log = createLogger(PARTNER, TASK);

// ─── Merchant config ────────────────────────────────────────────────────────

const MERCHANTS = [
  { label: 'eu', name: 'Tazapay - EU' },
  { label: 'hk', name: 'Tazapay - HK' },
] as const;

type MerchantLabel = 'eu' | 'hk';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CurrencyAmount {
  currency: string;
  amount: number;
}

interface MerchantBalances {
  entity: MerchantLabel;
  processing: {
    currency: string;
    amount: number;
    note: string;
  };
  scheduled: CurrencyAmount[];    // scheduled_merchant_funding + pending_bank_clearance per currency
  scheduled_detail: {
    merchant_funding: CurrencyAmount[];
    pending_bank_clearance: CurrencyAmount[];
  };
  reserve: CurrencyAmount;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse "EUR 180,145.24" → { currency: 'EUR', amount: 180145.24 } */
function parseSpaceSeparated(text: string): CurrencyAmount {
  const trimmed = text.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const currency = trimmed.slice(0, spaceIdx);
  const amount = parseFloat(trimmed.slice(spaceIdx + 1).replace(/,/g, ''));
  return { currency, amount };
}

/** Parse "Balance: EUR 100,001.00" → { currency: 'EUR', amount: 100001.00 } */
function parseReserveText(text: string): CurrencyAmount {
  // e.g. "Balance: EUR 100,001.00" or "Balance: HKD -1.00"
  const match = text.match(/Balance:\s+([A-Z]{3})\s+([-\d,]+\.?\d*)/);
  if (!match) throw new Error(`Cannot parse reserve text: "${text}"`);
  return {
    currency: match[1],
    amount: parseFloat(match[2].replace(/,/g, '')),
  };
}

/**
 * Parse currency total strings like:
 *   "GBP: £40,417.88"  → { currency: 'GBP', amount: 40417.88 }
 *   "HKD: HK$95,637.68" → { currency: 'HKD', amount: 95637.68 }
 *   "USD: $22.73"       → { currency: 'USD', amount: 22.73 }
 */
function parseCurrencyColonAmount(text: string): CurrencyAmount | null {
  const match = text.match(/^([A-Z]{3}):\s*[^\d-]*([-\d,]+\.?\d*)$/);
  if (!match) return null;
  return {
    currency: match[1],
    amount: parseFloat(match[2].replace(/,/g, '')),
  };
}

/**
 * Merge two arrays of CurrencyAmount, adding amounts for same currency.
 */
function mergeCurrencyAmounts(a: CurrencyAmount[], b: CurrencyAmount[]): CurrencyAmount[] {
  const map = new Map<string, number>();
  for (const item of [...a, ...b]) {
    map.set(item.currency, (map.get(item.currency) ?? 0) + item.amount);
  }
  return Array.from(map.entries()).map(([currency, amount]) => ({ currency, amount }));
}

/**
 * Merge two maps of { currency → amount } across multiple entities.
 */
function mergeMaps(maps: Map<string, number>[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const map of maps) {
    for (const [currency, amount] of map.entries()) {
      result.set(currency, (result.get(currency) ?? 0) + amount);
    }
  }
  return result;
}

function mapToArray(m: Map<string, number>): CurrencyAmount[] {
  return Array.from(m.entries()).map(([currency, amount]) => ({ currency, amount }));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { browser, page } = await launchBrowser(PARTNER, TASK);

  try {
    log.info('starting');

    // ── Login ────────────────────────────────────────────────────────────────
    log.info('navigating_to_dashboard');
    await page.goto('https://dashboard.totalprocessing.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    log.info('logging_in');
    await page.locator('#username').fill(process.env.TP_USERNAME!);
    await page.locator('#password').fill(process.env.TP_PASSWORD!);
    await page.locator('#kc-login').click();
    await page.waitForTimeout(4000);

    if (!page.url().includes('dashboard.totalprocessing.com')) {
      throw new Error(`login_failed — url: ${page.url()}`);
    }
    log.info('logged_in');

    // Dismiss Shepherd.js onboarding popup — its scrim blocks all clicks if not dismissed
    try {
      await page.locator('.shepherd-cancel-icon, .button-skip, .button-secondary').first().click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      log.info('dismissed_shepherd_popup');
    } catch { /* not present — safe to continue */ }

    // Force-remove any lingering Vuetify overlay scrim that blocks pointer events
    await page.evaluate(() => {
      document.querySelectorAll('.v-overlay--active').forEach((el) => el.remove());
    });
    await page.waitForTimeout(500);

    // ── Navigate to Finance → Merchant Funding (Beta) ────────────────────────
    log.info('navigating_to_merchant_funding');
    // Re-purge overlays immediately before clicking — Vuetify may re-render them after login
    await page.evaluate(() => {
      document.querySelectorAll('.v-overlay--active').forEach((el) => el.remove());
    });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Finance' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: 'Merchant Funding (Beta)' }).click();
    await page.waitForTimeout(3000);

    if (!page.url().includes('/finance/merchant-funding-embed')) {
      throw new Error(`navigation_failed — url: ${page.url()}`);
    }
    log.info('on_merchant_funding_page');

    // ── Scrape each merchant ─────────────────────────────────────────────────
    const results: MerchantBalances[] = [];

    for (const merchant of MERCHANTS) {
      log.info('scraping_merchant', { merchant: merchant.name });

      // Select merchant via autocomplete
      await page.getByRole('textbox', { name: 'Merchant' }).fill('Tazapay');
      await page.waitForTimeout(1500);
      await page.getByRole('option', { name: merchant.name }).click();
      await page.waitForTimeout(3000); // wait for Retool iframe to start loading

      const retoolFrame = page.frameLocator('iframe[title="Retool Embed"]');

      // ── PROCESSING tab ────────────────────────────────────────────────────
      log.info('reading_processing_tab', { merchant: merchant.name });
      // PROCESSING is the default tab. Wait for GMV label and then poll until value is non-empty.
      const gmvLabel = retoolFrame.getByText('TOTAL GROSS TRANSACTION VALUE', { exact: true });
      await gmvLabel.waitFor({ state: 'visible', timeout: 60000 });

      // Poll up to 20s for sibling value to be populated (Retool API takes 2-8s)
      let gmvText = '';
      for (let attempt = 0; attempt < 20; attempt++) {
        gmvText = await gmvLabel.evaluate(
          (el: Element) => (el.nextElementSibling as HTMLElement | null)?.textContent?.trim() ?? ''
        );
        if (gmvText && gmvText !== 'EUR 0' && gmvText !== 'EUR 0.00') break;
        await page.waitForTimeout(1000);
      }
      if (!gmvText) throw new Error(`GMV value never populated for ${merchant.name}`);

      const processing = {
        ...parseSpaceSeparated(gmvText),
        note: 'converted_to_eur_not_final',
      };
      log.info('processing_balance', { merchant: merchant.name, ...processing });

      // ── SCHEDULED tab ─────────────────────────────────────────────────────
      log.info('reading_scheduled_tab', { merchant: merchant.name });
      // Use the outer tab container (tabs2--0) to disambiguate from transaction-type subtabs (tabs1--0)
      await retoolFrame.getByTestId('tabs2--0').getByTestId('Tabs::Tab::1').click();
      await page.waitForTimeout(3000); // nested iframe load

      // The SCHEDULED tab loads a custom component iframe — use its specific data-testid
      const scheduledFrame = retoolFrame.frameLocator('[data-testid="CustomComponentIframe::scheduled_component"]');

      // PENDING BANK CLEARANCE totals
      const pendingRaw = await scheduledFrame
        .getByText('PENDING BANK CLEARANCE', { exact: true })
        .evaluate((el: Element) => {
          const sib = el.nextElementSibling as HTMLElement | null;
          if (!sib) return '';
          const kids = Array.from(sib.children);
          return kids.length > 0
            ? kids.map((c) => (c as HTMLElement).textContent?.trim() ?? '').join('\n')
            : sib.textContent?.trim() ?? '';
        });

      const pendingItems: CurrencyAmount[] = [];
      for (const line of pendingRaw.split('\n').map((s) => s.trim()).filter(Boolean)) {
        if (line === 'No pending totals') continue;
        const parsed = parseCurrencyColonAmount(line);
        if (parsed) pendingItems.push(parsed);
      }

      // SCHEDULED MERCHANT FUNDING totals
      const scheduledFundingRaw = await scheduledFrame
        .getByText('SCHEDULED MERCHANT FUNDING', { exact: true })
        .evaluate((el: Element) => {
          const sib = el.nextElementSibling as HTMLElement | null;
          if (!sib) return '';
          const kids = Array.from(sib.children);
          return kids.length > 0
            ? kids.map((c) => (c as HTMLElement).textContent?.trim() ?? '').join('\n')
            : sib.textContent?.trim() ?? '';
        });

      const scheduledFundingItems: CurrencyAmount[] = [];
      for (const line of scheduledFundingRaw.split('\n').map((s) => s.trim()).filter(Boolean)) {
        const parsed = parseCurrencyColonAmount(line);
        if (parsed) scheduledFundingItems.push(parsed);
      }

      // Combined scheduled = scheduled_merchant_funding + pending_bank_clearance
      const scheduledCombined = mergeCurrencyAmounts(scheduledFundingItems, pendingItems);

      log.info('scheduled_balance', {
        merchant: merchant.name,
        pending: pendingItems,
        scheduled_funding: scheduledFundingItems,
        combined: scheduledCombined,
      });

      // ── RESERVE tab ───────────────────────────────────────────────────────
      log.info('reading_reserve_tab', { merchant: merchant.name });
      await retoolFrame.getByTestId('tabs2--0').getByTestId('Tabs::Tab::3').click();
      await page.waitForTimeout(2000);

      const reserveText = await retoolFrame
        .locator('p:has-text("Balance:")')
        .first()
        .textContent();

      const reserve = parseReserveText(reserveText?.trim() ?? '');
      log.info('reserve_balance', { merchant: merchant.name, ...reserve });

      results.push({
        entity: merchant.label,
        processing,
        scheduled: scheduledCombined,
        scheduled_detail: {
          merchant_funding: scheduledFundingItems,
          pending_bank_clearance: pendingItems,
        },
        reserve,
      });

      // Clear merchant for next iteration
      try {
        await page.getByRole('button', { name: 'clear icon' }).click();
        await page.waitForTimeout(1000);
      } catch { /* safe to ignore */ }
    }

    // ── Build payload ─────────────────────────────────────────────────────────
    log.info('building_payload');

    const euData = results.find((r) => r.entity === 'eu')!;
    const hkData = results.find((r) => r.entity === 'hk')!;

    /**
     * Aggregate all three tabs for one entity into a single per-currency map.
     * Processing is always EUR-converted → contributes only to EUR bucket.
     * Scheduled and reserve are in their native currencies.
     */
    function aggregateEntity(data: MerchantBalances): CurrencyAmount[] {
      return mergeCurrencyAmounts(
        mergeCurrencyAmounts(
          [{ currency: data.processing.currency, amount: data.processing.amount }],
          data.scheduled
        ),
        [data.reserve]
      );
    }

    const euAgg = aggregateEntity(euData);
    const hkAgg = aggregateEntity(hkData);

    // Grand total: sum EU + HK aggregates per currency
    const euAggMap = new Map(euAgg.map((x) => [x.currency, x.amount]));
    const hkAggMap = new Map(hkAgg.map((x) => [x.currency, x.amount]));
    const grandTotal = mapToArray(mergeMaps([euAggMap, hkAggMap]));

    const payload = {
      scrape_timestamp: new Date().toISOString(),

      // ── Granular: per entity, per tab, per currency ──────────────────────
      granular: {
        eu: {
          processing: euData.processing,
          scheduled: {
            by_currency: euData.scheduled,
            detail: euData.scheduled_detail,
          },
          reserve: euData.reserve,
        },
        hk: {
          processing: hkData.processing,
          scheduled: {
            by_currency: hkData.scheduled,
            detail: hkData.scheduled_detail,
          },
          reserve: hkData.reserve,
        },
      },

      // ── Aggregated: processing + scheduled + reserve summed per currency ─
      aggregated: {
        // Per-entity totals across all tabs
        eu: {
          by_currency: euAgg,
        },
        hk: {
          by_currency: hkAgg,
        },
        // Grand total across both entities
        total: {
          by_currency: grandTotal,
        },
      },
    };

    log.info('delivering_to_webhook');
    await deliverJson(process.env.BALANCES_WEBHOOK_URL!, payload, log, PARTNER);

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
