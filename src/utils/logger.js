import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logging.level,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

/**
 * Create a child logger with a specific context
 * @param {string} context - The context name for the logger
 * @returns {pino.Logger}
 */
export function createLogger(context) {
  return logger.child({ context });
}

