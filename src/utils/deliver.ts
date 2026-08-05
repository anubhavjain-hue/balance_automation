import { readFileSync } from 'fs';
import { basename } from 'path';
import type { Logger } from './logger.js';

export async function deliverJson(
  webhookUrl: string,
  payload: unknown,
  log: Logger,
  partner?: string
): Promise<void> {
  log.info('delivering_json', { url: webhookUrl });
  const body = partner && typeof payload === 'object' && payload !== null
    ? { partner, ...payload as object }
    : payload;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Webhook POST failed: ${res.status} ${res.statusText}`);
  }
  log.info('delivered_json');
}

export async function deliverFile(
  webhookUrl: string,
  filePath: string,
  contentType: string,
  log: Logger,
  partner?: string
): Promise<void> {
  log.info('delivering_file', { url: webhookUrl, file: filePath });
  const fileBuffer = readFileSync(filePath);
  const form = new FormData();
  form.append(
    'file',
    new Blob([fileBuffer], { type: contentType }),
    basename(filePath)
  );
  if (partner) form.append('partner', partner);
  const res = await fetch(webhookUrl, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`File webhook POST failed: ${res.status} ${res.statusText}`);
  }
  log.info('delivered_file');
}

export async function sendSlackAlert(
  partner: string,
  task: string,
  error: string,
  scriptPath: string
): Promise<void> {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!url) return;

  const payload = {
    text: `*Script failure* — \`${partner}/${task}\`\n> ${error}\nScript: \`${scriptPath}\`\nFallback agent triggered.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*:warning: Script failure — \`${partner}/${task}\`*\n\`\`\`${error}\`\`\`\nScript: \`${scriptPath}\`\n_Fallback agent triggered._`,
        },
      },
    ],
  };

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
