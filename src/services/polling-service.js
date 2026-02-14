import cron from 'node-cron';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { sendDiscordAlert } from '../utils/alerts.js';
import { getLocalDb } from '../database/local-db.js';
import {
  fetchActiveResourcesFromOracle,
  getLocalResources,
  upsertResource,
  markResourcesInactive,
  updateBestSnapshots,
} from './resource-service.js';
import { syncSchematics } from './schematic-service.js';
import { invalidateMatchCache, recomputeAffectedMatches } from './matching-service.js';
import { syncWaypointsFromOracle, pruneDuplicateWaypoints } from './waypoint-service.js';
import { ensureSTFReaderLoaded } from '../parsers/stf-parser.js';
import { pollStatus } from './status-service.js';

const logger = createLogger('polling-service');

let resourcePollJob = null;
let schematicPollJob = null;
let waypointPollJob = null;
let statusPollJob = null;
let isPolling = false;

/**
 * Poll resources from Oracle and sync to local database
 * @returns {Object} Poll statistics
 */
export async function pollResources() {
  if (isPolling) {
    logger.warn('Resource poll already in progress, skipping');
    return null;
  }

  isPolling = true;
  const startTime = Date.now();

  const stats = {
    processed: 0,
    new: 0,
    updated: 0,
    unchanged: 0,
    despawned: 0,
    errors: 0,
    changedClasses: new Set(),
  };

  try {
    logger.info('Starting resource poll from Oracle');

    // Fetch active resources from Oracle
    const oracleResources = await fetchActiveResourcesFromOracle();

    // Get currently active local resources
    const localResources = getLocalResources(true);
    const localResourceIds = new Set(localResources.map(r => r.resource_id));
    const oracleResourceIds = new Set(oracleResources.keys());

    // Process each Oracle resource
    for (const [resourceId, resource] of oracleResources) {
      try {
        const result = upsertResource(resource);
        stats.processed++;

        if (result.status === 'new') {
          stats.new++;
          stats.changedClasses.add(resource.resource_class);
          updateBestSnapshots(resource);
        } else if (result.status === 'updated') {
          stats.updated++;
          stats.changedClasses.add(resource.resource_class);
          updateBestSnapshots(resource);
        } else {
          stats.unchanged++;
        }
      } catch (error) {
        logger.error({ error: error.message, resourceId }, 'Error processing resource');
        stats.errors++;
      }
    }

    // Find despawned resources (in local but not in Oracle)
    const despawnedIds = [];
    for (const localResource of localResources) {
      if (!oracleResourceIds.has(localResource.resource_id)) {
        despawnedIds.push(localResource.resource_id);
        stats.changedClasses.add(localResource.resource_class);
      }
    }

    // Mark despawned resources as inactive
    if (despawnedIds.length > 0) {
      stats.despawned = markResourcesInactive(despawnedIds);
    }

    // Invalidate and recompute matches if resources changed
    if (stats.changedClasses.size > 0) {
      invalidateMatchCache();
      recomputeAffectedMatches(Array.from(stats.changedClasses));
    }

    const duration = Date.now() - startTime;
    logger.info({ ...stats, changedClasses: stats.changedClasses.size, durationMs: duration }, 'Resource poll completed');

    // Log poll to database
    logPoll('resource', 'success', stats, startTime);

    // Alert on significant changes
    if (stats.new > 10 || stats.despawned > 10) {
      await sendDiscordAlert(
        'Resource Update',
        `New: ${stats.new}, Despawned: ${stats.despawned}, Updated: ${stats.updated}`,
        'info'
      );
    }

    return stats;
  } catch (error) {
    logger.error({ error: error.message }, 'Resource poll failed');
    logPoll('resource', 'error', stats, startTime, error.message);
    await sendDiscordAlert('Resource Poll Failed', error.message, 'error');
    throw error;
  } finally {
    isPolling = false;
  }
}

/**
 * Poll and sync schematics from disk
 * @returns {Object} Sync statistics
 */
export async function pollSchematics() {
  const startTime = Date.now();

  try {
    // Ensure STF reader is loaded before syncing
    await ensureSTFReaderLoaded();

    logger.info('Starting schematic sync');
    const stats = syncSchematics();

    const duration = Date.now() - startTime;
    logger.info({ ...stats, durationMs: duration }, 'Schematic sync completed');

    logPoll('schematic', 'success', stats, startTime);

    return stats;
  } catch (error) {
    logger.error({ error: error.message }, 'Schematic sync failed');
    logPoll('schematic', 'error', {}, startTime, error.message);
    await sendDiscordAlert('Schematic Sync Failed', error.message, 'error');
    throw error;
  }
}

