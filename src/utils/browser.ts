import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';

chromium.use(StealthPlugin());
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const BASE_DIR = resolve(fileURLToPath(import.meta.url), '../../../');

export interface BrowserOptions {
  headed?: boolean;
  storageStatePath?: string;
  downloadDir?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  proxyUrl?: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  downloadDir: string;
}

export async function launchBrowser(
  partner: string,
  task: string,
  opts: BrowserOptions = {}
): Promise<BrowserSession> {
  const downloadDir =
    opts.downloadDir ??
    resolve(BASE_DIR, `.tmp/${partner}/${task}_${Date.now()}`);

  mkdirSync(downloadDir, { recursive: true });

  const browser = await chromium.launch({
    headless: opts.headed !== true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const contextOptions: Parameters<Browser['newContext']>[0] = {
    viewport: {
      width: opts.viewportWidth ?? 1920,
      height: opts.viewportHeight ?? 1080,
    },
    acceptDownloads: true,
    ...(opts.proxyUrl ? (() => {
      const u = new URL(opts.proxyUrl);
      return {
        proxy: {
          server: `${u.protocol}//${u.hostname}:${u.port}`,
          username: u.username || undefined,
          password: u.password || undefined,
        },
      };
    })() : {}),
  };

  if (opts.storageStatePath && existsSync(opts.storageStatePath)) {
    contextOptions.storageState = opts.storageStatePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  return { browser, context, page, downloadDir };
}

export async function saveSession(context: BrowserContext, path: string): Promise<void> {
  await context.storageState({ path });
}

export async function teardown(browser: Browser): Promise<void> {
  await browser.close();
}
