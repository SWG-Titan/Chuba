/**
 * Status Service
 * Polls swgtitan.org/status.txt and records player-count history in SQLite.
 */
import { getLocalDb } from '../database/local-db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('status-service');

const STATUS_URL = 'https://swgtitan.org/status.txt';

/**
 * Fetch the current server status from the public endpoint
 * @returns {Object|null} Parsed status JSON or null on failure
 */
export async function fetchServerStatus() {
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Non-OK response from status endpoint');
      return null;
    }
    const text = await res.text();
    const data = JSON.parse(text);
    return data;
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to fetch server status');
    return null;
  }
}

/**
 * Record a status snapshot in the local database
 * @param {Object} status - Parsed status.txt JSON
 */
export function recordStatusSnapshot(status) {
  if (!status) return;

  const db = getLocalDb();
  db.prepare(`
    INSERT INTO server_status_history (timestamp, player_count, highest_player_count, cluster_name, raw_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    status.lastUpdated ? new Date(status.lastUpdated * 1000).toISOString() : new Date().toISOString(),
    status.totalPlayerCount != null ? Number(status.totalPlayerCount) : null,
    status.highestPlayerCount != null ? Number(status.highestPlayerCount) : null,
    status.clusterName || null,
    JSON.stringify(status),
  );
}

/**
 * Get the most recent status snapshot
 * @returns {Object|null}
 */
export function getLatestStatus() {
  const db = getLocalDb();
  const row = db.prepare(`
    SELECT * FROM server_status_history ORDER BY id DESC LIMIT 1
  `).get();
  return row || null;
}

/**
 * Get status history for charting
 * @param {number} hours - How many hours of history to return (default 24)
 * @returns {Array} Rows with timestamp, player_count, highest_player_count
 */
export function getStatusHistory(hours = 24) {
  const db = getLocalDb();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT id, timestamp, player_count, highest_player_count, cluster_name
    FROM server_status_history
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).all(cutoff);
}

/**
 * Poll status once: fetch + record
 */
export async function pollStatus() {
  const status = await fetchServerStatus();
  if (status) {
    recordStatusSnapshot(status);
    logger.debug({ playerCount: status.totalPlayerCount }, 'Status snapshot recorded');
  }
  return status;
}