/**
 * Log a poll event to database
 * @param {string} pollType - Type of poll
 * @param {string} status - Poll status
 * @param {Object} stats - Poll statistics
 * @param {number} startTime - Start timestamp
 * @param {string} errorMessage - Error message if any
 */
function logPoll(pollType, status, stats, startTime, errorMessage = null) {
  const db = getLocalDb();

  db.prepare(`
    INSERT INTO poll_log (
      poll_type, status, 
      resources_processed, new_resources, updated_resources, despawned_resources,
      error_message, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pollType,
    status,
    stats.processed || stats.found || 0,
    stats.new || stats.added || 0,
    stats.updated || 0,
    stats.despawned || 0,
    errorMessage,
    new Date(startTime).toISOString()
  );
}

/**
 * Start the polling scheduler
 */
export function startPolling() {
  const interval = config.polling.intervalMinutes;

  // Resource polling - every N minutes
  const resourceCron = `*/${interval} * * * *`;
  resourcePollJob = cron.schedule(resourceCron, async () => {
    try {
      await pollResources();
    } catch (error) {
      logger.error({ error: error.message }, 'Scheduled resource poll failed');
    }
  });

  // Schematic polling - every hour
  schematicPollJob = cron.schedule('0 * * * *', async () => {
    try {
      await pollSchematics();
    } catch (error) {
      logger.error({ error: error.message }, 'Scheduled schematic poll failed');
    }
  });

  // Server status polling - every 5 minutes
  statusPollJob = cron.schedule('*/5 * * * *', async () => {
    try {
      await pollStatus();
    } catch (error) {
      logger.error({ error: error.message }, 'Scheduled status poll failed');
    }
  });

  // Waypoint polling - once daily at 4:00 AM
  waypointPollJob = cron.schedule('0 4 * * *', async () => {
    try {
      const stats = await syncWaypointsFromOracle();
      logger.info(stats, 'Scheduled waypoint sync completed');
      logPoll('waypoint', 'success', stats, Date.now());
      const prune = pruneDuplicateWaypoints();
      if (prune.deleted > 0) {
        logger.info(prune, 'Scheduled waypoint prune completed');
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Scheduled waypoint sync failed');
      logPoll('waypoint', 'error', {}, Date.now(), error.message);
    }
  });

  logger.info({ resourceInterval: `${interval} minutes`, schematicInterval: '1 hour', waypointInterval: 'daily 4:00 AM', statusInterval: '5 minutes' }, 'Polling scheduler started');

  // Run initial polls
  setTimeout(async () => {
    try {
      await pollSchematics();
    } catch (error) {
      logger.error({ error: error.message }, 'Initial schematic poll failed');
    }

    try {
      await pollResources();
    } catch (error) {
      logger.error({ error: error.message }, 'Initial resource poll failed');
    }

    try {
      await syncWaypointsFromOracle();
      logger.info('Initial waypoint sync completed');
      const prune = pruneDuplicateWaypoints();
      if (prune.deleted > 0) {
        logger.info(prune, 'Initial waypoint prune completed');
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Initial waypoint sync failed');
    }

    try {
      await pollStatus();
      logger.info('Initial status poll completed');
    } catch (error) {
      logger.error({ error: error.message }, 'Initial status poll failed');
    }
  }, 5000);
}

/**
 * Stop the polling scheduler
 */
export function stopPolling() {
  if (resourcePollJob) {
    resourcePollJob.stop();
    resourcePollJob = null;
  }

  if (schematicPollJob) {
    schematicPollJob.stop();
    schematicPollJob = null;
  }

  if (waypointPollJob) {
    waypointPollJob.stop();
    waypointPollJob = null;
  }

  if (statusPollJob) {
    statusPollJob.stop();
    statusPollJob = null;
  }

  logger.info('Polling scheduler stopped');
}

/**
 * Get poll history
 * @param {number} limit - Max records
 * @returns {Array} Poll history
 */
export function getPollHistory(limit = 100) {
  const db = getLocalDb();
  return db.prepare(`
    SELECT * FROM poll_log
    ORDER BY completed_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get last successful poll time
 * @param {string} pollType - Type of poll
 * @returns {Object|null} Last poll info
 */
export function getLastSuccessfulPoll(pollType) {
  const db = getLocalDb();
  return db.prepare(`
    SELECT * FROM poll_log
    WHERE poll_type = ? AND status = 'success'
    ORDER BY completed_at DESC
    LIMIT 1
  `).get(pollType);
}

