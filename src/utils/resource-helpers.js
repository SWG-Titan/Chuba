import crypto from 'crypto';
import { getResourceIcon, getResourceStringName } from '../services/resource-tree-service.js';

/**
 * Resource stat names
 */
export const STAT_NAMES = ['OQ', 'CD', 'DR', 'FL', 'HR', 'MA', 'PE', 'SR', 'UT', 'CR', 'ER'];

/**
 * Normalize a stat value to 0-1000 range
 * @param {number} value - Raw stat value
 * @param {number} min - Minimum possible value
 * @param {number} max - Maximum possible value
 * @returns {number} Normalized value (0-1000)
 */
export function normalizeStat(value, min = 0, max = 1000) {
  if (value === null || value === undefined) return 0;
  const normalized = ((value - min) / (max - min)) * 1000;
  return Math.max(0, Math.min(1000, Math.round(normalized)));
}

/**
 * Create a fingerprint hash for a resource's stat profile
 * @param {Object} stats - Object containing stat values
 * @returns {string} SHA256 hash of the stats
 */
export function createStatFingerprint(stats) {
  const orderedStats = STAT_NAMES.map(name => stats[name] ?? 0).join(':');
  return crypto.createHash('sha256').update(orderedStats).digest('hex').substring(0, 16);
}

/**
 * Calculate weighted score for a resource based on stat weights
 * @param {Object} stats - Resource stats
 * @param {Object} weights - Stat weights (should sum to 1.0)
 * @returns {number} Weighted score (0-1000)
 */
export function calculateWeightedScore(stats, weights) {
  let score = 0;
  let totalWeight = 0;

  for (const [stat, weight] of Object.entries(weights)) {
    if (stats[stat] !== undefined && stats[stat] !== null && weight > 0) {
      score += (stats[stat] * weight);
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? Math.round(score / totalWeight * (Object.keys(weights).length > 0 ? totalWeight : 1)) : 0;
}

/**
 * Compare two resources and determine which is better for given weights
 * @param {Object} resourceA - First resource
 * @param {Object} resourceB - Second resource
 * @param {Object} weights - Stat weights
 * @returns {number} Negative if A is better, positive if B is better, 0 if equal
 */
export function compareResources(resourceA, resourceB, weights) {
  const scoreA = calculateWeightedScore(resourceA.stats, weights);
  const scoreB = calculateWeightedScore(resourceB.stats, weights);
  return scoreB - scoreA;
}

/**
 * Format resource for API response
 * @param {Object} resource - Raw resource data
 * @returns {Object} Formatted resource
 */
export function formatResourceResponse(resource) {
  const resourceClass = resource.resource_class;
  return {
    id: resource.resource_id,
    name: resource.resource_name,
    class: resourceClass,
    className: getResourceStringName(resourceClass),
    classIcon: getResourceIcon(resourceClass),
    planet: resource.planet,
    stats: {
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
    },
    spawnTime: resource.spawn_time,
    despawnTime: resource.despawn_time,
    isActive: resource.is_active === 1,
    fingerprint: resource.stat_fingerprint,
  };
}

