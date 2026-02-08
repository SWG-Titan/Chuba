/**
 * City Service
 * Queries Oracle for city data.
 *
 * Per ORACLE_STRUCT (canonical):
 *   CITY_OBJECTS has only: OBJECT_ID NUMBER(20,0) PK
 *   City metadata (name, mayor, taxes, etc.) is stored as object variables
 *   on the city object, accessed via OBJECT_VARIABLES_VIEW.
 *
 * Tables used:
 *   - CITY_OBJECTS:            OBJECT_ID  (marker table — identifies which objects are cities)
 *   - OBJECTS:                 OBJECT_ID, OBJECT_NAME, SCENE_ID, X, Y, Z, DELETED
 *   - OBJECT_VARIABLES_VIEW:  OBJECT_ID, NAME, TYPE, VALUE
 *
 * Known city objvar names (prefixed on the city object):
 *   cityName, cityHall, mayorId, incomeTax, propertyTax, salesTax,
 *   travelX, travelY, travelZ, radius, faction, gcwRegion, etc.
 *   Exact names may vary; we pivot whatever we find.
 */
import { executeOracleQuery } from '../database/oracle-db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('city-service');

/**
 * Fetch all cities.
 * Step 1: Get city object IDs from CITY_OBJECTS + OBJECTS (for position & planet).
 * Step 2: Batch-fetch objvars for those IDs from OBJECT_VARIABLES_VIEW.
 * Step 3: Merge into rich city objects.
 */
export async function getCities() {
  // Step 1: Get city objects with location
  const citySql = `
    SELECT
      c.OBJECT_ID AS CITY_ID,
      o.OBJECT_NAME,
      o.SCENE_ID,
      o.X,
      o.Y,
      o.Z
    FROM CITY_OBJECTS c
    JOIN OBJECTS o ON c.OBJECT_ID = o.OBJECT_ID
    WHERE o.DELETED = 0 OR o.DELETED IS NULL
    ORDER BY o.OBJECT_NAME
  `;

  try {
    const cityResult = await executeOracleQuery(citySql);
    const cityRows = cityResult.rows || [];

    if (cityRows.length === 0) {
      logger.info('No city objects found');
      return [];
    }

    // Collect city IDs for objvar lookup
    const cityIds = cityRows.map(r => r.CITY_ID);

    // Step 2: Fetch objvars for all city objects in one query
    // OBJECT_VARIABLES_VIEW provides NAME (the full dotted objvar name) and VALUE
    const objvars = await fetchCityObjvars(cityIds);

    // Step 3: Merge
    const cities = cityRows.map(row => {
      const vars = objvars.get(String(row.CITY_ID)) || {};
      const mayorId = vars['mayorId'] || vars['cityHall.mayorId'] || null;

      return {
        cityId: String(row.CITY_ID),
        name: vars['cityName'] || row.OBJECT_NAME || 'Unknown City',
        mayorId: mayorId ? String(mayorId) : null,
        mayorName: vars['mayorName'] || null,
        planet: row.SCENE_ID || 'unknown',
        x: parseNum(vars['travelX'] || vars['travel.x']) || row.X || 0,
        y: parseNum(vars['travelY'] || vars['travel.y']) || row.Y || 0,
        z: parseNum(vars['travelZ'] || vars['travel.z']) || row.Z || 0,
        radius: parseNum(vars['radius']) || 0,
        incomeTax: parseNum(vars['incomeTax']) || 0,
        propertyTax: parseNum(vars['propertyTax']) || 0,
        salesTax: parseNum(vars['salesTax']) || 0,
        faction: vars['faction'] || null,
        gcwDefenseRegion: vars['gcwRegion'] || vars['gcwDefenseRegion'] || null,
        creationTime: vars['creationTime'] || null,
      };
    });

    // Resolve mayor names for cities that have a mayorId but no mayorName objvar
    await resolveMayorNames(cities);

    logger.info({ count: cities.length }, 'Fetched cities from Oracle');
    return cities;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch cities');
    throw error;
  }
}

/**
 * Get a specific city by ID
 */
