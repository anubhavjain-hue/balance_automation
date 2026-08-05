#!/usr/bin/env tsx
/**
 * Email OTP Fetcher for DOKU dashboard login.
 *
 * Connects to Gmail via IMAP using an App Password, searches for the latest
 * OTP email from noreply@doku.com, extracts the 6-digit code, and prints it
 * to stdout. The agent fills this code into the DOKU OTP form.
 *
 * Required env vars (in .env):
 *   GMAIL_USERNAME     - your Gmail/Google Workspace email
 *   GMAIL_APP_PASSWORD - 16-char app password from Google Account security settings
 *
 * Usage:
 *   npx tsx src/email-otp.ts
 */

import { ImapFlow } from "imapflow";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const DOKU_SENDER = "noreply@doku.com";
const OTP_REGEX = /\b(\d{6})\b/;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const LOOKBACK_MINUTES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchOtp(): Promise<string | null> {
  const username = process.env.GMAIL_USERNAME;
  const password = process.env.GMAIL_APP_PASSWORD;

  if (!username || !password) {
    process.stderr.write(
      "ERROR: GMAIL_USERNAME and GMAIL_APP_PASSWORD must be set in .env\n"
    );
    process.exit(1);
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: username, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    // Search for emails from DOKU sent within the last LOOKBACK_MINUTES
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
    const messages = await client.search({
      from: DOKU_SENDER,
      since,
    });

    if (!messages || messages.length === 0) {
      return null;
    }

    // Fetch the most recent match (last UID in the list)
    const uid = messages[messages.length - 1];
    let bodyText = "";

    for await (const msg of client.fetch([uid], { bodyParts: ["TEXT"], envelope: true })) {
      const textPart = msg.bodyParts?.get("text");
      if (textPart) {
        bodyText = Buffer.isBuffer(textPart)
          ? textPart.toString("utf-8")
          : String(textPart);
      }
    }

    if (!bodyText) return null;

    const match = OTP_REGEX.exec(bodyText);
    return match ? match[1] : null;
  } finally {
    await client.logout();
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const otp = await fetchOtp();
      if (otp) {
        process.stdout.write(otp + "\n");
        process.exit(0);
      }
    } catch (err) {
      process.stderr.write(`Attempt ${attempt} failed: ${err}\n`);
    }

    if (attempt < MAX_RETRIES) {
      process.stderr.write(
        `No OTP found yet. Retrying in ${RETRY_DELAY_MS / 1000}s... (attempt ${attempt}/${MAX_RETRIES})\n`
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  process.stderr.write(
    `ERROR: No OTP email from ${DOKU_SENDER} found in the last ${LOOKBACK_MINUTES} minutes after ${MAX_RETRIES} attempts.\n`
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
