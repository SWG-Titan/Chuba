import { LRUCache } from 'lru-cache';
import { getLocalDb } from '../database/local-db.js';
import { getSchematicById, getCachedTemplateName, resolveIffDisplayName } from './schematic-service.js';
import { getResourcesByClass, getResourceById } from './resource-service.js';
import { calculateWeightedScore } from '../utils/resource-helpers.js';
import { createLogger } from '../utils/logger.js';
import { getResourceStringName, getResourceIcon, getAllMatchingResourceClasses, getResourceClass } from './resource-tree-service.js';
import { isTemplateIngredient } from '../parsers/tpf-parser.js';

const logger = createLogger('matching-service');

/**
 * Get display name and icon for a slot's resource_class (template path or resource class).
 * Template paths (IFF) are resolved via shared TPF + STF; resource classes use resource tree.
 */
function getSlotDisplayNameAndIcon(slot) {
  const resourceClass = slot.resource_class;
  if (!resourceClass) return { displayName: '', icon: 'default.png', isTemplateSlot: false, templatePath: null };

  const ingredientType = slot.ingredient_type || 'IT_resourceClass';
  const isTemplate = isTemplateIngredient(ingredientType);
  const looksLikeIffPath = typeof resourceClass === 'string' &&
    resourceClass.includes('object/') && (resourceClass.endsWith('.iff') || resourceClass.includes('.iff'));

  if (isTemplate || looksLikeIffPath) {
    const cached = getCachedTemplateName(resourceClass);
    const displayName = cached?.display_name || resolveIffDisplayName(resourceClass) ||
      (() => {
        const lastSlash = resourceClass.lastIndexOf('/');
        let name = lastSlash >= 0 ? resourceClass.substring(lastSlash + 1) : resourceClass;
        if (name.endsWith('.iff')) name = name.slice(0, -4);
        return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      })();
    return { displayName: displayName || resourceClass, icon: 'default.png', isTemplateSlot: true, templatePath: resourceClass };
  }

  return {
    displayName: getResourceStringName(resourceClass),
    icon: getResourceIcon(resourceClass),
    isTemplateSlot: false,
    templatePath: null,
  };
}

/**
 * LRU Cache for match results
 * Key: schematic_id:slot_index
 * Value: { activeMatch, historicalMatch, computedAt }
 */
const matchCache = new LRUCache({
  max: 5000,
  ttl: 1000 * 60 * 15, // 15 minutes TTL
});

/**
 * Cache invalidation flag
 */
let cacheInvalidated = false;

/**
 * Invalidate match cache (call when resources change)
 */
export function invalidateMatchCache() {
  cacheInvalidated = true;
  matchCache.clear();

  // Also clear database-level cached matches so they get recomputed with current logic
  try {
    const db = getLocalDb();
    db.prepare('DELETE FROM cached_matches').run();
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to clear cached_matches table');
  }

  logger.info('Match cache invalidated (memory + database)');
}

/**
 * Get cache key for a slot
 * @param {string} schematicId - Schematic ID
 * @param {number} slotIndex - Slot index
 * @returns {string} Cache key
 */
function getCacheKey(schematicId, slotIndex) {
  return `${schematicId}:${slotIndex}`;
}

/**
 * Get resources by class, including all descendant subclasses.
 * E.g., if resourceClass is 'metal', returns resources of 'metal', 'metal_ferrous', etc.
 * @param {string} resourceClass - Resource class name (may be a parent/root class)
 * @param {boolean} activeOnly - Only return active resources
 * @returns {Array} Array of resources
 */
function getResourcesByClassWithDescendants(resourceClass, activeOnly = true) {
  const allClasses = getAllMatchingResourceClasses(resourceClass);
  let allResources = [];
  for (const cls of allClasses) {
    const resources = getResourcesByClass(cls, activeOnly);
    allResources = allResources.concat(resources);
  }
  return allResources;
}

/**
 * Find best matching resources for a schematic slot
 * @param {Object} slot - Schematic slot
 * @param {Object} weights - Stat weights for the slot
 * @param {boolean} activeOnly - Only consider active resources
 * @returns {Object} Best match result
 */
