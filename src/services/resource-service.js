import { executeOracleQuery } from '../database/oracle-db.js';
import { getLocalDb } from '../database/local-db.js';
import { createLogger } from '../utils/logger.js';
import { createStatFingerprint, STAT_NAMES } from '../utils/resource-helpers.js';
import { sendDiscordAlert } from '../utils/alerts.js';

const logger = createLogger('resource-service');

/**
 * SQL query to fetch active resources from Oracle (ACTIVE_RESOURCES_DATA view)
 * Data format: one row per resource attribute
 * Columns: RESOURCE_ID, RESOURCE_NAME, RESOURCE_CLASS, ATTRIBUTE_NAME, ATTRIBUTE_VALUE
 */
const FETCH_ACTIVE_RESOURCES_SQL = `
  SELECT 
    RESOURCE_ID,
    RESOURCE_NAME,
    RESOURCE_CLASS,
    ATTRIBUTE_NAME,
    ATTRIBUTE_VALUE
  FROM ACTIVE_RESOURCES_DATA
  ORDER BY RESOURCE_ID
`;

/**
 * Attribute name mapping from Oracle to internal stat names
 */
const ATTRIBUTE_MAP = {
  'res_quality': 'OQ',
  'res_conductivity': 'CD',
  'res_decay_resist': 'DR',
  'res_flavor': 'FL',
  'res_heat_resist': 'HR',
  'res_malleability': 'MA',
  'res_potential_energy': 'PE',
  'res_shock_resistance': 'SR',
  'res_toughness': 'UT',
  'res_cold_resist': 'CR',
  'entangle_resistance': 'ER',
  // Alternate names that might be used
  'res_overall_quality': 'OQ',
  'res_unit_toughness': 'UT',
};

/**
 * Fetch active resources from Oracle database
 * Data is normalized (one row per attribute), so we need to pivot it
 * @returns {Promise<Map<string, Object>>} Map of resource_id to resource data
 */
export async function fetchActiveResourcesFromOracle() {
  logger.info('Fetching active resources from Oracle...');

  try {
    const result = await executeOracleQuery(FETCH_ACTIVE_RESOURCES_SQL);

    // Group rows by resource_id and pivot attributes
    const resourceMap = new Map();

    for (const row of result.rows) {
      const resourceId = String(row.RESOURCE_ID);

      if (!resourceMap.has(resourceId)) {
        resourceMap.set(resourceId, {
          resource_id: resourceId,
          resource_name: row.RESOURCE_NAME,
          resource_class: row.RESOURCE_CLASS,
          planet: null, // Not available in this view
          stats: {
            OQ: 0, CD: 0, DR: 0, FL: 0, HR: 0,
            MA: 0, PE: 0, SR: 0, UT: 0, CR: 0, ER: 0,
          },
          spawn_time: null,
          despawn_time: null,
        });
      }

      // Map attribute name to stat code and set value
      const statCode = ATTRIBUTE_MAP[row.ATTRIBUTE_NAME];
      if (statCode) {
        const resource = resourceMap.get(resourceId);
        const value = parseInt(row.ATTRIBUTE_VALUE, 10);
        if (!isNaN(value)) {
          resource.stats[statCode] = value;
        }
      }
    }

    logger.info({ count: resourceMap.size, rowsProcessed: result.rows.length }, 'Fetched active resources from Oracle');
    return resourceMap;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch resources from Oracle');
    throw error;
  }
}

/**
 * Get all resources from local database
 * @param {boolean} activeOnly - Only return active resources
 * @returns {Array} Array of resources
 */
export function getLocalResources(activeOnly = true) {
  const db = getLocalDb();
  const whereClause = activeOnly ? 'WHERE is_active = 1' : '';
  return db.prepare(`SELECT * FROM resources ${whereClause}`).all();
}

/**
 * Get a single resource by ID
 * @param {string} resourceId - Resource ID
 * @returns {Object|null} Resource or null
 */
export function getResourceById(resourceId) {
  const db = getLocalDb();
  return db.prepare('SELECT * FROM resources WHERE resource_id = ?').get(resourceId);
}

