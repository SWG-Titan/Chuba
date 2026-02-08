/**
 * Waypoint API Routes
 *
 * CRUD endpoints for waypoints. All operations are local (SQLite).
 * Oracle sync happens on a daily schedule via polling-service.
 */

import express from 'express';
import { createLogger } from '../utils/logger.js';
import {
  getWaypoints,
  getWaypointById,
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  getWaypointStats,
  getAvailablePlanets,
  syncWaypointsFromOracle,
  clearLocalWaypoints,
  clearAllWaypoints,
  isWaypointCreationEnabled,
  setWaypointCreationEnabled,
} from '../services/waypoint-service.js';

const router = express.Router();
const logger = createLogger('waypoints-api');

// ===== Static / specific routes FIRST (before /:id param routes) =====

/**
 * GET /api/waypoints/planets
 * Get list of available planets with map info
 */
router.get('/planets', (req, res) => {
  try {
    const planets = getAvailablePlanets();
    res.json({ success: true, data: planets });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get planets');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/waypoints/stats
 * Get waypoint statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getWaypointStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get waypoint stats');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/waypoints/settings/creation
 * Check if waypoint creation is enabled
 */
router.get('/settings/creation', (req, res) => {
  try {
    res.json({ success: true, data: { enabled: isWaypointCreationEnabled() } });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get creation setting');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/waypoints/settings/creation
 * Toggle waypoint creation on/off (admin)
 * Body: { enabled: boolean }
 */
router.post('/settings/creation', (req, res) => {
  try {
    const { enabled } = req.body;
    setWaypointCreationEnabled(enabled);
    logger.info({ enabled }, 'Waypoint creation toggled');
    res.json({ success: true, data: { enabled: isWaypointCreationEnabled() } });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to toggle creation setting');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/waypoints/sync
 * Manually trigger Oracle waypoint sync (admin)
 */
router.post('/sync', async (req, res) => {
  try {
    logger.info('Manual waypoint sync triggered');
    const stats = await syncWaypointsFromOracle();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error({ error: error.message }, 'Manual waypoint sync failed');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/waypoints/clear
 * Clear waypoints (admin).
 * Body: { includeOracle: boolean } - if true, also clears cached oracle waypoints
 * By default only clears local waypoints; server waypoints are preserved.
 */
router.post('/clear', (req, res) => {
  try {
    const { includeOracle } = req.body || {};
    const deleted = includeOracle ? clearAllWaypoints() : clearLocalWaypoints();
    logger.info({ deleted, includeOracle: !!includeOracle }, 'Waypoints cleared');
    res.json({ success: true, data: { deleted, includeOracle: !!includeOracle } });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to clear waypoints');
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Generic / parameterized routes AFTER specific ones =====

/**
 * GET /api/waypoints
 * Get all waypoints, optionally filtered by planet
 * Query params: ?planet=tatooine
 */
router.get('/', (req, res) => {
  try {
    const { planet } = req.query;
    const waypoints = getWaypoints(planet || undefined);
    if (planet && waypoints.length === 0) {
      logger.debug({ planet }, 'No waypoints found for planet (table may need sync)');
    }
    res.json({ success: true, count: waypoints.length, data: waypoints });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get waypoints');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/waypoints/:id
 * Get a single waypoint
 */
router.get('/:id', (req, res) => {
  try {
    const waypoint = getWaypointById(req.params.id);
    if (!waypoint) {
      return res.status(404).json({ success: false, error: 'Waypoint not found' });
    }
    res.json({ success: true, data: waypoint });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get waypoint');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/waypoints
 * Create a new local waypoint
 * Body: { name, planet, x, y, z, color }
 */
router.post('/', (req, res) => {
  try {
    const { name, planet, x, y, z, color } = req.body;

    if (!planet) {
      return res.status(400).json({ success: false, error: 'Planet is required' });
    }

    const waypoint = createWaypoint({ name, planet, x, y, z, color });
    logger.info({ waypointId: waypoint.waypoint_id, planet }, 'Created waypoint');

    res.status(201).json({ success: true, data: waypoint });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to create waypoint');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/waypoints/:id
 * Update a waypoint
 * Body: { name?, x?, y?, z?, color?, planet? }
 */
router.put('/:id', (req, res) => {
  try {
    const waypoint = updateWaypoint(req.params.id, req.body);

    if (!waypoint) {
      return res.status(404).json({ success: false, error: 'Waypoint not found' });
    }

    logger.info({ waypointId: req.params.id }, 'Updated waypoint');
    res.json({ success: true, data: waypoint });
  } catch (error) {
    if (error.message.includes('read-only')) {
      return res.status(403).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, 'Failed to update waypoint');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/waypoints/:id
 * Delete a waypoint
 */
router.delete('/:id', (req, res) => {
  try {
    const deleted = deleteWaypoint(req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Waypoint not found' });
    }

    logger.info({ waypointId: req.params.id }, 'Deleted waypoint');
    res.json({ success: true });
  } catch (error) {
    if (error.message.includes('read-only')) {
      return res.status(403).json({ success: false, error: error.message });
    }
    logger.error({ error: error.message }, 'Failed to delete waypoint');
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