export function findBestMatchForSlot(slot, weights, activeOnly = true) {
  const resources = getResourcesByClassWithDescendants(slot.resource_class, activeOnly);

  if (resources.length === 0) {
    return {
      resourceId: null,
      resource: null,
      score: 0,
      scoreBreakdown: {},
    };
  }

  // Default weights if none specified
  const effectiveWeights = Object.keys(weights).length > 0 ? weights : { OQ: 1 };

  let bestResource = null;
  let bestScore = -1;
  let bestBreakdown = {};

  for (const resource of resources) {
    const stats = {
      OQ: resource.stat_oq,
      CD: resource.stat_cd,
      DR: resource.stat_dr,
      FL: resource.stat_fl,
      HR: resource.stat_hr,
      MA: resource.stat_ma,
      PE: resource.stat_pe,
      SR: resource.stat_sr,
      UT: resource.stat_ut,
      CR: resource.stat_cr,
      ER: resource.stat_er,
    };

    const score = calculateWeightedScore(stats, effectiveWeights);

    if (score > bestScore) {
      bestScore = score;
      bestResource = resource;
      bestBreakdown = calculateScoreBreakdown(stats, effectiveWeights);
    }
  }

  return {
    resourceId: bestResource?.resource_id || null,
    resource: bestResource,
    score: bestScore,
    scoreBreakdown: bestBreakdown,
  };
}

/**
 * Calculate score breakdown by stat
 * @param {Object} stats - Resource stats
 * @param {Object} weights - Stat weights
 * @returns {Object} Score contribution by stat
 */
function calculateScoreBreakdown(stats, weights) {
  const breakdown = {};

  for (const [stat, weight] of Object.entries(weights)) {
    if (stats[stat] !== undefined && weight > 0) {
      breakdown[stat] = {
        value: stats[stat],
        weight: weight,
        contribution: Math.round(stats[stat] * weight),
      };
    }
  }

  return breakdown;
}

/**
 * Get best resources for all slots in a schematic
 * @param {string} schematicId - Schematic ID
 * @param {Object} options - Options
 * @returns {Object} Match results for all slots
 */
export function getBestResourcesForSchematic(schematicId, options = {}) {
  const { useCache = true, includeHistorical = true } = options;

  const schematic = getSchematicById(schematicId);
  if (!schematic) {
    return null;
  }

  const results = {
    schematicId,
    schematicName: schematic.schematic_name,
    slots: [],
    overallScore: 0,
    computedAt: new Date().toISOString(),
  };

  for (const slot of schematic.slots) {
    const cacheKey = getCacheKey(schematicId, slot.slot_index);

    // Check cache
    if (useCache && matchCache.has(cacheKey)) {
      const cached = matchCache.get(cacheKey);
      const { displayName: resourceClassName, icon: resourceClassIcon, isTemplateSlot, templatePath } = getSlotDisplayNameAndIcon(slot);
      results.slots.push({
        slotIndex: slot.slot_index,
        slotName: slot.slot_name,
        resourceClass: slot.resource_class,
        resourceClassName,
        resourceClassIcon,
        quantity: slot.quantity,
        isTemplateSlot,
        templatePath,
        ...cached,
      });
      continue;
    }

    // Find best active match
    const activeMatch = findBestMatchForSlot(slot, slot.weights || {}, true);

    // Find best historical match
    let historicalMatch = null;
    if (includeHistorical) {
      historicalMatch = findBestMatchForSlot(slot, slot.weights || {}, false);
    }

    const { displayName: resourceClassName, icon: resourceClassIcon, isTemplateSlot, templatePath } = getSlotDisplayNameAndIcon(slot);
    const slotResult = {
      slotIndex: slot.slot_index,
      slotName: slot.slot_name,
      resourceClass: slot.resource_class,
      resourceClassName,
      resourceClassIcon,
      quantity: slot.quantity,
      weights: slot.weights,
      isTemplateSlot,
      templatePath,
      bestActive: {
        resourceId: activeMatch.resourceId,
        resourceName: activeMatch.resource?.resource_name || null,
        score: activeMatch.score,
        scoreBreakdown: activeMatch.scoreBreakdown,
      },
      bestHistorical: historicalMatch ? {
        resourceId: historicalMatch.resourceId,
        resourceName: historicalMatch.resource?.resource_name || null,
        score: historicalMatch.score,
        isActive: historicalMatch.resource?.is_active === 1,
      } : null,
    };

    // Cache the result
    matchCache.set(cacheKey, {
      bestActive: slotResult.bestActive,
      bestHistorical: slotResult.bestHistorical,
    });

    // Persist to database
    persistCachedMatch(schematicId, slot.slot_index, slotResult);

    results.slots.push(slotResult);
  }

  // Calculate overall score
  if (results.slots.length > 0) {
    const totalScore = results.slots.reduce((sum, s) => sum + (s.bestActive?.score || 0), 0);
    results.overallScore = Math.round(totalScore / results.slots.length);
  }

  return results;
}

