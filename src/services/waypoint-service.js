/**
 * Waypoint Service
 *
 * Two sources of waypoints:
 *   - Oracle (source='oracle'): Canonical / game-server truth. Read-only in the app.
 *     Synced daily from the live game database. Cannot be edited or deleted locally.
 *   - Local  (source='local'):  User-created waypoints stored in SQLite. Fully editable.
 *
 * Oracle tables used (from DDL, source of truth: ORACLE_CONNECTIONS.txt):
 *   - WAYPOINTS:       OBJECT_ID NUMBER(20), WAYPOINT_ID NUMBER(20) PK,
 *                      APPEARANCE_NAME_CRC NUMBER(*,0), LOCATION_X FLOAT, LOCATION_Y FLOAT,
 *                      LOCATION_Z FLOAT, LOCATION_CELL NUMBER(20), LOCATION_SCENE NUMBER(*,0),
 *                      NAME VARCHAR2(512), COLOR NUMBER(*,0), ACTIVE CHAR(1)
 *   - PLANET_OBJECTS:  OBJECT_ID NUMBER(20) PK, PLANET_NAME VARCHAR2(100)
 *     (WAYPOINTS.LOCATION_SCENE = PLANET_OBJECTS.OBJECT_ID to resolve planet name)
 */

import { executeOracleQuery } from '../database/oracle-db.js';
import { getLocalDb } from '../database/local-db.js';
import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('waypoint-service');

/**
 * Planet map sizes in game-world meters (diameter).
 * Maps are 4096x4096 pixel images representing 16384m x 16384m (range -8192 to +8192).
 * Center of map image = world coordinate 0,0.
 */
export const PLANET_MAP_CONFIG = {
  tatooine:      { mapSize: 16384, displayName: 'Tatooine' },
  corellia:      { mapSize: 16384, displayName: 'Corellia' },
  dantooine:     { mapSize: 16384, displayName: 'Dantooine' },
  dathomir:      { mapSize: 16384, displayName: 'Dathomir' },
  endor:         { mapSize: 16384, displayName: 'Endor' },
  lok:           { mapSize: 16384, displayName: 'Lok' },
  naboo:         { mapSize: 16384, displayName: 'Naboo' },
  rori:          { mapSize: 16384, displayName: 'Rori' },
  talus:         { mapSize: 16384, displayName: 'Talus' },
  yavin4:        { mapSize: 16384, displayName: 'Yavin IV' },
};

// ===== Oracle Fetch (daily sync) =====

/**
 * SQL to fetch waypoints from Oracle.
 * WAYPOINTS table columns (source of truth):
 *   OBJECT_ID NUMBER(20,0), WAYPOINT_ID NUMBER(20,0), APPEARANCE_NAME_CRC NUMBER(38,0),
 *   LOCATION_X/Y/Z FLOAT, LOCATION_CELL NUMBER(20,0), LOCATION_SCENE NUMBER(38,0),
 *   NAME VARCHAR2(512), COLOR NUMBER(38,0), ACTIVE CHAR(1).
 * LOCATION_SCENE = PLANET_OBJECTS.OBJECT_ID to resolve planet name.
 * In-game waypoints supplement browser-added (local) waypoints on the map.
 */
const FETCH_WAYPOINTS_SQL = `
  SELECT
    w.OBJECT_ID,
    w.WAYPOINT_ID,
    w.APPEARANCE_NAME_CRC,
    w.LOCATION_X,
    w.LOCATION_Y,
    w.LOCATION_Z,
    w.LOCATION_CELL,
    w.LOCATION_SCENE,
    w.NAME,
    w.COLOR,
    w.ACTIVE
  FROM WAYPOINTS w
`;

// ===== LOCATION_SCENE (int) to planet mapping =====

/**
 * Get planet key for a LOCATION_SCENE integer (from admin-configured mapping).
 * @param {number} locationScene
 * @returns {string|null} Planet key (e.g. 'tatooine') or null
 */
export function getPlanetForLocationScene(locationScene) {
  if (locationScene == null) return null;
  const db = getLocalDb();
  const row = db.prepare('SELECT planet FROM location_scene_planet_mappings WHERE location_scene = ?').get(Number(locationScene));
  return row ? row.planet : null;
}

