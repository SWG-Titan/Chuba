/**
 * Player Service
 * Search players and retrieve inventory trees from Oracle.
 */
import { executeOracleQuery, getOracleConnection } from '../database/oracle-db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('player-service');

/**
 * Search players by character name
 * @param {string} query - Character name search term
 * @returns {Array} Matching players
 */
export async function searchPlayers(query) {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const searchTerm = `%${query.trim().toUpperCase()}%`;

  const sql = `
    SELECT
      p.CHARACTER_OBJECT,
      p.STATION_ID,
      o.OBJECT_NAME,
      o.X,
      o.Y,
      o.Z,
      o.SCENE_ID,
      o.CASH_BALANCE,
      o.BANK_BALANCE,
      o.OBJECT_TEMPLATE_ID
    FROM PLAYERS p
    JOIN OBJECTS o ON p.CHARACTER_OBJECT = o.OBJECT_ID
    WHERE UPPER(o.OBJECT_NAME) LIKE :searchTerm
      AND (o.DELETED = 0 OR o.DELETED IS NULL)
    ORDER BY o.OBJECT_NAME
    FETCH FIRST 100 ROWS ONLY
  `;

  try {
    const result = await executeOracleQuery(sql, { searchTerm });
    const rows = result.rows || [];
    logger.info({ query, count: rows.length }, 'Player search completed');

    return rows.map(row => ({
      characterObjectId: String(row.CHARACTER_OBJECT),
      stationId: String(row.STATION_ID ?? ''),
      name: row.OBJECT_NAME || 'Unknown',
      planet: row.SCENE_ID || 'unknown',
      x: row.X || 0,
      y: row.Y || 0,
      z: row.Z || 0,
      cash: row.CASH_BALANCE || 0,
      bank: row.BANK_BALANCE || 0,
      templateId: row.OBJECT_TEMPLATE_ID,
    }));
  } catch (error) {
    logger.error({ error: error.message, query }, 'Player search failed');
    throw error;
  }
}

/**
 * Get full player details
 * @param {string|number} characterObjectId
 * @returns {Object|null}
 */
export async function getPlayerDetails(characterObjectId) {
  const sql = `
    SELECT
      p.CHARACTER_OBJECT,
      p.STATION_ID,
      o.OBJECT_NAME,
      o.X, o.Y, o.Z,
      o.SCENE_ID,
      o.CASH_BALANCE,
      o.BANK_BALANCE,
      o.OBJECT_TEMPLATE_ID
    FROM PLAYERS p
    JOIN OBJECTS o ON p.CHARACTER_OBJECT = o.OBJECT_ID
    WHERE p.CHARACTER_OBJECT = :charId
  `;

  try {
    const result = await executeOracleQuery(sql, { charId: characterObjectId });
    const row = result.rows?.[0];
    if (!row) return null;

    return {
      characterObjectId: String(row.CHARACTER_OBJECT),
      stationId: String(row.STATION_ID ?? ''),
      name: row.OBJECT_NAME || 'Unknown',
      planet: row.SCENE_ID || 'unknown',
      x: row.X || 0,
      y: row.Y || 0,
      z: row.Z || 0,
      cash: row.CASH_BALANCE || 0,
      bank: row.BANK_BALANCE || 0,
      templateId: row.OBJECT_TEMPLATE_ID,
    };
  } catch (error) {
    logger.error({ error: error.message, characterObjectId }, 'Failed to get player details');
    throw error;
  }
}

/**
 * Get full recursive inventory tree for a player character.
 * Uses Oracle's CONNECT BY for hierarchical traversal of CONTAINED_BY.
 *
 * @param {string|number} characterObjectId
 * @returns {Array} Flat list of inventory objects with LEVEL for tree depth
 */
