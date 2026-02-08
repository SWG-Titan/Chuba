import express from 'express';
import { checkOracleHealth } from '../database/oracle-db.js';
import { getLocalDb } from '../database/local-db.js';
import { getPollHistory, getLastSuccessfulPoll, pollResources, pollSchematics } from '../services/polling-service.js';
import { getResourceStats } from '../services/resource-service.js';

const router = express.Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    const db = getLocalDb();
    const localDbHealthy = !!db;

    // Check Oracle (async)
    let oracleHealthy = false;
    try {
      oracleHealthy = await checkOracleHealth();
    } catch {
      oracleHealthy = false;
    }

    const lastResourcePoll = getLastSuccessfulPoll('resource');
    const lastSchematicPoll = getLastSuccessfulPoll('schematic');

    const status = localDbHealthy ? 'healthy' : 'degraded';

    res.status(status === 'healthy' ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        localDb: localDbHealthy,
        oracleDb: oracleHealthy,
      },
      lastPolls: {
        resource: lastResourcePoll?.completed_at || null,
        schematic: lastSchematicPoll?.completed_at || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

/**
 * GET /api/health/stats
 * Get system statistics
 */
router.get('/stats', (req, res) => {
  try {
    const resourceStats = getResourceStats();
    const pollHistory = getPollHistory(10);

    res.json({
      success: true,
      data: {
        resources: resourceStats,
        recentPolls: pollHistory,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/health/polls
 * Get poll history
 */
router.get('/polls', (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const history = getPollHistory(parseInt(limit, 10));

    res.json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/health/poll/resources
 * Manually trigger resource poll
 */
router.post('/poll/resources', async (req, res) => {
  try {
    const stats = await pollResources();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/health/poll/schematics
 * Manually trigger schematic poll
 */
router.post('/poll/schematics', async (req, res) => {
  try {
    const stats = await pollSchematics();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