/**
 * Get all LOCATION_SCENE → planet mappings
 * @returns {Array<{id, location_scene, planet}>}
 */
export function getLocationSceneMappings() {
  const db = getLocalDb();
  return db.prepare('SELECT id, location_scene, planet, created_at FROM location_scene_planet_mappings ORDER BY location_scene').all();
}

/**
 * Add or update a LOCATION_SCENE → planet mapping
 * @param {number} locationScene
 * @param {string} planet - Planet key (e.g. 'tatooine', 'naboo')
 */
export function setLocationSceneMapping(locationScene, planet) {
  const db = getLocalDb();
  const scene = Number(locationScene);
  const planetTrim = (planet || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!planetTrim) throw new Error('Planet is required');
  db.prepare(`
    INSERT INTO location_scene_planet_mappings (location_scene, planet)
    VALUES (?, ?)
    ON CONFLICT(location_scene) DO UPDATE SET planet = excluded.planet
  `).run(scene, planetTrim);
  logger.info({ locationScene: scene, planet: planetTrim }, 'Location scene mapping saved');
}

/**
 * Delete a LOCATION_SCENE mapping by id or by location_scene value
 * @param {number|string} idOrScene - Row id or location_scene value
 */
export function deleteLocationSceneMapping(idOrScene) {
  const db = getLocalDb();
  const n = Number(idOrScene);
  if (Number.isInteger(n) && n > 0 && n < 1e10) {
    const byId = db.prepare('DELETE FROM location_scene_planet_mappings WHERE id = ?').run(n);
    if (byId.changes > 0) return;
  }
  db.prepare('DELETE FROM location_scene_planet_mappings WHERE location_scene = ?').run(Number(idOrScene));
}

/**
 * Fetch waypoints from Oracle database.
 * Planet is resolved from LOCATION_SCENE (int) via admin-configured mapping; PLANET_OBJECTS join no longer used.
 */
export async function fetchWaypointsFromOracle() {
  logger.info('Fetching waypoints from Oracle...');

  try {
    const result = await executeOracleQuery(FETCH_WAYPOINTS_SQL);

    logger.info({ totalRows: result.rows ? result.rows.length : 0 }, 'Oracle query returned rows');

    if (result.rows && result.rows.length > 0) {
      const sample = result.rows[0];
      logger.debug({ columns: Object.keys(sample), sample }, 'Sample row from Oracle');
    }

    const waypoints = [];
    let skippedNoPlanet = 0;
    for (const row of result.rows) {
      const sceneId = row.LOCATION_SCENE != null ? Number(row.LOCATION_SCENE) : null;
      let planet = getPlanetForLocationScene(sceneId);
      if (!planet) {
        skippedNoPlanet++;
        if (skippedNoPlanet <= 3) {
          logger.warn({ waypointId: row.WAYPOINT_ID, locationScene: sceneId }, 'No planet mapping for LOCATION_SCENE, skipping waypoint. Add mapping in Admin → LOCATION_SCENE to Planet.');
        }
        continue;
      }

      const active = (row.ACTIVE === 'Y' || row.ACTIVE === 1 || row.ACTIVE === true) ? 1 : 0;

      waypoints.push({
        waypoint_id: String(row.WAYPOINT_ID),
        object_id: row.OBJECT_ID ? String(row.OBJECT_ID) : null,
        name: row.NAME || 'Waypoint',
        planet,
        x: row.LOCATION_X || 0,
        y: row.LOCATION_Y || 0,
        z: row.LOCATION_Z || 0,
        color: row.COLOR || 0,
        active,
        source: 'oracle',
      });
    }

    if (skippedNoPlanet > 0) {
      logger.warn({ skippedNoPlanet }, 'Waypoints skipped (no LOCATION_SCENE→planet mapping). Add mappings in Admin panel.');
    }

    logger.info({ count: waypoints.length, rowsProcessed: result.rows.length }, 'Fetched waypoints from Oracle');
    return waypoints;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch waypoints from Oracle');
    throw error;
  }
}