/**
 * Persist cached match to database
 * @param {string} schematicId - Schematic ID
 * @param {number} slotIndex - Slot index
 * @param {Object} result - Match result
 */
function persistCachedMatch(schematicId, slotIndex, result) {
  const db = getLocalDb();

  db.prepare(`
    INSERT OR REPLACE INTO cached_matches (
      schematic_id, slot_index,
      best_active_resource_id, best_active_score,
      best_historical_resource_id, best_historical_score,
      computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    schematicId,
    slotIndex,
    result.bestActive?.resourceId,
    result.bestActive?.score,
    result.bestHistorical?.resourceId,
    result.bestHistorical?.score
  );
}

/**
 * Get cached matches from database
 * @param {string} schematicId - Schematic ID
 * @returns {Array} Cached matches
 */
export function getCachedMatches(schematicId) {
  const db = getLocalDb();
  return db.prepare(`
    SELECT cm.*, 
           ar.resource_name as active_resource_name,
           hr.resource_name as historical_resource_name
    FROM cached_matches cm
    LEFT JOIN resources ar ON cm.best_active_resource_id = ar.resource_id
    LEFT JOIN resources hr ON cm.best_historical_resource_id = hr.resource_id
    WHERE cm.schematic_id = ?
    ORDER BY cm.slot_index
  `).all(schematicId);
}

/**
 * Find schematics that use a specific resource class (or any of its ancestor classes)
 * @param {string} resourceClass - Resource class
 * @returns {Array} Schematics using this resource class
 */
export function findSchematicsUsingResourceClass(resourceClass) {
  const db = getLocalDb();

  // Include the class itself and all ancestor classes
  const resourceClassInfo = getResourceClass(resourceClass);
  const matchClasses = [resourceClass];
  if (resourceClassInfo && resourceClassInfo.ancestors) {
    matchClasses.push(...resourceClassInfo.ancestors);
  }

  const placeholders = matchClasses.map(() => '?').join(',');
  return db.prepare(`
    SELECT DISTINCT s.*, ss.slot_index, ss.slot_name, ss.quantity
    FROM schematics s
    JOIN schematic_slots ss ON s.schematic_id = ss.schematic_id
    WHERE ss.resource_class IN (${placeholders})
    ORDER BY s.schematic_name
  `).all(...matchClasses);
}

/**
 * Find schematics where a specific resource is the best match
 * @param {string} resourceId - Resource ID
 * @returns {Array} Schematics where this resource is best
 */
export function findSchematicsForResource(resourceId) {
  const db = getLocalDb();

  // Get resource details
  const resource = getResourceById(resourceId);
  if (!resource) return [];

  // Build the list of resource classes to match against:
  // The resource's own class plus all of its ancestors.
  // E.g., a resource of class 'metal_ferrous' should also match slots
  // that ask for 'metal' (the parent class).
  const resourceClassInfo = getResourceClass(resource.resource_class);
  const matchClasses = [resource.resource_class];
  if (resourceClassInfo && resourceClassInfo.ancestors) {
    matchClasses.push(...resourceClassInfo.ancestors);
  }

  // Find all slots that match this resource's class or any of its ancestor classes
  const placeholders = matchClasses.map(() => '?').join(',');
  const matchingSlots = db.prepare(`
    SELECT s.*, ss.slot_index, ss.slot_name, ss.quantity
    FROM schematics s
    JOIN schematic_slots ss ON s.schematic_id = ss.schematic_id
    WHERE ss.resource_class IN (${placeholders})
  `).all(...matchClasses);

  // Check if this resource is the best for each slot
  const results = [];
  for (const slot of matchingSlots) {
    const cached = db.prepare(`
      SELECT * FROM cached_matches
      WHERE schematic_id = ? AND slot_index = ?
    `).get(slot.schematic_id, slot.slot_index);

    if (cached && (cached.best_active_resource_id === resourceId || cached.best_historical_resource_id === resourceId)) {
      results.push({
        schematicId: slot.schematic_id,
        schematicName: slot.schematic_name,
        slotIndex: slot.slot_index,
        slotName: slot.slot_name,
        isBestActive: cached.best_active_resource_id === resourceId,
        isBestHistorical: cached.best_historical_resource_id === resourceId,
        score: cached.best_active_resource_id === resourceId ? cached.best_active_score : cached.best_historical_score,
      });
    }
  }

  return results;
}

/**
 * Recompute all matches for schematics affected by resource changes
 * @param {Array<string>} changedResourceClasses - Resource classes that changed
 */
export function recomputeAffectedMatches(changedResourceClasses) {
  const db = getLocalDb();

  // Expand changed classes to include all ancestor classes.
  // E.g., if 'metal_ferrous' changed, schematics with slots for 'metal' are also affected.
  const allAffectedClasses = new Set(changedResourceClasses);
  for (const cls of changedResourceClasses) {
    const classInfo = getResourceClass(cls);
    if (classInfo && classInfo.ancestors) {
      for (const ancestor of classInfo.ancestors) {
        allAffectedClasses.add(ancestor);
      }
    }
  }

  const affectedClassesArray = Array.from(allAffectedClasses);

  // Find all schematics with slots using these resource classes
  const placeholders = affectedClassesArray.map(() => '?').join(',');
  const affectedSchematics = db.prepare(`
    SELECT DISTINCT schematic_id
    FROM schematic_slots
    WHERE resource_class IN (${placeholders})
  `).all(...affectedClassesArray);

  logger.info({ count: affectedSchematics.length }, 'Recomputing matches for affected schematics');

  for (const { schematic_id } of affectedSchematics) {
    // Invalidate cache for this schematic
    const schematic = getSchematicById(schematic_id);
    if (schematic) {
      for (const slot of schematic.slots) {
        matchCache.delete(getCacheKey(schematic_id, slot.slot_index));
      }
    }

    // Recompute
    getBestResourcesForSchematic(schematic_id, { useCache: false });
  }
}

/**
 * Get top resources for a schematic slot
 * @param {string} schematicId - Schematic ID
 * @param {number} slotIndex - Slot index
 * @param {number} limit - Max results
 * @returns {Array} Top resources with scores
 */
export function getTopResourcesForSlot(schematicId, slotIndex, limit = 10) {
  const schematic = getSchematicById(schematicId);
  if (!schematic) return [];

  const slot = schematic.slots.find(s => s.slot_index === slotIndex);
  if (!slot) return [];

  const resources = getResourcesByClassWithDescendants(slot.resource_class, false); // Include inactive
  const weights = slot.weights || { OQ: 1 };

  // Score all resources
  const scored = resources.map(resource => {
    const stats = {
      OQ: resource.stat_oq,
      CD: resource.stat_cd,
      DR: resource.stat_dr,
      FL: resource.stat_fl,
      HR: resource.stat_hr,
      MA: resource.stat_ma,
      PE: resource.stat_pe,
      SR: resource.stat_sr,
      UT: resource.stat_ut,
      CR: resource.stat_cr,
      ER: resource.stat_er,
    };

    return {
      resourceId: resource.resource_id,
      resourceName: resource.resource_name,
      isActive: resource.is_active === 1,
      score: calculateWeightedScore(stats, weights),
      stats,
    };
  });

  // Sort by score and return top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

