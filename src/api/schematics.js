import express from 'express';
import {
  getAllSchematics,
  getSchematicById,
  getSchematicCategories,
  searchSchematics,
  syncSchematics,
  getCachedTemplateName,
  resolveIffDisplayName,
} from '../services/schematic-service.js';
import {
  getBestResourcesForSchematic,
  getTopResourcesForSlot,
  findSchematicsUsingResourceClass,
} from '../services/matching-service.js';
import { ensureSTFReaderLoaded } from '../parsers/stf-parser.js';
import { getResourceStringName, getResourceIcon } from '../services/resource-tree-service.js';
import { isTemplateIngredient } from '../parsers/tpf-parser.js';

const router = express.Router();

/**
 * GET /api/schematics
 * Get all schematics (with pagination)
 */
router.get('/', (req, res) => {
  try {
    const { category, search, limit = 100, offset = 0 } = req.query;
    
    let schematics;
    
    if (search) {
      schematics = searchSchematics(search, parseInt(limit, 10));
    } else {
      schematics = getAllSchematics({
        category,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });
    }
    
    res.json({
      success: true,
      count: schematics.length,
      data: schematics.map(s => {
        // Use schematic_name from DB - it should already be resolved during sync
        // Fall back to template cache if name looks like an internal ID
        let displayName = s.schematic_name;

        // If name looks like internal ID (no spaces, has underscores), try cache
        if (displayName && !displayName.includes(' ') && displayName.includes('_') && s.crafted_template) {
          const cached = getCachedTemplateName(s.crafted_template);
          if (cached?.display_name) {
            displayName = cached.display_name;
          }
        }

        return {
          id: s.schematic_id,
          name: displayName || s.schematic_id,
          internalName: s.schematic_id,
          complexity: s.complexity,
          category: s.category,
          craftingStation: s.crafting_station,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/schematics/categories
 * Get all schematic categories
 */
router.get('/categories', (req, res) => {
  try {
    const categories = getSchematicCategories();
    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/schematics/by-resource-class/:class
 * Get schematics that use a specific resource class
 */
router.get('/by-resource-class/:class', (req, res) => {
  try {
    const schematics = findSchematicsUsingResourceClass(req.params.class);
    res.json({
      success: true,
      count: schematics.length,
      data: schematics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/schematics/sync
 * Manually trigger schematic sync
 */
router.post('/sync', async (req, res) => {
  try {
    await ensureSTFReaderLoaded();
    const stats = syncSchematics();
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
 * GET /api/schematics/:id
 * Get a single schematic by ID
 */
router.get('/:id', (req, res) => {
  try {
    const schematic = getSchematicById(req.params.id);
    
    if (!schematic) {
      return res.status(404).json({
        success: false,
        error: 'Schematic not found',
      });
    }
    
    // Use schematic_name from DB - it should already be resolved during sync
    // Fall back to template cache if name looks like an internal ID
    let displayName = schematic.schematic_name;
    let description = null;

    // If name looks like internal ID (no spaces, has underscores), try cache
    if (displayName && !displayName.includes(' ') && displayName.includes('_') && schematic.crafted_template) {
      const cached = getCachedTemplateName(schematic.crafted_template);
      if (cached?.display_name) {
        displayName = cached.display_name;
      }
      if (cached?.description) {
        description = cached.description;
      }
    } else if (schematic.crafted_template) {
      // Still try to get description from cache
      const cached = getCachedTemplateName(schematic.crafted_template);
      if (cached?.description) {
        description = cached.description;
      }
    }

    res.json({
      success: true,
      data: {
        id: schematic.schematic_id,
        name: displayName,
        description: description,
        internalName: schematic.schematic_name,
        complexity: schematic.complexity,
        category: schematic.category,
        craftingStation: schematic.crafting_station,
        craftedTemplate: schematic.crafted_template,
        slots: schematic.slots.map(slot => {
          const resourceClass = slot.resource_class;
          const ingredientType = slot.ingredient_type || 'IT_resourceClass';
          const isTemplate = isTemplateIngredient(ingredientType);
          // Treat as template path if it looks like an IFF path (e.g. object/tangible/.../foo.iff)
          const looksLikeIffPath = resourceClass && typeof resourceClass === 'string' &&
            (resourceClass.includes('object/') && (resourceClass.endsWith('.iff') || resourceClass.includes('.iff')));

          // For template ingredients (or IFF-looking path), resourceClass is a template path → resolve via shared TPF + STF
          // For resource ingredients, get the string name from resource tree
          let displayName = resourceClass;
          let icon = 'default.png';
          let templatePath = null;

          if ((isTemplate || looksLikeIffPath) && resourceClass) {
            templatePath = resourceClass;
            const cached = getCachedTemplateName(resourceClass);
            if (cached?.display_name) {
              displayName = cached.display_name;
            } else {
              const resolved = resolveIffDisplayName(resourceClass);
              if (resolved) {
                displayName = resolved;
              } else {
                const lastSlash = resourceClass.lastIndexOf('/');
                displayName = lastSlash >= 0 ? resourceClass.substring(lastSlash + 1) : resourceClass;
                if (displayName.endsWith('.iff')) {
                  displayName = displayName.slice(0, -4);
                }
                displayName = displayName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              }
            }
            icon = 'default.png';
          } else if (resourceClass) {
            displayName = getResourceStringName(resourceClass);
            icon = getResourceIcon(resourceClass);
          }

          return {
            index: slot.slot_index,
            name: slot.slot_name,
            resourceClass: resourceClass,
            resourceClassName: displayName,
            resourceClassIcon: icon,
            quantity: slot.quantity,
            optional: slot.optional === 1,
            weights: slot.weights,
            ingredientType: ingredientType,
            isTemplateSlot: isTemplate,
            templatePath: templatePath,
          };
        }),
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
 * GET /api/schematics/:id/best-resources
 * Get best resources for each slot in a schematic
 */
router.get('/:id/best-resources', (req, res) => {
  try {
    const { includeHistorical = 'true' } = req.query;
    
    const result = getBestResourcesForSchematic(req.params.id, {
      includeHistorical: includeHistorical === 'true',
    });
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Schematic not found',
      });
    }
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/schematics/:id/slots/:slotIndex/top-resources
 * Get top N resources for a specific slot
 */
router.get('/:id/slots/:slotIndex/top-resources', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const slotIndex = parseInt(req.params.slotIndex, 10);
    
    const resources = getTopResourcesForSlot(
      req.params.id,
      slotIndex,
      parseInt(limit, 10)
    );
    
    res.json({
      success: true,
      count: resources.length,
      data: resources,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

