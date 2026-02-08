import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('discord-alerts');

/**
 * Send an alert to Discord webhook
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @param {'info'|'warning'|'error'} severity - Alert severity
 */
export async function sendDiscordAlert(title, message, severity = 'info') {
  if (!config.alerts.enableDiscord || !config.alerts.discordWebhookUrl) {
    return;
  }

  const colors = {
    info: 0x3498db,
    warning: 0xf39c12,
    error: 0xe74c3c,
  };

  const payload = {
    embeds: [
      {
        title: `[Chuba] ${title}`,
        description: message,
        color: colors[severity] || colors.info,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Chuba Titan Tracker',
        },
      },
    ],
  };

  try {
    const response = await fetch(config.alerts.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to send Discord alert');
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Error sending Discord alert');
  }
}

