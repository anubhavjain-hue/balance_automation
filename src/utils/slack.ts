/**
 * Slack error notification utility.
 * Sends an alert to the configured Slack channel when a script fails.
 * Reads SLACK_BOT_TOKEN and SLACK_CHANNEL_ID from the environment.
 */
export async function notifySlackError(
  partner: string,
  task: string,
  error: unknown
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;

  if (!token || !channel) return;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const timestamp = new Date().toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' UTC';

  const text =
    `:red_circle: *Script failure* — Provider: \`${partner}\` | Process: \`${task}\`\n` +
    `*Error:* \`${errorMessage}\`\n` +
    `*Time:* ${timestamp}`;

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  }).catch(() => {});
}