export async function getPlayerInventory(characterObjectId) {
  const sql = `
    SELECT
      OBJECT_ID,
      OBJECT_NAME,
      CONTAINED_BY,
      OBJECT_TEMPLATE_ID,
      VOLUME,
      CASH_BALANCE,
      BANK_BALANCE,
      STATIC_ITEM_NAME,
      STATIC_ITEM_VERSION,
      NAME_STRING_TABLE,
      NAME_STRING_TEXT,
      LEVEL AS TREE_DEPTH
    FROM OBJECTS
    START WITH CONTAINED_BY = :charId
    CONNECT BY PRIOR OBJECT_ID = CONTAINED_BY
    ORDER SIBLINGS BY OBJECT_NAME
  `;

  try {
    const result = await executeOracleQuery(sql, { charId: characterObjectId });
    const rows = result.rows || [];
    logger.info({ characterObjectId, itemCount: rows.length }, 'Retrieved player inventory');

    return rows.map(row => ({
      objectId: row.OBJECT_ID,
      name: row.OBJECT_NAME || row.STATIC_ITEM_NAME || row.NAME_STRING_TEXT || 'Unknown Object',
      containedBy: row.CONTAINED_BY,
      templateId: row.OBJECT_TEMPLATE_ID,
      volume: row.VOLUME || 0,
      cash: row.CASH_BALANCE || 0,
      bank: row.BANK_BALANCE || 0,
      staticItemName: row.STATIC_ITEM_NAME,
      stringTable: row.NAME_STRING_TABLE,
      stringText: row.NAME_STRING_TEXT,
      depth: row.TREE_DEPTH || 1,
    }));
  } catch (error) {
    logger.error({ error: error.message, characterObjectId }, 'Failed to get player inventory');
    throw error;
  }
}

/**
 * Build a tree structure from the flat inventory list
 * @param {Array} items - Flat inventory list with containedBy references
 * @param {string|number} rootId - The character object ID (root container)
 * @returns {Array} Nested tree structure
 */
export function buildInventoryTree(items, rootId) {
  const map = new Map();
  const roots = [];

  // Create map of all items
  for (const item of items) {
    map.set(String(item.objectId), { ...item, children: [] });
  }

  // Build tree
  for (const item of items) {
    const node = map.get(String(item.objectId));
    const parentId = String(item.containedBy);

    if (parentId === String(rootId)) {
      roots.push(node);
    } else if (map.has(parentId)) {
      map.get(parentId).children.push(node);
    } else {
      // Orphaned node -- attach to roots
      roots.push(node);
    }
  }

  return roots;
}

// ===== Players by Planet (admin only — for map overlay) =====

/**
 * Get all players on a given planet (SCENE_ID).
 * Returns lightweight records: name, x, y, z for map marker rendering.
 *
 * Per ORACLE_STRUCT:
 *   PLAYERS.CHARACTER_OBJECT NUMBER, OBJECTS.SCENE_ID VARCHAR2(50),
 *   OBJECTS.OBJECT_NAME VARCHAR2(127), OBJECTS.X/Y/Z NUMBER
 *
 * @param {string} planet - SCENE_ID value (e.g. "tatooine")
 * @returns {Promise<Array>} Array of { characterObjectId, name, x, y, z }
 */
export async function getPlayersByPlanet(planet) {
  const sql = `
    SELECT
      p.CHARACTER_OBJECT,
      o.OBJECT_NAME,
      o.X,
      o.Y,
      o.Z
    FROM PLAYERS p
    JOIN OBJECTS o ON p.CHARACTER_OBJECT = o.OBJECT_ID
    WHERE o.SCENE_ID = :planet
      AND (o.DELETED = 0 OR o.DELETED IS NULL)
    ORDER BY o.OBJECT_NAME
  `;

  try {
    const result = await executeOracleQuery(sql, { planet });
    const rows = result.rows || [];
    logger.info({ planet, count: rows.length }, 'Fetched players by planet');

    return rows.map(row => ({
      characterObjectId: String(row.CHARACTER_OBJECT),
      name: row.OBJECT_NAME || 'Unknown',
      x: row.X || 0,
      y: row.Y || 0,
      z: row.Z || 0,
    }));
  } catch (error) {
    logger.error({ error: error.message, planet }, 'Failed to fetch players by planet');
    throw error;
  }
}

// ===== Object Variables (admin only) =====

/**
 * Get object variables for a player character object.
 * Uses OBJECT_VARIABLES_VIEW which denormalises NAME_ID -> NAME.
 *
 * Per ORACLE_STRUCT:
 *   OBJECT_VARIABLES_VIEW: OBJECT_ID NUMBER(20,0), NAME VARCHAR2(500),
 *                          TYPE NUMBER(*,0), VALUE VARCHAR2(1000), PACKED NUMBER
 *
 * @param {string|number} objectId
 * @returns {Promise<Array>} Array of { name, type, value }
 */
