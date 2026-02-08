import { initLocalDb, runMigrations } from './local-db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('migrate');

async function main() {
  try {
    logger.info('Starting database migration...');
    initLocalDb();
    runMigrations();
    logger.info('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error: error.message }, 'Migration failed');
    process.exit(1);
  }
}

main();