export async function getCityById(cityId) {
  const sql = `
    SELECT
      c.OBJECT_ID AS CITY_ID,
      o.OBJECT_NAME,
      o.SCENE_ID,
      o.X,
      o.Y,
      o.Z
    FROM CITY_OBJECTS c
    JOIN OBJECTS o ON c.OBJECT_ID = o.OBJECT_ID
    WHERE c.OBJECT_ID = :cityId
  `;

  try {
    const result = await executeOracleQuery(sql, { cityId });
    const row = result.rows?.[0];
    if (!row) return null;

    const objvars = await fetchCityObjvars([row.CITY_ID]);
    const vars = objvars.get(String(row.CITY_ID)) || {};
    const mayorId = vars['mayorId'] || vars['cityHall.mayorId'] || null;

    const city = {
      cityId: String(row.CITY_ID),
      name: vars['cityName'] || row.OBJECT_NAME || 'Unknown City',
      mayorId: mayorId ? String(mayorId) : null,
      mayorName: vars['mayorName'] || null,
      planet: row.SCENE_ID || 'unknown',
      x: parseNum(vars['travelX'] || vars['travel.x']) || row.X || 0,
      y: parseNum(vars['travelY'] || vars['travel.y']) || row.Y || 0,
      z: parseNum(vars['travelZ'] || vars['travel.z']) || row.Z || 0,
      radius: parseNum(vars['radius']) || 0,
      incomeTax: parseNum(vars['incomeTax']) || 0,
      propertyTax: parseNum(vars['propertyTax']) || 0,
      salesTax: parseNum(vars['salesTax']) || 0,
      faction: vars['faction'] || null,
      gcwDefenseRegion: vars['gcwRegion'] || vars['gcwDefenseRegion'] || null,
      creationTime: vars['creationTime'] || null,
    };

    await resolveMayorNames([city]);

    logger.info({ cityId }, 'Fetched city detail from Oracle');
    return city;
  } catch (error) {
    logger.error({ error: error.message, cityId }, 'Failed to fetch city');
    throw error;
  }
}

// ===== Internal helpers =====

/**
 * Fetch object variables for a set of city object IDs.
 * Uses OBJECT_VARIABLES_VIEW which denormalises NAME_ID -> NAME.
 *
 * @param {Array<number|string>} objectIds
 * @returns {Promise<Map<string, Object>>} Map of objectId -> { varName: varValue, ... }
 */
async function fetchCityObjvars(objectIds) {
  const result = new Map();
  if (!objectIds || objectIds.length === 0) return result;

  // Oracle bind-variable list: use individual binds for safety
  // For large sets this could be batched, but cities are typically < 200
  const placeholders = objectIds.map((_, i) => `:id${i}`).join(', ');
  const binds = {};
  objectIds.forEach((id, i) => { binds[`id${i}`] = id; });

  const sql = `
    SELECT OBJECT_ID, NAME, VALUE
    FROM OBJECT_VARIABLES_VIEW
    WHERE OBJECT_ID IN (${placeholders})
  `;

  try {
    const queryResult = await executeOracleQuery(sql, binds);
    for (const row of (queryResult.rows || [])) {
      const objId = String(row.OBJECT_ID);
      if (!result.has(objId)) {
        result.set(objId, {});
      }
      // Store the last segment of the objvar name as a convenience key too
      const fullName = row.NAME || '';
      const shortName = fullName.includes('.') ? fullName.split('.').pop() : fullName;
      const vars = result.get(objId);
      vars[fullName] = row.VALUE;
      if (shortName !== fullName) {
        vars[shortName] = row.VALUE;
      }
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch city objvars');
  }

  return result;
}

/**
 * Resolve mayor names for cities that have a mayorId but no mayorName.
 * Looks up OBJECTS.OBJECT_NAME for the mayor object IDs.
 */
async function resolveMayorNames(cities) {
  const needsResolve = cities.filter(c => c.mayorId && !c.mayorName);
  if (needsResolve.length === 0) return;

  const mayorIds = [...new Set(needsResolve.map(c => c.mayorId))];
  const placeholders = mayorIds.map((_, i) => `:id${i}`).join(', ');
  const binds = {};
  mayorIds.forEach((id, i) => { binds[`id${i}`] = id; });

  const sql = `
    SELECT OBJECT_ID, OBJECT_NAME
    FROM OBJECTS
    WHERE OBJECT_ID IN (${placeholders})
  `;

  try {
    const result = await executeOracleQuery(sql, binds);
    const nameMap = new Map();
    for (const row of (result.rows || [])) {
      nameMap.set(String(row.OBJECT_ID), row.OBJECT_NAME);
    }
    for (const city of needsResolve) {
      city.mayorName = nameMap.get(city.mayorId) || 'Unknown';
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to resolve mayor names');
    for (const city of needsResolve) {
      city.mayorName = city.mayorName || 'Unknown';
    }
  }
}

/**
 * Parse a string value to a number, returning null if not numeric
 */
function parseNum(val) {
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}
