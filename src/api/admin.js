import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { getLocalDb, closeLocalDb, initLocalDb, runMigrations } from '../database/local-db.js';
import { getSession, SESSION_COOKIE_NAME, getSessionStats } from '../services/session-service.js';
import { getPollHistory, pollResources, pollSchematics } from '../services/polling-service.js';
import { syncMasterItems } from '../services/item-service.js';
import { getErrors, getErrorSummary, clearErrors } from '../services/error-tracker.js';
import { resolveStringRef, parseSTFFile, getSTFCacheStats, clearSTFCache } from '../parsers/stf-parser.js';
import { createLogger } from '../utils/logger.js';
import {
  loadResourceTree,
  getResourceTreeStats,
  syncResourceClassesToDb,
  loadResourceStringNames,
  loadResourceIcons,
  getResourceClassInfo,
} from '../services/resource-tree-service.js';
import {
  cacheAllTemplateNames,
  getTemplateNameStats
} from '../services/schematic-service.js';
import {
  getLocationSceneMappings,
  setLocationSceneMapping,
  deleteLocationSceneMapping,
  PLANET_MAP_CONFIG,
} from '../services/waypoint-service.js';

const logger = createLogger('admin-api');
const router = express.Router();

/**
 * Admin authentication middleware
 */
function requireAdmin(req, res, next) {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  const session = getSession(sessionId);

  if (!session || !session.isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required (level 50+)',
    });
  }

  req.session = session;
  next();
}

// Apply admin middleware to all routes
router.use(requireAdmin);

/**
 * GET /api/admin/config
 * Get current configuration (sanitized)
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      oracle: {
        user: config.oracle.user,
        connectionString: config.oracle.connectionString,
        poolMin: config.oracle.poolMin,
        poolMax: config.oracle.poolMax,
        // Password is hidden
      },
      localDb: {
        path: config.localDb.path,
      },
      schematic: {
        sourcePath: config.schematic.sourcePath,
      },
      polling: {
        intervalMinutes: config.polling.intervalMinutes,
      },
      api: {
        port: config.api.port,
        host: config.api.host,
      },
      logging: {
        level: config.logging.level,
      },
      alerts: {
        enableDiscord: config.alerts.enableDiscord,
        hasWebhook: !!config.alerts.discordWebhookUrl,
      },
    },
  });
});

/**
 * GET /api/admin/stats
 * Get admin statistics
 */
