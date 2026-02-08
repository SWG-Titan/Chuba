import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { trackError } from '../services/error-tracker.js';

const logger = createLogger('item-stats-parser');

/**
 * Cached stats data
 */
let itemStatsCache = null;
let armorStatsCache = null;
let weaponStatsCache = null;

/**
 * Parse item_stats.tab
 * Columns: name, skill_mods, attribute_bonus, objvars, color, buff_name,
 *          cool_down_group, reuse_time, required_level_for_effect,
 *          hide_buff_identity, client_effect, client_animation
 */
export function parseItemStats(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.warn({ filePath }, 'item_stats.tab not found');
      return new Map();
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length < 2) return new Map();

    // First line is headers
    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());

    // Second line is data types - skip it
    let dataStart = 1;
    if (lines[1] && lines[1].includes('[')) {
      dataStart = 2;
    }

    const statsMap = new Map();

    for (let i = dataStart; i < lines.length; i++) {
      const values = lines[i].split('\t');
      const name = values[0]?.trim();

      if (!name) continue;

      const stat = {
        name,
        skill_mods: parseSkillMods(values[headers.indexOf('skill_mods')]),
        attribute_bonus: values[headers.indexOf('attribute_bonus')]?.trim() || null,
        objvars: values[headers.indexOf('objvars')]?.trim() || null,
        color: values[headers.indexOf('color')]?.trim() || null,
        buff_name: values[headers.indexOf('buff_name')]?.trim() || null,
        cool_down_group: values[headers.indexOf('cool_down_group')]?.trim() || null,
        reuse_time: parseInt(values[headers.indexOf('reuse_time')], 10) || 0,
        required_level_for_effect: parseInt(values[headers.indexOf('required_level_for_effect')], 10) || 0,
        hide_buff_identity: parseInt(values[headers.indexOf('hide_buff_identity')], 10) || 0,
        client_effect: values[headers.indexOf('client_effect')]?.trim() || null,
        client_animation: values[headers.indexOf('client_animation')]?.trim() || null,
      };

      statsMap.set(name, stat);
    }

    logger.info({ count: statsMap.size }, 'Parsed item_stats.tab');
    return statsMap;
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to parse item_stats.tab');
    trackError('item', { message: error.message, file: filePath, details: error.stack });
    return new Map();
  }
}

/**
 * Parse armor_stats.tab
 * Columns: name, armor_level, armor_category, condition_multiplier, protection,
 *          sockets, hit_points, skill_mods, attribute_bonus, objvars,
 *          reactive_effect, color, buff_name, required_level_for_effect, client_effect
 */
export function parseArmorStats(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.warn({ filePath }, 'armor_stats.tab not found');
      return new Map();
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length < 2) return new Map();

    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());

    // Skip data types line
    let dataStart = 1;
    if (lines[1] && (lines[1].includes('[') || /^[siefbhp](\t[siefbhp])*$/i.test(lines[1].replace(/\[.*?\]/g, '')))) {
      dataStart = 2;
    }

    const statsMap = new Map();

    for (let i = dataStart; i < lines.length; i++) {
      const values = lines[i].split('\t');
      const name = values[0]?.trim();

      if (!name) continue;

      const stat = {
        name,
        armor_level: parseArmorLevel(values[headers.indexOf('armor_level')]),
        armor_category: parseArmorCategory(values[headers.indexOf('armor_category')]),
        condition_multiplier: parseFloat(values[headers.indexOf('condition_multiplier')]) || 1.0,
        protection: parseFloat(values[headers.indexOf('protection')]) || 1.0,
        sockets: parseInt(values[headers.indexOf('sockets')], 10) || 0,
        hit_points: parseInt(values[headers.indexOf('hit_points')], 10) || 0,
        skill_mods: parseSkillMods(values[headers.indexOf('skill_mods')]),
        attribute_bonus: values[headers.indexOf('attribute_bonus')]?.trim() || null,
        objvars: values[headers.indexOf('objvars')]?.trim() || null,
        reactive_effect: values[headers.indexOf('reactive_effect')]?.trim() || null,
        color: values[headers.indexOf('color')]?.trim() || null,
        buff_name: values[headers.indexOf('buff_name')]?.trim() || null,
        required_level_for_effect: parseInt(values[headers.indexOf('required_level_for_effect')], 10) || 0,
        client_effect: values[headers.indexOf('client_effect')]?.trim() || null,
      };

      statsMap.set(name, stat);
    }

    logger.info({ count: statsMap.size }, 'Parsed armor_stats.tab');
    return statsMap;
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to parse armor_stats.tab');
    trackError('item', { message: error.message, file: filePath, details: error.stack });
    return new Map();
  }
}