/**
 * Sync Oracle waypoints into local database.
 * Only updates oracle-sourced waypoints; local waypoints are untouched.
 * @returns {Object} Sync statistics
 */
export async function syncWaypointsFromOracle() {
  const stats = { fetched: 0, added: 0, updated: 0, removed: 0, errors: 0 };

  try {
    const oracleWaypoints = await fetchWaypointsFromOracle();
    stats.fetched = oracleWaypoints.length;

    const db = getLocalDb();

    // Get existing oracle-sourced waypoint IDs
    const existingOracle = db.prepare(
      "SELECT waypoint_id FROM waypoints WHERE source = 'oracle'"
    ).all();
    const existingIds = new Set(existingOracle.map(r => r.waypoint_id));
    const incomingIds = new Set(oracleWaypoints.map(w => w.waypoint_id));

    // Upsert incoming waypoints
    const upsertStmt = db.prepare(`
      INSERT INTO waypoints (waypoint_id, object_id, name, planet, x, y, z, color, active, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'oracle', CURRENT_TIMESTAMP)
      ON CONFLICT(waypoint_id) DO UPDATE SET
        object_id = excluded.object_id,
        name = excluded.name,
        planet = excluded.planet,
        x = excluded.x,
        y = excluded.y,
        z = excluded.z,
        color = excluded.color,
        active = excluded.active,
        updated_at = CURRENT_TIMESTAMP
    `);

    const upsertMany = db.transaction((waypoints) => {
      for (const wp of waypoints) {
        try {
          const result = upsertStmt.run(
            wp.waypoint_id, wp.object_id, wp.name,
            wp.planet, wp.x, wp.y, wp.z,
            wp.color, wp.active
          );
          if (existingIds.has(wp.waypoint_id)) {
            stats.updated++;
          } else {
            stats.added++;
          }
        } catch (error) {
          logger.error({ error: error.message, waypointId: wp.waypoint_id }, 'Failed to upsert waypoint');
          stats.errors++;
        }
      }
    });

    upsertMany(oracleWaypoints);

    // Remove oracle waypoints no longer present
    const toRemove = [...existingIds].filter(id => !incomingIds.has(id));
    if (toRemove.length > 0) {
      const deleteStmt = db.prepare("DELETE FROM waypoints WHERE waypoint_id = ? AND source = 'oracle'");
      for (const id of toRemove) {
        deleteStmt.run(id);
        stats.removed++;
      }
    }

    logger.info(stats, 'Waypoint sync from Oracle completed');
    return stats;
  } catch (error) {
    logger.error({ error: error.message }, 'Waypoint sync failed');
    stats.errors++;
    return stats;
  }
}

// ===== Local CRUD operations =====

/**
 * Get all waypoints, optionally filtered by planet
 * @param {string} [planet] - Filter by planet
 * @returns {Array} Waypoints
 */
export function getWaypoints(planet) {
  const db = getLocalDb();

  if (planet) {
    return db.prepare('SELECT * FROM waypoints WHERE planet = ? ORDER BY name').all(planet);
  }
  return db.prepare('SELECT * FROM waypoints ORDER BY planet, name').all();
}

/**
 * Get a single waypoint by ID
 * @param {string} waypointId
 * @returns {Object|null}
 */
export function getWaypointById(waypointId) {
  const db = getLocalDb();
  return db.prepare('SELECT * FROM waypoints WHERE waypoint_id = ?').get(waypointId);
}

/**
 * Create a new local waypoint
 * @param {Object} data - { name, planet, x, y, z, color }
 * @returns {Object} Created waypoint
 */
export function createWaypoint(data) {
  const db = getLocalDb();
  const waypointId = `local_${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO waypoints (waypoint_id, name, planet, x, y, z, color, active, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'local')
  `).run(
    waypointId,
    data.name || 'Waypoint',
    data.planet,
    data.x || 0,
    data.y || 0,
    data.z || 0,
    data.color || 0
  );

  return getWaypointById(waypointId);
}

/**
 * Update a LOCAL waypoint (name, coordinates, color).
 * Oracle waypoints are canonical and cannot be edited.
 * @param {string} waypointId
 * @param {Object} data - Fields to update
 * @returns {Object|null} Updated waypoint, or null if not found
 * @throws {Error} If attempting to edit an Oracle waypoint
 */