router.get('/stats', (req, res) => {
  try {
    const db = getLocalDb();

    // Get database file stats
    let dbStats = null;
    try {
      const dbPath = path.resolve(config.localDb.path);
      const stats = fs.statSync(dbPath);
      dbStats = {
        path: dbPath,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        modified: stats.mtime,
      };
    } catch (e) {
      dbStats = { error: 'Unable to get database stats' };
    }

    // Get table counts
    const resourceCount = db.prepare('SELECT COUNT(*) as count FROM resources').get();
    const schematicCount = db.prepare('SELECT COUNT(*) as count FROM schematics').get();
    const pollLogCount = db.prepare('SELECT COUNT(*) as count FROM poll_log').get();
    const historyCount = db.prepare('SELECT COUNT(*) as count FROM resource_history').get();

    // Get session stats
    const sessionStats = getSessionStats();

    // Get recent polls
    const recentPolls = getPollHistory(5);

    res.json({
      success: true,
      data: {
        database: dbStats,
        tables: {
          resources: resourceCount.count,
          schematics: schematicCount.count,
          pollLog: pollLogCount.count,
          resourceHistory: historyCount.count,
        },
        sessions: sessionStats,
        recentPolls,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get admin stats');
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics',
    });
  }
});

/**
 * POST /api/admin/poll/resources
 * Manually trigger resource poll
 */
router.post('/poll/resources', async (req, res) => {
  try {
    logger.info({ username: req.session.username }, 'Admin triggered resource poll');
    const stats = await pollResources();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Admin resource poll failed');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/poll/schematics
 * Manually trigger schematic poll
 */
router.post('/poll/schematics', async (req, res) => {
  try {
    logger.info({ username: req.session.username }, 'Admin triggered schematic poll');
    const stats = await pollSchematics();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Admin schematic poll failed');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/sync/items
 * Manually trigger item sync from master_item
 */
router.post('/sync/items', async (req, res) => {
  try {
    logger.info({ username: req.session.username }, 'Admin triggered item sync');
    const stats = syncMasterItems();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Admin item sync failed');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/nuke-database
 * Delete and recreate the database
 */
router.post('/nuke-database', async (req, res) => {
  try {
    const { confirm } = req.body;

    if (confirm !== 'NUKE') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required. Send { "confirm": "NUKE" } to proceed.',
      });
    }

    logger.warn({ username: req.session.username }, 'Admin initiated database nuke');

    // Close existing database connection
    closeLocalDb();

    // Delete database file
    const dbPath = path.resolve(config.localDb.path);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      logger.info({ dbPath }, 'Database file deleted');
    }

    // Also delete WAL and SHM files if they exist
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    // Reinitialize database
    initLocalDb();
    runMigrations();

    logger.info({ username: req.session.username }, 'Database nuked and recreated');

    res.json({
      success: true,
      message: 'Database has been nuked and recreated. All data has been deleted.',
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Database nuke failed');
    res.status(500).json({
      success: false,
      error: 'Failed to nuke database: ' + error.message,
    });
  }
});

/**
 * POST /api/admin/clear-history
 * Clear resource history and poll logs
 */
router.post('/clear-history', (req, res) => {
  try {
    const db = getLocalDb();

    db.prepare('DELETE FROM resource_history').run();
    db.prepare('DELETE FROM poll_log').run();
    db.prepare('DELETE FROM cached_matches').run();

    logger.info({ username: req.session.username }, 'Admin cleared history tables');

    res.json({
      success: true,
      message: 'History and logs cleared',
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to clear history');
    res.status(500).json({
      success: false,
      error: 'Failed to clear history',
    });
  }
});

/**
 * POST /api/admin/clear-resources
 * Clear all resources (keeps schematics)
 */
router.post('/clear-resources', (req, res) => {
  try {
    const db = getLocalDb();

    db.prepare('DELETE FROM cached_matches').run();
    db.prepare('DELETE FROM best_resource_snapshots').run();
    db.prepare('DELETE FROM resource_history').run();
    db.prepare('DELETE FROM resources').run();

    logger.info({ username: req.session.username }, 'Admin cleared all resources');

    res.json({
      success: true,
      message: 'All resources cleared',
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to clear resources');
    res.status(500).json({
      success: false,
      error: 'Failed to clear resources',
    });
  }
});

/**
 * GET /api/admin/logs
 * Get recent poll logs
 */
router.get('/logs', (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const logs = getPollHistory(parseInt(limit, 10));

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get logs',
    });
  }
});

/**
 * GET /api/admin/errors
 * Get tracked errors
 */
router.get('/errors', (req, res) => {
  try {
    const { category = 'all', limit = 100 } = req.query;
    const errors = getErrors(category, parseInt(limit, 10));
    const summary = getErrorSummary();

    res.json({
      success: true,
      data: {
        errors,
        summary,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get errors');
    res.status(500).json({
      success: false,
      error: 'Failed to get errors',
    });
  }
});

/**
 * GET /api/admin/errors/summary
 * Get error counts summary
 */
router.get('/errors/summary', (req, res) => {
  try {
    const summary = getErrorSummary();
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get error summary',
    });
  }
});

/**
 * DELETE /api/admin/errors
 * Clear tracked errors
 */
router.delete('/errors', (req, res) => {
  try {
    const { category = 'all' } = req.query;
    clearErrors(category);

    logger.info({ username: req.session.username, category }, 'Admin cleared errors');

    res.json({
      success: true,
      message: `Errors cleared for category: ${category}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear errors',
    });
  }
});

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * GET /api/admin/test-stf
 * Test STF string resolution
 */
router.get('/test-stf', async (req, res) => {
  try {
    const { file = 'item_n', key = 'armor_segment', refresh = 'false' } = req.query;
    const stringsPath = config.schematic.stringsPath;

    // Clear cache if refresh requested
    if (refresh === 'true') {
      clearSTFCache();
    }

    // Get the full STF file
    const stfPath = path.join(stringsPath, `${file}.stf`);

    // Check if file exists
    const fileExists = fs.existsSync(stfPath);
    let fileSize = 0;
    let hexDump = '';

    if (fileExists) {
      const stat = fs.statSync(stfPath);
      fileSize = stat.size;

      // Read first 200 bytes as hex for debugging
      const buffer = fs.readFileSync(stfPath);
      hexDump = buffer.slice(0, 200).toString('hex').match(/.{1,2}/g).join(' ');
    }

    const reader = await parseSTFFile(stfPath);

    // Test resolving a string (sync version)
    const result = resolveStringRef(file, key, stringsPath);

    // Get first 30 keys as sample
    const sampleKeys = reader.getNames().slice(0, 30);
    const sampleEntries = sampleKeys.map(k => ({ key: k, value: reader.get(k) }));

    res.json({
      success: true,
      data: {
        query: { file, key },
        resolvedValue: result,
        stringsPath,
        stfPath,
        fileExists,
        fileSize,
        hexDump,
        totalKeys: reader.size,
        sampleEntries,
        cacheStats: getSTFCacheStats(),
      },
    });
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'STF test failed');
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

/**
 * GET /api/admin/resource-tree/stats
 * Get resource tree statistics
 */
router.get('/resource-tree/stats', (req, res) => {
  try {
    const stats = getResourceTreeStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get resource tree stats');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/resource-tree/reload
 * Reload the resource tree from file
 */
router.post('/resource-tree/reload', (req, res) => {
  try {
    logger.info({ username: req.session.username }, 'Admin triggered resource tree reload');
    const tree = loadResourceTree();
    const stats = getResourceTreeStats();
    res.json({
      success: true,
      message: 'Resource tree reloaded',
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to reload resource tree');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/resource-tree/sync-db
 * Sync resource classes to database
 */
router.post('/resource-tree/sync-db', (req, res) => {
  try {
    logger.info({ username: req.session.username }, 'Admin triggered resource tree DB sync');
    const stats = syncResourceClassesToDb();
    res.json({
      success: true,
      message: 'Resource classes synced to database',
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to sync resource tree to DB');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/resource-tree/test/:className
 * Test resource class info retrieval
 */
router.get('/resource-tree/test/:className', (req, res) => {
  try {
    const info = getResourceClassInfo(req.params.className);
    res.json({
      success: true,
      data: info,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/template-names/stats
 * Get template name cache statistics
 */
router.get('/template-names/stats', (req, res) => {
  try {
    const stats = getTemplateNameStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get template name stats');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/template-names/cache-all
 * Cache all template names
 */
router.post('/template-names/cache-all', (req, res) => {
  try {
    logger.info({ username: req.session.username }, 'Admin triggered template name caching');
    const stats = cacheAllTemplateNames();
    res.json({
      success: true,
      message: 'Template names cached',
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to cache template names');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/paths
 * Get all configured paths and their status
 */
router.get('/paths', (req, res) => {
  try {
    const paths = {
      schematic: {
        sourcePath: { path: config.schematic.sourcePath, exists: fs.existsSync(config.schematic.sourcePath) },
        stringsPath: { path: config.schematic.stringsPath, exists: fs.existsSync(config.schematic.stringsPath) },
        datatablePath: { path: config.schematic.datatablePath, exists: fs.existsSync(config.schematic.datatablePath) },
        serverBasePath: { path: config.schematic.serverBasePath, exists: fs.existsSync(config.schematic.serverBasePath) },
        sharedBasePath: { path: config.schematic.sharedBasePath, exists: fs.existsSync(config.schematic.sharedBasePath) },
      },
      resource: {
        treePath: { path: config.resource?.treePath, exists: config.resource?.treePath ? fs.existsSync(config.resource.treePath) : false },
        namesPath: { path: config.resource?.namesPath, exists: config.resource?.namesPath ? fs.existsSync(config.resource.namesPath) : false },
        imagesPath: { path: config.resource?.imagesPath, exists: config.resource?.imagesPath ? fs.existsSync(config.resource.imagesPath) : false },
      },
      item: {
        masterItemPath: { path: config.item?.masterItemPath, exists: config.item?.masterItemPath ? fs.existsSync(config.item.masterItemPath) : false },
        statsPath: { path: config.item?.statsPath, exists: config.item?.statsPath ? fs.existsSync(config.item.statsPath) : false },
      },
      localDb: {
        path: { path: config.localDb.path, exists: fs.existsSync(config.localDb.path) },
      },
    };

    res.json({
      success: true,
      data: paths,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get paths');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ===== Objvar Key Mappings =====

/**
 * GET /api/admin/objvar-mappings
 * Get all objvar key -> human-readable label mappings
 */
router.get('/objvar-mappings', requireAdmin, (req, res) => {
  try {
    const db = getLocalDb();
    const rows = db.prepare('SELECT id, objvar_name, display_label, category, created_at FROM objvar_key_mappings ORDER BY category, objvar_name').all();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get objvar mappings');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/objvar-mappings
 * Add or update an objvar key mapping
 * Body: { objvarName, displayLabel, category? }
 */
router.post('/objvar-mappings', requireAdmin, (req, res) => {
  try {
    const { objvarName, displayLabel, category } = req.body;
    if (!objvarName || !displayLabel) {
      return res.status(400).json({ success: false, error: 'objvarName and displayLabel are required' });
    }

    const db = getLocalDb();
    db.prepare(`
      INSERT INTO objvar_key_mappings (objvar_name, display_label, category)
      VALUES (?, ?, ?)
      ON CONFLICT(objvar_name) DO UPDATE SET display_label = excluded.display_label, category = excluded.category
    `).run(objvarName.trim(), displayLabel.trim(), (category || 'General').trim());

    res.json({ success: true, message: `Mapping saved: ${objvarName} -> ${displayLabel}` });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to save objvar mapping');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/objvar-mappings/:id
 * Delete an objvar key mapping
 */
router.delete('/objvar-mappings/:id', requireAdmin, (req, res) => {
  try {
    const db = getLocalDb();
    const result = db.prepare('DELETE FROM objvar_key_mappings WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Mapping not found' });
    }
    res.json({ success: true, message: 'Mapping deleted' });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to delete objvar mapping');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/objvar-mappings/bulk
 * Import multiple mappings at once
 * Body: { mappings: [{ objvarName, displayLabel, category? }, ...] }
 */
router.post('/objvar-mappings/bulk', requireAdmin, (req, res) => {
  try {
    const { mappings } = req.body;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ success: false, error: 'mappings array is required' });
    }

    const db = getLocalDb();
    const stmt = db.prepare(`
      INSERT INTO objvar_key_mappings (objvar_name, display_label, category)
      VALUES (?, ?, ?)
      ON CONFLICT(objvar_name) DO UPDATE SET display_label = excluded.display_label, category = excluded.category
    `);

    const insertMany = db.transaction((items) => {
      let count = 0;
      for (const item of items) {
        if (item.objvarName && item.displayLabel) {
          stmt.run(item.objvarName.trim(), item.displayLabel.trim(), (item.category || 'General').trim());
          count++;
        }
      }
      return count;
    });

    const imported = insertMany(mappings);
    res.json({ success: true, message: `${imported} mappings imported`, count: imported });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to bulk import objvar mappings');
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== LOCATION_SCENE to Planet Mapping (waypoint sync) =====

/**
 * GET /api/admin/location-scene-mappings
 * Get all LOCATION_SCENE (int) → planet mappings
 */
router.get('/location-scene-mappings', requireAdmin, (req, res) => {
  try {
    const rows = getLocationSceneMappings();
    const planets = Object.keys(PLANET_MAP_CONFIG);
    res.json({ success: true, count: rows.length, data: rows, planets });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get location-scene mappings');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/location-scene-mappings
 * Add or update a mapping. Body: { locationScene: number, planet: string }
 */
router.post('/location-scene-mappings', requireAdmin, (req, res) => {
  try {
    const { locationScene, planet } = req.body;
    if (locationScene == null || locationScene === '') {
      return res.status(400).json({ success: false, error: 'locationScene is required' });
    }
    if (!planet) {
      return res.status(400).json({ success: false, error: 'planet is required' });
    }
    setLocationSceneMapping(Number(locationScene), planet);
    res.json({ success: true, message: `Mapping saved: LOCATION_SCENE ${locationScene} → ${planet}` });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to save location-scene mapping');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/location-scene-mappings/:idOrScene
 * Delete by row id or by location_scene value
 */
router.delete('/location-scene-mappings/:idOrScene', requireAdmin, (req, res) => {
  try {
    deleteLocationSceneMapping(req.params.idOrScene);
    res.json({ success: true, message: 'Mapping deleted' });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to delete location-scene mapping');
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

