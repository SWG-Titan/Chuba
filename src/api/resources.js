import express from 'express';
import {
  getLocalResources,
  getResourceById,
  getResourcesByClass,
  getBestByClass,
  getBestActiveByClassAndStat,
  searchResources,
  getResourceStats,
} from '../services/resource-service.js';
import { formatResourceResponse } from '../utils/resource-helpers.js';
import { findSchematicsForResource } from '../services/matching-service.js';
import {
  getResourceClassInfo,
  getResourceIcon,
  getResourceStringName,
  getResourceTree,
} from '../services/resource-tree-service.js';

const router = express.Router();

/**
 * GET /api/resources
 * Get all resources (with pagination)
 */
router.get('/', (req, res) => {
  try {
    const { active, class: resourceClass, search, limit = 100, offset = 0 } = req.query;

    let resources;

    if (search) {
      resources = searchResources(search, parseInt(limit, 10));
    } else if (resourceClass) {
      resources = getResourcesByClass(resourceClass, active !== 'false');
    } else {
      resources = getLocalResources(active !== 'false');
    }

    // Apply pagination for non-search queries
    if (!search) {
      const start = parseInt(offset, 10);
      const end = start + parseInt(limit, 10);
      resources = resources.slice(start, end);
    }

    res.json({
      success: true,
      count: resources.length,
      data: resources.map(formatResourceResponse),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/resources/class-info/:className
 * Get resource class info including icon and translated name
 */
router.get('/class-info/:className', (req, res) => {
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
 * GET /api/resources/classes
 * Get all resource classes with their icons and names
 */
router.get('/classes', (req, res) => {
  try {
    const tree = getResourceTree();
    const classes = [];

    for (const [enumName, resourceClass] of tree) {
      classes.push({
        enumName,
        displayName: resourceClass.displayName,
        stringName: getResourceStringName(enumName),
        icon: getResourceIcon(enumName),
        parent: resourceClass.parent,
        depth: resourceClass.depth,
        childCount: resourceClass.children.length,
      });
    }

    res.json({
      success: true,
      count: classes.length,
      data: classes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/resources/stats
 * Get resource statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getResourceStats();
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
 * GET /api/resources/best
 * Get best resources by class and/or stat
 */
router.get('/best', (req, res) => {
  try {
    const { class: resourceClass, stat, active = 'true' } = req.query;

    if (!resourceClass) {
      return res.status(400).json({
        success: false,
        error: 'Resource class is required',
      });
    }

    if (stat && active === 'true') {
      // Get best active resource for specific stat
      const resource = getBestActiveByClassAndStat(resourceClass, stat);
      res.json({
        success: true,
        data: resource ? formatResourceResponse(resource) : null,
      });
    } else {
      // Get all best resources for class
      const best = getBestByClass(resourceClass);
      res.json({
        success: true,
        data: best,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/resources/:id
 * Get a single resource by ID
 */
router.get('/:id', (req, res) => {
  try {
    const resource = getResourceById(req.params.id);

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: 'Resource not found',
      });
    }

    // Get schematics where this resource is best
    const schematics = findSchematicsForResource(req.params.id);

    res.json({
      success: true,
      data: {
        ...formatResourceResponse(resource),
        usedInSchematics: schematics,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