export function updateWaypoint(waypointId, data) {
  const db = getLocalDb();

  const existing = getWaypointById(waypointId);
  if (!existing) return null;

  if (existing.source === 'oracle') {
    throw new Error('Cannot edit server waypoints. They are read-only from the game server.');
  }

  const fields = [];
  const values = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.x !== undefined) { fields.push('x = ?'); values.push(data.x); }
  if (data.y !== undefined) { fields.push('y = ?'); values.push(data.y); }
  if (data.z !== undefined) { fields.push('z = ?'); values.push(data.z); }
  if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color); }
  if (data.planet !== undefined) { fields.push('planet = ?'); values.push(data.planet); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(waypointId);

  db.prepare(`UPDATE waypoints SET ${fields.join(', ')} WHERE waypoint_id = ?`).run(...values);

  return getWaypointById(waypointId);
}

/**
 * Delete a LOCAL waypoint.
 * Oracle waypoints are canonical and cannot be deleted.
 * @param {string} waypointId
 * @returns {boolean} Whether the waypoint was deleted
 * @throws {Error} If attempting to delete an Oracle waypoint
 */
export function deleteWaypoint(waypointId) {
  const db = getLocalDb();

  const existing = getWaypointById(waypointId);
  if (!existing) return false;

  if (existing.source === 'oracle') {
    throw new Error('Cannot delete server waypoints. They are read-only from the game server.');
  }

  const result = db.prepare('DELETE FROM waypoints WHERE waypoint_id = ?').run(waypointId);
  return result.changes > 0;
}

/**
 * Get waypoint statistics
 * @returns {Object}
 */
export function getWaypointStats() {
  const db = getLocalDb();

  const total = db.prepare('SELECT COUNT(*) as count FROM waypoints').get();
  const byPlanet = db.prepare(`
    SELECT planet, COUNT(*) as count
    FROM waypoints
    GROUP BY planet
    ORDER BY count DESC
  `).all();
  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM waypoints
    GROUP BY source
  `).all();

  return {
    total: total.count,
    byPlanet,
    bySource,
  };
}

/**
 * Clear all LOCAL waypoints from database. Oracle (server) waypoints are preserved.
 * @returns {number} Number of local waypoints deleted
 */
export function clearLocalWaypoints() {
  const db = getLocalDb();
  const result = db.prepare("DELETE FROM waypoints WHERE source = 'local'").run();
  logger.info({ deleted: result.changes }, 'Cleared local waypoints (server waypoints preserved)');
  return result.changes;
}

/**
 * Clear ALL waypoints from database (both local and cached oracle).
 * Oracle waypoints will be re-fetched on next sync.
 * @returns {number} Number of waypoints deleted
 */
export function clearAllWaypoints() {
  const db = getLocalDb();
  const result = db.prepare('DELETE FROM waypoints').run();
  logger.info({ deleted: result.changes }, 'Cleared all waypoints (local + cached oracle)');
  return result.changes;
}

// ===== Waypoint creation toggle =====

// In-memory toggle for whether users can create waypoints from the map.
// Persisted to the app_settings table if available, otherwise memory-only.
let waypointCreationEnabled = true;

/**
 * Get whether waypoint creation is enabled
 * @returns {boolean}
 */
export function isWaypointCreationEnabled() {
  return waypointCreationEnabled;
}

/**
 * Set whether waypoint creation is enabled
 * @param {boolean} enabled
 */
export function setWaypointCreationEnabled(enabled) {
  waypointCreationEnabled = !!enabled;
  logger.info({ enabled: waypointCreationEnabled }, 'Waypoint creation toggled');
}

/**
 * Get list of available planets (those that have map images)
 * @returns {Array} Planet info objects
 */
export function getAvailablePlanets() {
  return Object.entries(PLANET_MAP_CONFIG).map(([name, cfg]) => ({
    name,
    displayName: cfg.displayName,
    mapSize: cfg.mapSize,
    mapImage: `ui_map_${name}.png`,
  }));
}