/**
 * Parse weapon_stats.tab
 * Columns: name, volume, hit_points, min_damage, max_damage, accuracy,
 *          damage_type, elemental_type, elemental_damage, attack_speed,
 *          wound_chance, special_attack_cost, min_range_distance, max_range_distance,
 *          skill_mods, objvars, proc_effect, tier_granted, target_dps, actual_dps
 */
export function parseWeaponStats(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.warn({ filePath }, 'weapon_stats.tab not found');
      return new Map();
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length < 2) return new Map();

    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());

    // Skip data types line
    let dataStart = 1;
    if (lines[1] && (lines[1].includes('[') || /^[siefbhp](\t[siefbhp])*$/i.test(lines[1].replace(/\[.*?\]/g, '')))) {
      dataStart = 2;
    }

    const statsMap = new Map();

    for (let i = dataStart; i < lines.length; i++) {
      const values = lines[i].split('\t');
      const name = values[0]?.trim();

      if (!name) continue;

      const stat = {
        name,
        volume: parseInt(values[headers.indexOf('volume')], 10) || 0,
        hit_points: parseInt(values[headers.indexOf('hit_points')], 10) || 0,
        min_damage: parseInt(values[headers.indexOf('min_damage')], 10) || 0,
        max_damage: parseInt(values[headers.indexOf('max_damage')], 10) || 0,
        accuracy: parseInt(values[headers.indexOf('accuracy')], 10) || 0,
        damage_type: parseDamageType(values[headers.indexOf('damage_type')]),
        elemental_type: parseElementalType(values[headers.indexOf('elemental_type')]),
        elemental_damage: parseInt(values[headers.indexOf('elemental_damage')], 10) || 0,
        attack_speed: parseFloat(values[headers.indexOf('attack_speed')]) || 0,
        wound_chance: parseFloat(values[headers.indexOf('wound_chance')]) || 0,
        special_attack_cost: parseInt(values[headers.indexOf('special_attack_cost')], 10) || 0,
        min_range_distance: parseFloat(values[headers.indexOf('min_range_distance')]) || 0,
        max_range_distance: parseFloat(values[headers.indexOf('max_range_distance')]) || 0,
        skill_mods: parseSkillMods(values[headers.indexOf('skill_mods')]),
        objvars: values[headers.indexOf('objvars')]?.trim() || null,
        proc_effect: values[headers.indexOf('proc_effect')]?.trim() || null,
        tier_granted: values[headers.indexOf('tier_granted')]?.trim() || null,
        target_dps: parseFloat(values[headers.indexOf('target_dps')]) || 0,
        actual_dps: parseFloat(values[headers.indexOf('actual_dps')]) || 0,
      };

      // Calculate DPS if not provided
      if (!stat.actual_dps && stat.attack_speed > 0) {
        const avgDamage = (stat.min_damage + stat.max_damage) / 2;
        stat.calculated_dps = avgDamage / stat.attack_speed;
      }

      statsMap.set(name, stat);
    }

    logger.info({ count: statsMap.size }, 'Parsed weapon_stats.tab');
    return statsMap;
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to parse weapon_stats.tab');
    trackError('item', { message: error.message, file: filePath, details: error.stack });
    return new Map();
  }
}

/**
 * Parse skill_mods string into structured format
 * Format: "skill_name=value:skill_name2=value2" or similar
 */
