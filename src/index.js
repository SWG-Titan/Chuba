import { config } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { initLocalDb, runMigrations, closeLocalDb } from './database/local-db.js';
import { initOraclePool, closeOraclePool } from './database/oracle-db.js';
import { startServer } from './api/server.js';
import { startPolling, stopPolling } from './services/polling-service.js';
import { sendDiscordAlert } from './utils/alerts.js';
import { ensureSTFReaderLoaded } from './parsers/index.js';

const logger = createLogger('main');

let server = null;

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');

  try {
    // Stop polling
    stopPolling();

    // Close server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      logger.info('API server stopped');
    }

    // Close database connections
    await closeOraclePool();
    closeLocalDb();

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error: error.message }, 'Error during shutdown');
    process.exit(1);
  }
}

/**
 * Main application entry point
 */
async function main() {
  logger.info('Starting Chuba - Titan Tracker...');
  logger.info({ config: { ...config, oracle: { ...config.oracle, password: '***' } } }, 'Configuration loaded');

  try {
    // Initialize local database
    initLocalDb();
    runMigrations();

    // Initialize STF reader (for string file parsing)
    await ensureSTFReaderLoaded();

    // Initialize Oracle connection pool (optional - may fail if Oracle not available)
    try {
      await initOraclePool();
    } catch (error) {
      logger.warn({ error: error.message }, 'Oracle connection failed - running in offline mode');
    }

    // Start API server
    server = await startServer();

    // Start polling scheduler
    startPolling();

    // Send startup notification
    await sendDiscordAlert('Service Started', 'Chuba - Titan Tracker is now online', 'info');

    logger.info('Chuba Titan Tracker started successfully');
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to start service');
    await sendDiscordAlert('Service Failed to Start', error.message, 'error');
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
  await sendDiscordAlert('Uncaught Exception', error.message, 'error');
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
  await sendDiscordAlert('Unhandled Rejection', String(reason), 'error');
});

// Start the application
main();