/**
 * Get resources by class
 * @param {string} resourceClass - Resource class name
 * @param {boolean} activeOnly - Only return active resources
 * @returns {Array} Array of resources
 */
export function getResourcesByClass(resourceClass, activeOnly = true) {
  const db = getLocalDb();
  const activeClause = activeOnly ? 'AND is_active = 1' : '';
  return db.prepare(`
    SELECT * FROM resources 
    WHERE resource_class = ? ${activeClause}
    ORDER BY resource_name
  `).all(resourceClass);
}


/**
 * Upsert a resource into local database
 * @param {Object} resource - Resource data
 * @returns {Object} Result with status
 */
export function upsertResource(resource) {
  const db = getLocalDb();
  const fingerprint = createStatFingerprint(resource.stats);

  const existing = db.prepare('SELECT * FROM resources WHERE resource_id = ?').get(resource.resource_id);

  if (existing) {
    // Update existing resource
    const stmt = db.prepare(`
      UPDATE resources SET
        resource_name = ?,
        resource_class = ?,
        planet = ?,
        stat_oq = ?,
        stat_cd = ?,
        stat_dr = ?,
        stat_fl = ?,
        stat_hr = ?,
        stat_ma = ?,
        stat_pe = ?,
        stat_sr = ?,
        stat_ut = ?,
        stat_cr = ?,
        stat_er = ?,
        stat_fingerprint = ?,
        spawn_time = ?,
        despawn_time = ?,
        is_active = 1,
        last_updated = CURRENT_TIMESTAMP
      WHERE resource_id = ?
    `);

    stmt.run(
      resource.resource_name,
      resource.resource_class,
      resource.planet,
      resource.stats.OQ,
      resource.stats.CD,
      resource.stats.DR,
      resource.stats.FL,
      resource.stats.HR,
      resource.stats.MA,
      resource.stats.PE,
      resource.stats.SR,
      resource.stats.UT,
      resource.stats.CR,
      resource.stats.ER,
      fingerprint,
      resource.spawn_time,
      resource.despawn_time,
      resource.resource_id
    );

    // Check if anything actually changed
    if (existing.stat_fingerprint !== fingerprint) {
      logResourceEvent(resource.resource_id, 'updated', { old_fingerprint: existing.stat_fingerprint, new_fingerprint: fingerprint });
      return { status: 'updated', resource_id: resource.resource_id };
    }

    return { status: 'unchanged', resource_id: resource.resource_id };
  } else {
    // Insert new resource
    const stmt = db.prepare(`
      INSERT INTO resources (
        resource_id, resource_name, resource_class, planet,
        stat_oq, stat_cd, stat_dr, stat_fl, stat_hr, stat_ma,
        stat_pe, stat_sr, stat_ut, stat_cr, stat_er,
        stat_fingerprint, spawn_time, despawn_time, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    stmt.run(
      resource.resource_id,
      resource.resource_name,
      resource.resource_class,
      resource.planet,
      resource.stats.OQ,
      resource.stats.CD,
      resource.stats.DR,
      resource.stats.FL,
      resource.stats.HR,
      resource.stats.MA,
      resource.stats.PE,
      resource.stats.SR,
      resource.stats.UT,
      resource.stats.CR,
      resource.stats.ER,
      fingerprint,
      resource.spawn_time,
      resource.despawn_time
    );

    logResourceEvent(resource.resource_id, 'spawned', { fingerprint });
    return { status: 'new', resource_id: resource.resource_id };
  }
}

/**
 * Mark resources as inactive (despawned)
 * @param {Array<string>} resourceIds - Array of resource IDs to mark inactive
 * @returns {number} Number of resources marked inactive
 */
export function markResourcesInactive(resourceIds) {
  if (!resourceIds.length) return 0;

  const db = getLocalDb();
  const stmt = db.prepare(`
    UPDATE resources 
    SET is_active = 0, despawn_time = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP
    WHERE resource_id = ? AND is_active = 1
  `);

  let count = 0;
  for (const resourceId of resourceIds) {
    const result = stmt.run(resourceId);
    if (result.changes > 0) {
      logResourceEvent(resourceId, 'despawned', {});
      count++;
    }
  }

  return count;
}

/**
 * Log a resource event to history
 * @param {string} resourceId - Resource ID
 * @param {string} eventType - Event type
 * @param {Object} eventData - Event data
 */
function logResourceEvent(resourceId, eventType, eventData) {
  const db = getLocalDb();
  db.prepare(`
    INSERT INTO resource_history (resource_id, event_type, event_data)
    VALUES (?, ?, ?)
  `).run(resourceId, eventType, JSON.stringify(eventData));
}

/**
 * Update best resource snapshots
 * @param {Object} resource - Resource data
 */
export function updateBestSnapshots(resource) {
  const db = getLocalDb();

  const statMapping = {
    OQ: 'stat_oq',
    CD: 'stat_cd',
    DR: 'stat_dr',
    FL: 'stat_fl',
    HR: 'stat_hr',
    MA: 'stat_ma',
    PE: 'stat_pe',
    SR: 'stat_sr',
    UT: 'stat_ut',
    CR: 'stat_cr',
    ER: 'stat_er',
  };

  for (const [statName, statValue] of Object.entries(resource.stats)) {
    if (statValue && statValue > 0) {
      // Check if this is a new best
      const current = db.prepare(`
        SELECT * FROM best_resource_snapshots
        WHERE resource_class = ? AND stat_name = ?
      `).get(resource.resource_class, statName);

      if (!current || statValue > current.stat_value) {
        db.prepare(`
          INSERT OR REPLACE INTO best_resource_snapshots 
          (resource_class, stat_name, resource_id, stat_value, snapshot_date)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(resource.resource_class, statName, resource.resource_id, statValue);

        logger.debug({
          resourceClass: resource.resource_class,
          stat: statName,
          value: statValue,
          previousBest: current?.stat_value
        }, 'New best resource snapshot');
      }
    }
  }
}