function parseSkillMods(value) {
  if (!value || !value.trim()) return [];

  const mods = [];
  const parts = value.split(':');

  for (const part of parts) {
    const [skill, val] = part.split('=');
    if (skill && val) {
      mods.push({
        skill: skill.trim(),
        value: parseInt(val, 10) || parseFloat(val) || val.trim(),
      });
    }
  }

  return mods;
}

/**
 * Parse armor level enum
 */
function parseArmorLevel(value) {
  if (!value) return 'basic';
  const trimmed = value.trim().toLowerCase();
  const levels = { '0': 'basic', '1': 'standard', '2': 'advanced' };
  return levels[trimmed] || trimmed;
}

/**
 * Parse armor category enum
 */
function parseArmorCategory(value) {
  if (!value) return 'recon';
  const trimmed = value.trim().toLowerCase();
  const categories = { '0': 'recon', '1': 'battle', '2': 'assault' };
  return categories[trimmed] || trimmed;
}

/**
 * Parse damage type
 */
function parseDamageType(value) {
  if (!value) return null;
  const trimmed = value.trim();
  // Common damage types in SWG
  const types = {
    '0': 'kinetic',
    '1': 'energy',
    '2': 'blast',
    '3': 'stun',
    '4': 'heat',
    '5': 'cold',
    '6': 'acid',
    '7': 'electricity',
  };
  return types[trimmed] || trimmed;
}

/**
 * Parse elemental type
 */
function parseElementalType(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const types = {
    '0': 'none',
    '1': 'heat',
    '2': 'cold',
    '3': 'acid',
    '4': 'electricity',
  };
  return types[trimmed] || trimmed;
}

/**
 * Load all stats files from a directory
 * @param {string} basePath - Base path to datatables/item directory
 * @returns {Object} Loaded stats caches
 */
export function loadAllItemStats(basePath) {
  const itemStatsPath = path.join(basePath, 'item_stats.tab');
  const armorStatsPath = path.join(basePath, 'armor_stats.tab');
  const weaponStatsPath = path.join(basePath, 'weapon_stats.tab');

  itemStatsCache = parseItemStats(itemStatsPath);
  armorStatsCache = parseArmorStats(armorStatsPath);
  weaponStatsCache = parseWeaponStats(weaponStatsPath);

  logger.info({
    itemStats: itemStatsCache.size,
    armorStats: armorStatsCache.size,
    weaponStats: weaponStatsCache.size,
  }, 'Loaded all item stats');

  return {
    itemStats: itemStatsCache,
    armorStats: armorStatsCache,
    weaponStats: weaponStatsCache,
  };
}

/**
 * Get stats for an item by name
 * Checks all three stats tables
 * @param {string} name - Item name
 * @returns {Object|null} Combined stats or null
 */
export function getStatsForItem(name) {
  if (!name) return null;

  const result = {
    hasStats: false,
    itemStats: null,
    armorStats: null,
    weaponStats: null,
  };

  if (itemStatsCache?.has(name)) {
    result.itemStats = itemStatsCache.get(name);
    result.hasStats = true;
  }

  if (armorStatsCache?.has(name)) {
    result.armorStats = armorStatsCache.get(name);
    result.hasStats = true;
  }

  if (weaponStatsCache?.has(name)) {
    result.weaponStats = weaponStatsCache.get(name);
    result.hasStats = true;
  }

  return result.hasStats ? result : null;
}

/**
 * Get item stats cache
 */
export function getItemStatsCache() {
  return itemStatsCache;
}

/**
 * Get armor stats cache
 */
export function getArmorStatsCache() {
  return armorStatsCache;
}

/**
 * Get weapon stats cache
 */
export function getWeaponStatsCache() {
  return weaponStatsCache;
}

/**
 * Get stats summary (counts)
 */
export function getStatsCacheSummary() {
  return {
    itemStats: itemStatsCache?.size || 0,
    armorStats: armorStatsCache?.size || 0,
    weaponStats: weaponStatsCache?.size || 0,
    total: (itemStatsCache?.size || 0) + (armorStatsCache?.size || 0) + (weaponStatsCache?.size || 0),
  };
}