export async function getPlayerObjvars(objectId) {
  const sql = `
    SELECT NAME, TYPE, VALUE
    FROM OBJECT_VARIABLES_VIEW
    WHERE OBJECT_ID = :objId
    ORDER BY NAME
  `;

  try {
    const result = await executeOracleQuery(sql, { objId: objectId });
    const rows = result.rows || [];
    logger.info({ objectId, count: rows.length }, 'Fetched player objvars');

    return rows.map(row => ({
      name: row.NAME || '',
      type: row.TYPE,
      value: row.VALUE || '',
    }));
  } catch (error) {
    logger.error({ error: error.message, objectId }, 'Failed to fetch player objvars');
    throw error;
  }
}

// ===== Admin Character Actions =====

/**
 * Rename a character (update OBJECTS.OBJECT_NAME)
 * @param {string|number} characterObjectId
 * @param {string} newName
 */
export async function renameCharacter(characterObjectId, newName) {
  const sql = `
    UPDATE OBJECTS SET OBJECT_NAME = :newName
    WHERE OBJECT_ID = :charId
  `;
  try {
    const conn = await getOracleConnection();
    try {
      await conn.execute(sql, { newName, charId: characterObjectId });
      await conn.commit();
      logger.info({ characterObjectId, newName }, 'Character renamed');
    } finally {
      await conn.close();
    }
  } catch (error) {
    logger.error({ error: error.message, characterObjectId, newName }, 'Failed to rename character');
    throw error;
  }
}

/**
 * Move a character to a new location (update OBJECTS.X, Y, Z, SCENE_ID)
 * @param {string|number} characterObjectId
 * @param {string} planet - SCENE_ID value
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export async function moveCharacter(characterObjectId, planet, x, y, z) {
  const sql = `
    UPDATE OBJECTS SET X = :x, Y = :y, Z = :z, SCENE_ID = :planet
    WHERE OBJECT_ID = :charId
  `;
  try {
    const conn = await getOracleConnection();
    try {
      await conn.execute(sql, { x, y, z, planet, charId: characterObjectId });
      await conn.commit();
      logger.info({ characterObjectId, planet, x, y, z }, 'Character moved');
    } finally {
      await conn.close();
    }
  } catch (error) {
    logger.error({ error: error.message, characterObjectId }, 'Failed to move character');
    throw error;
  }
}

/**
 * Change a character's race (update OBJECT_TEMPLATE_ID on OBJECTS + OBJECT_TEMPLATE on SWG_CHARACTERS)
 * Per ORACLE_STRUCT: OBJECTS.OBJECT_TEMPLATE_ID NUMBER(*,0), SWG_CHARACTERS.TEMPLATE_ID NUMBER
 * @param {string|number} characterObjectId
 * @param {number} templateId - new object template ID
 */
export async function changeCharacterRace(characterObjectId, templateId) {
  const sql1 = `UPDATE OBJECTS SET OBJECT_TEMPLATE_ID = :templateId WHERE OBJECT_ID = :charId`;
  const sql2 = `UPDATE SWG_CHARACTERS SET TEMPLATE_ID = :templateId WHERE OBJECT_ID = :charId`;

  try {
    const conn = await getOracleConnection();
    try {
      await conn.execute(sql1, { templateId, charId: characterObjectId });
      // SWG_CHARACTERS may not have this character (it uses OBJECT_ID column)
      try { await conn.execute(sql2, { templateId, charId: characterObjectId }); } catch (_) { /* ignore */ }
      await conn.commit();
      logger.info({ characterObjectId, templateId }, 'Character race changed');
    } finally {
      await conn.close();
    }
  } catch (error) {
    logger.error({ error: error.message, characterObjectId, templateId }, 'Failed to change character race');
    throw error;
  }
}

/**
 * Lock/unlock an account by STATION_ID (update ACCOUNTS.IS_OUTCAST)
 * Per ORACLE_STRUCT: ACCOUNTS.STATION_ID NUMBER, IS_OUTCAST CHAR(1)
 * @param {string|number} stationId
 * @param {boolean} locked - true to lock, false to unlock
 */
export async function lockAccount(stationId, locked) {
  const sql = `
    UPDATE ACCOUNTS SET IS_OUTCAST = :lockVal
    WHERE STATION_ID = :stationId
  `;
  const lockVal = locked ? 'Y' : 'N';
  try {
    const conn = await getOracleConnection();
    try {
      await conn.execute(sql, { lockVal, stationId });
      await conn.commit();
      logger.info({ stationId, locked }, 'Account lock status changed');
    } finally {
      await conn.close();
    }
  } catch (error) {
    logger.error({ error: error.message, stationId, locked }, 'Failed to lock/unlock account');
    throw error;
  }
}