/**
 * Get best resources for a class
 * @param {string} resourceClass - Resource class
 * @returns {Object} Best resources by stat
 */
export function getBestByClass(resourceClass) {
  const db = getLocalDb();
  const snapshots = db.prepare(`
    SELECT brs.*, r.resource_name
    FROM best_resource_snapshots brs
    JOIN resources r ON brs.resource_id = r.resource_id
    WHERE brs.resource_class = ?
  `).all(resourceClass);

  const result = {};
  for (const snapshot of snapshots) {
    result[snapshot.stat_name] = {
      resourceId: snapshot.resource_id,
      resourceName: snapshot.resource_name,
      value: snapshot.stat_value,
      snapshotDate: snapshot.snapshot_date,
    };
  }

  return result;
}

/**
 * Get best active resource for a class
 * @param {string} resourceClass - Resource class
 * @param {string} stat - Stat name
 * @returns {Object|null} Best active resource
 */
export function getBestActiveByClassAndStat(resourceClass, stat) {
  const db = getLocalDb();
  const statColumn = `stat_${stat.toLowerCase()}`;

  return db.prepare(`
    SELECT * FROM resources
    WHERE resource_class = ? AND is_active = 1
    ORDER BY ${statColumn} DESC
    LIMIT 1
  `).get(resourceClass);
}

/**
 * Search resources by name
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Array} Matching resources
 */
export function searchResources(query, limit = 50) {
  const db = getLocalDb();
  return db.prepare(`
    SELECT * FROM resources
    WHERE resource_name LIKE ?
    ORDER BY is_active DESC, resource_name
    LIMIT ?
  `).all(`%${query}%`, limit);
}

/**
 * Get resource statistics
 * @returns {Object} Statistics
 */
export function getResourceStats() {
  const db = getLocalDb();

  const total = db.prepare('SELECT COUNT(*) as count FROM resources').get();
  const active = db.prepare('SELECT COUNT(*) as count FROM resources WHERE is_active = 1').get();
  const byClass = db.prepare(`
    SELECT resource_class, COUNT(*) as count, SUM(is_active) as active_count
    FROM resources
    GROUP BY resource_class
    ORDER BY count DESC
  `).all();

  return {
    total: total.count,
    active: active.count,
    inactive: total.count - active.count,
    byClass,
  };
}

