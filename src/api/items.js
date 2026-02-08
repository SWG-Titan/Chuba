import express from 'express';
import {
  getItems,
  getItemById,
  getItemByTemplate,
  searchItems,
  getItemCategories,
  getItemTypes,
  getItemStats,
  syncMasterItems,
  getColumnSettings,
  setColumnVisibility,
  updateColumnSettings,
  setItemsHidden,
  getItemStatsSummary,
  loadItemStats,
} from '../services/item-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('items-api');
const router = express.Router();

/**
 * GET /api/items
 * Get items with filtering and pagination
 */
router.get('/', (req, res) => {
  try {
    const {
      category,
      type,
      search,
      minTier,
      maxTier,
      sortBy,
      sortOrder,
      limit = 50,
      offset = 0,
      includeHidden = 'false',
    } = req.query;

    const result = getItems({
      category,
      itemType: type,
      search,
      minTier: minTier ? parseInt(minTier, 10) : undefined,
      maxTier: maxTier ? parseInt(maxTier, 10) : undefined,
      sortBy,
      sortOrder,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
      includeHidden: includeHidden === 'true',
    });

    res.json({
      success: true,
      data: result.items,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get items');
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve items',
    });
  }
});

/**
 * GET /api/items/search
 * Search items by name
 */
router.get('/search', (req, res) => {
  try {
    const { q, limit = 50 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters',
      });
    }

    const items = searchItems(q, Math.min(parseInt(limit, 10) || 50, 200));

    res.json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to search items');
    res.status(500).json({
      success: false,
      error: 'Search failed',
    });
  }
});

/**
 * GET /api/items/stats
 * Get item database statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getItemStats();
    const statsSummary = getItemStatsSummary();
    res.json({
      success: true,
      data: {
        ...stats,
        statsTables: statsSummary,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get stats',
    });
  }
});

/**
 * POST /api/items/load-stats
 * Manually load/reload item stats from disk
 */
router.post('/load-stats', (req, res) => {
  try {
    const result = loadItemStats();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load item stats');
    res.status(500).json({
      success: false,
      error: 'Failed to load item stats',
    });
  }
});

/**
 * GET /api/items/categories
 * Get all item categories
 */
router.get('/categories', (req, res) => {
  try {
    const categories = getItemCategories();
    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get categories',
    });
  }
});

/**
 * GET /api/items/types
 * Get all item types
 */
router.get('/types', (req, res) => {
  try {
    const types = getItemTypes();
    res.json({
      success: true,
      data: types,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get types',
    });
  }
});

/**
 * GET /api/items/columns
 * Get column visibility settings
 */
router.get('/columns', (req, res) => {
  try {
    const columns = getColumnSettings();
    res.json({
      success: true,
      data: columns,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get column settings',
    });
  }
});

/**
 * PUT /api/items/columns/:columnName
 * Update single column visibility
 */
router.put('/columns/:columnName', (req, res) => {
  try {
    const { columnName } = req.params;
    const { visible } = req.body;

    if (typeof visible !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'visible must be a boolean',
      });
    }

    const result = setColumnVisibility(columnName, visible);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update column visibility',
    });
  }
});

/**
 * PUT /api/items/columns
 * Update multiple column settings
 */
router.put('/columns', (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        error: 'settings must be an array',
      });
    }

    const result = updateColumnSettings(settings);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update column settings',
    });
  }
});

/**
 * POST /api/items/hide
 * Hide items by category/type/pattern
 */
router.post('/hide', (req, res) => {
  try {
    const { category, itemType, templatePattern, hidden = true } = req.body;

    if (!category && !itemType && !templatePattern) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least one filter: category, itemType, or templatePattern',
      });
    }

    const result = setItemsHidden({ category, itemType, templatePattern }, hidden);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update item visibility',
    });
  }
});

/**
 * POST /api/items/sync
 * Manually trigger item sync (admin only)
 */
router.post('/sync', (req, res) => {
  try {
    const stats = syncMasterItems();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to sync items');
    res.status(500).json({
      success: false,
      error: 'Sync failed',
    });
  }
});

/**
 * GET /api/items/by-template/*
 * Get item by template path
 */
router.get('/by-template/*', (req, res) => {
  try {
    const template = req.params[0];

    if (!template) {
      return res.status(400).json({
        success: false,
        error: 'Template path required',
      });
    }

    const item = getItemByTemplate(template);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found',
      });
    }

    res.json({
      success: true,
      data: item,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get item',
    });
  }
});

/**
 * GET /api/items/:id
 * Get item by ID
 */
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid item ID',
      });
    }

    const item = getItemById(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found',
      });
    }

    res.json({
      success: true,
      data: item,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get item',
    });
  }
});

export default router;

