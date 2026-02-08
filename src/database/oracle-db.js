import oracledb from 'oracledb';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { sendDiscordAlert } from '../utils/alerts.js';

const logger = createLogger('oracle-db');

let pool = null;

/**
 * Initialize Oracle connection pool
 */
export async function initOraclePool() {
  if (pool) return pool;

  try {
    pool = await oracledb.createPool({
      user: config.oracle.user,
      password: config.oracle.password,
      connectionString: config.oracle.connectionString,
      poolMin: config.oracle.poolMin,
      poolMax: config.oracle.poolMax,
      poolIncrement: 1,
      poolTimeout: 60,
      queueTimeout: 60000,
    });

    logger.info('Oracle connection pool initialized');
    return pool;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize Oracle pool');
    await sendDiscordAlert('Oracle Connection Failed', error.message, 'error');
    throw error;
  }
}

/**
 * Get Oracle connection from pool
 * @returns {Promise<oracledb.Connection>}
 */
export async function getOracleConnection() {
  if (!pool) {
    await initOraclePool();
  }

  try {
    return await pool.getConnection();
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get Oracle connection');

    // Try to reinitialize pool on connection failure
    if (error.message.includes('NJS-010') || error.message.includes('ORA-')) {
      logger.info('Attempting to reinitialize Oracle pool...');
      pool = null;
      await initOraclePool();
      return await pool.getConnection();
    }

    throw error;
  }
}

/**
 * Execute a query on Oracle database
 * @param {string} sql - SQL query
 * @param {Object} params - Query parameters
 * @returns {Promise<any>}
 */
export async function executeOracleQuery(sql, params = {}) {
  let connection;

  try {
    connection = await getOracleConnection();
    const result = await connection.execute(sql, params, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      fetchArraySize: 1000,
    });
    return result;
  } catch (error) {
    logger.error({ error: error.message, sql }, 'Oracle query failed');
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        logger.error({ error: err.message }, 'Failed to close Oracle connection');
      }
    }
  }
}

/**
 * Close Oracle pool
 */
export async function closeOraclePool() {
  if (pool) {
    try {
      await pool.close(10);
      pool = null;
      logger.info('Oracle connection pool closed');
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to close Oracle pool');
    }
  }
}

/**
 * Check if Oracle connection is healthy
 * @returns {Promise<boolean>}
 */
export async function checkOracleHealth() {
  try {
    await executeOracleQuery('SELECT 1 FROM DUAL', {});
    return true;
  } catch {
    return false;
  }
}

