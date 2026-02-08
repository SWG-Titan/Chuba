/**
 * Quest Service
 * Parses and provides quest data from SWG questlist and questtask datatables
 */
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { parseTPFStringRefs } from '../parsers/tpf-parser.js';
import { resolveStringRef as stfResolveStringRef } from '../parsers/stf-parser.js';

const logger = createLogger('quest-service');

// Cache for parsed quests
let questCache = new Map();
let questTaskCache = new Map();
let stringCache = new Map();
let questListLoaded = false;

// Column definitions for questlist
const QUESTLIST_COLUMNS = [
  'LEVEL', 'TIER', 'TYPE', 'JOURNAL_ENTRY_TITLE', 'JOURNAL_ENTRY_DESCRIPTION', 'CATEGORY', 'VISIBLE',
  'JOURNAL_ENTRY_COMPLETION_SUMMARY', 'PREREQUISITE_QUESTS', 'EXCLUSION_QUESTS', 'ALLOW_REPEATS',
  'QUEST_REWARD_EXPERIENCE_TYPE', 'QUEST_REWARD_EXPERIENCE_AMOUNT', 'QUEST_REWARD_FACTION_NAME',
  'QUEST_REWARD_FACTION_AMOUNT', 'GRANT_GCW', 'QUEST_REWARD_BANK_CREDITS', 'QUEST_REWARD_LOOT_NAME',
  'QUEST_REWARD_LOOT_COUNT', 'QUEST_REWARD_LOOT_NAME_2', 'QUEST_REWARD_LOOT_COUNT_2',
  'QUEST_REWARD_LOOT_NAME_3', 'QUEST_REWARD_LOOT_COUNT_3', 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME',
  'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT', 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_2', 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_2',
  'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_3', 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_3', 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_4',
  'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_4', 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_5', 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_5',
  'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_6', 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_6', 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_7',
  'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_7', 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_8', 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_8',
  'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_9', 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_9', 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME_10',
  'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_10', 'QUEST_REWARD_ITEM', 'QUEST_REWARD_COUNT', 'QUEST_REWARD_WEAPON',
  'QUEST_REWARD_COUNT_WEAPON', 'QUEST_REWARD_SPEED', 'QUEST_REWARD_DAMAGE', 'QUEST_REWARD_EFFICIENCY',
  'QUEST_REWARD_ELEMENTAL_VALUE', 'QUEST_REWARD_ARMOR', 'QUEST_REWARD_COUNT_ARMOR', 'QUEST_REWARD_QUALITY',
  'REWARD_BADGE', 'QUEST_PENALTY_FACTION_NAME', 'QUEST_PENALTY_FACTION_AMOUNT', 'TARGET', 'PARAMETER',
  'COMPLETE_WHEN_TASKS_COMPLETE', 'CONDITIONAL_QUEST_GRANT_QUEST', 'CONDITIONAL_QUEST_GRANT_QUEST_LIST_OF_COMPLETED_QUESTS'
];

// Column definitions for questtask
const QUESTTASK_COLUMNS = [
  'ATTACH_SCRIPT', 'JOURNAL_ENTRY_TITLE', 'JOURNAL_ENTRY_DESCRIPTION', 'IS_VISIBLE', 'PREREQUISITE_TASKS',
  'EXCLUSION_TASKS', 'ALLOW_REPEATS', 'TASKS_ON_COMPLETE', 'TASKS_ON_FAIL', 'TASK_NAME', 'SHOW_SYSTEM_MESSAGES',
  'MUSIC_ON_ACTIVATE', 'MUSIC_ON_COMPLETE', 'MUSIC_ON_FAILURE', 'CHANCE_TO_ACTIVATE', 'QUEST_CONTROL_ON_TASK_COMPLETION',
  'QUEST_CONTROL_ON_TASK_FAILURE', 'TARGET', 'PARAMETER', 'GRANT_QUEST_ON_COMPLETE', 'GRANT_QUEST_ON_COMPLETE_SHOW_SYSTEM_MESSAGE',
  'GRANT_QUEST_ON_FAIL', 'GRANT_QUEST_ON_FAIL_SHOW_SYSTEM_MESSAGE', 'SIGNALS_ON_COMPLETE', 'SIGNALS_ON_FAIL',
  'CREATE_WAYPOINT', 'PLANET_NAME', 'LOCATION_X', 'LOCATION_Y', 'LOCATION_Z', 'INTERIOR_WAYPOINT_APPEARANCE',
  'WAYPOINT_BUILDING_CELL_NAME', 'WAYPOINT_NAME', 'CREATE_ENTRANCE_WAYPOINT', 'ENTRANCE_LOCATION_X',
  'ENTRANCE_LOCATION_Y', 'ENTRANCE_LOCATION_Z', 'ENTRANCE_WAYPOINT_NAME', 'SIGNAL_NAME', 'WAIT_MARKER_CREATE',
  'WAIT_MARKER_TEMPLATE', 'WAIT_MARKER_PLANET_NAME', 'WAIT_MARKER_BUILDING', 'WAIT_MARKER_CELL_NAME',
  'WAIT_MARKER_X', 'WAIT_MARKER_Y', 'WAIT_MARKER_Z', 'TIMER_AMOUNT', 'SERVER_TEMPLATE', 'RETRIEVE_MENU_TEXT',
  'START_MESSAGE', 'PRIMARY_TARGET_WAVE_1', 'UTTERANCE_WAVE_1', 'RADIUS_WAVE_1', 'GUARDS_SPAWNED_WAVE_1',
  'NUM_GUARDS_WAVE_1', 'DELAY_WAVE_1', 'PRIMARY_TARGET_WAVE_2', 'UTTERANCE_WAVE_2', 'RADIUS_WAVE_2',
  'GUARDS_SPAWNED_WAVE_2', 'NUM_GUARDS_WAVE_2', 'DELAY_WAVE_2', 'PRIMARY_TARGET_WAVE_3', 'UTTERANCE_WAVE_3',
  'RADIUS_WAVE_3', 'GUARDS_SPAWNED_WAVE_3', 'NUM_GUARDS_WAVE_3', 'DELAY_WAVE_3', 'PRIMARY_TARGET_WAVE_4',
  'UTTERANCE_WAVE_4', 'RADIUS_WAVE_4', 'GUARDS_SPAWNED_WAVE_4', 'NUM_GUARDS_WAVE_4', 'DELAY_WAVE_4',
  'PRIMARY_TARGET_WAVE_5', 'UTTERANCE_WAVE_5', 'RADIUS_WAVE_5', 'GUARDS_SPAWNED_WAVE_5', 'NUM_GUARDS_WAVE_5',
  'DELAY_WAVE_5', 'PRIMARY_TARGET_WAVE_6', 'UTTERANCE_WAVE_6', 'RADIUS_WAVE_6', 'GUARDS_SPAWNED_WAVE_6',
  'NUM_GUARDS_WAVE_6', 'DELAY_WAVE_6', 'TASK_QUEST_NAME_1', 'TASK_TASK_NAME_1', 'TASK_DISPLAY_STRING_1',
  'TASK_QUEST_NAME_2', 'TASK_TASK_NAME_2', 'TASK_DISPLAY_STRING_2', 'TASK_QUEST_NAME_3', 'TASK_TASK_NAME_3',
  'TASK_DISPLAY_STRING_3', 'TASK_QUEST_NAME_4', 'TASK_TASK_NAME_4', 'TASK_DISPLAY_STRING_4', 'TASK_QUEST_NAME_5',
  'TASK_TASK_NAME_5', 'TASK_DISPLAY_STRING_5', 'TASK_QUEST_NAME_6', 'TASK_TASK_NAME_6', 'TASK_DISPLAY_STRING_6',
  'NUM_REQUIRED', 'ITEM_NAME', 'DROP_PERCENT', 'GUARANTEED_SUCCESS_MIN', 'GUARANTEED_SUCCESS_MAX',
  'COUNTDOWN_TIMER', 'COMM_MESSAGE_TEXT', 'NPC_APPEARANCE_SERVER_TEMPLATE'
];

/**
 * Parse a tab-delimited line, handling empty fields
 */
function parseTabLine(line) {
  return line.split('\t').map(field => field.trim());
}

/**
 * Parse a string .tab file (key\tvalue format)
 */
function parseStringFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const strings = new Map();

    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts[1].trim();
        if (key && !key.startsWith('#')) {
          strings.set(key, value);
        }
      }
    }
    return strings;
  } catch (error) {
    return null;
  }
}

/**
 * Load string file for a quest
 */
function loadQuestStrings(questName) {
  if (stringCache.has(questName)) {
    return stringCache.get(questName);
  }

  const stringPath = config.quest?.questStringsPath;
  if (!stringPath) return null;

  const filePath = path.join(stringPath, `${questName}.tab`);
  const strings = parseStringFile(filePath);

  if (strings) {
    stringCache.set(questName, strings);
  }
  return strings;
}

/**
 * Resolve a string reference to its actual value
 * @param {string} stringRef - e.g., @quest/ground/axkva_min_intro:journal_entry_title
 * @returns {object} - { file, key, value, raw }
 */
export function resolveStringRef(stringRef) {
  if (!stringRef || typeof stringRef !== 'string') {
    return { file: null, key: null, value: stringRef || '', raw: stringRef };
  }

  if (!stringRef.startsWith('@')) {
    return { file: null, key: null, value: stringRef, raw: stringRef };
  }

  const withoutAt = stringRef.substring(1);
  const colonIdx = withoutAt.indexOf(':');

  if (colonIdx === -1) {
    return { file: withoutAt, key: null, value: stringRef, raw: stringRef };
  }

  const file = withoutAt.substring(0, colonIdx);
  const key = withoutAt.substring(colonIdx + 1);

  // Extract quest name from file path (e.g., quest/ground/axkva_min_intro -> axkva_min_intro)
  const pathParts = file.split('/');
  const questName = pathParts[pathParts.length - 1];

  // Try to load and resolve the string
  const strings = loadQuestStrings(questName);
  const value = strings?.get(key) || null;

  return { file, key, value, raw: stringRef };
}

/**
 * Parse a SWG datatable .tab file
 * Format:
 *   Row 0: Column headers (ALL_CAPS names)
 *   Row 1: Data types (i=int, s=string, b=bool, f=float, e=enum, S=stringId)
 *   Row 2+: Actual data rows
 */
function parseDatatableFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  
  if (lines.length < 3) {
    // Need at least headers, types, and one data row
    logger.warn({ filePath, lineCount: lines.length }, 'Datatable file has insufficient lines');
    return { columns: [], types: [], rows: [] };
  }
  
  const columns = parseTabLine(lines[0]);
  const types = parseTabLine(lines[1]);

  // SWG datatable type row contains short type identifiers:
  // i = integer, s = string, b = boolean, f = float, S = stringId, e(...) = enum
  // Type definitions are typically very short (1-2 chars) or enum format e(...)[...]
  const isTypeDefinition = (t) => {
    if (!t) return false;
    // Single char types: i, s, b, f, S, etc.
    if (t.length === 1 && /^[ibfsSBe]$/.test(t)) return true;
    // Enum types: e(none=0,complete=1,clear=2)[none]
    if (t.startsWith('e(') || t.startsWith('e[')) return true;
    // Sometimes types have brackets like [none]
    if (/^[ibfsSB]\[/.test(t)) return true;
    return false;
  };

  // Check if all values in the second row look like type definitions
  const looksLikeTypes = types.every(t => isTypeDefinition(t));

  if (!looksLikeTypes) {
    logger.warn({ filePath, firstTypes: types.slice(0, 5) }, 'Second row does not look like type definitions');
  }

  const rows = [];
  const dataStartIndex = looksLikeTypes ? 2 : 1;

  // Parse data rows
  for (let i = dataStartIndex; i < lines.length; i++) {
    const values = parseTabLine(lines[i]);
    const row = {};
    
    columns.forEach((col, idx) => {
      const value = values[idx] || '';
      const typeSpec = looksLikeTypes ? (types[idx] || 's') : 's';
      // Extract base type (first char, ignoring enum details)
      const type = typeSpec.charAt(0).toLowerCase();

      // Convert based on type
      if (type === 'i') {
        row[col] = parseInt(value) || 0;
      } else if (type === 'f') {
        row[col] = parseFloat(value) || 0;
      } else if (type === 'b') {
        row[col] = value === '1' || value === 'true';
      } else {
        row[col] = value;
      }
    });
    
    rows.push(row);
  }
  
  logger.info({ filePath, columnCount: columns.length, rowCount: rows.length, firstColumns: columns.slice(0, 3) }, 'Parsed datatable');

  return { columns, types: looksLikeTypes ? types : [], rows };
}

/**
 * Parse a questlist .tab file
 */
function parseQuestListFile(filePath) {
  try {
    const { rows } = parseDatatableFile(filePath);
    
    if (rows.length === 0) return null;
    
    // Quest list files should have exactly one data row
    const quest = rows[0];
    
    // Ensure numeric fields are properly parsed
    quest.LEVEL = parseInt(quest.LEVEL) || 0;
    quest.TIER = parseInt(quest.TIER) || 0;
    quest.VISIBLE = quest.VISIBLE === true || quest.VISIBLE === 1 || quest.VISIBLE === '1';
    quest.ALLOW_REPEATS = quest.ALLOW_REPEATS === true || quest.ALLOW_REPEATS === 1 || quest.ALLOW_REPEATS === '1';
    quest.QUEST_REWARD_EXPERIENCE_AMOUNT = parseInt(quest.QUEST_REWARD_EXPERIENCE_AMOUNT) || 0;
    quest.QUEST_REWARD_FACTION_AMOUNT = parseInt(quest.QUEST_REWARD_FACTION_AMOUNT) || 0;
    quest.QUEST_PENALTY_FACTION_AMOUNT = parseInt(quest.QUEST_PENALTY_FACTION_AMOUNT) || 0;
    quest.GRANT_GCW = quest.GRANT_GCW === true || quest.GRANT_GCW === 1 || quest.GRANT_GCW === '1';
    quest.QUEST_REWARD_BANK_CREDITS = parseInt(quest.QUEST_REWARD_BANK_CREDITS) || 0;
    quest.COMPLETE_WHEN_TASKS_COMPLETE = quest.COMPLETE_WHEN_TASKS_COMPLETE === true || quest.COMPLETE_WHEN_TASKS_COMPLETE === 1 || quest.COMPLETE_WHEN_TASKS_COMPLETE === '1';

    // Parse loot counts
    quest.QUEST_REWARD_LOOT_COUNT = parseInt(quest.QUEST_REWARD_LOOT_COUNT) || 0;
    quest.QUEST_REWARD_LOOT_COUNT_2 = parseInt(quest.QUEST_REWARD_LOOT_COUNT_2) || 0;
    quest.QUEST_REWARD_LOOT_COUNT_3 = parseInt(quest.QUEST_REWARD_LOOT_COUNT_3) || 0;
    
    for (let i = 1; i <= 10; i++) {
      const countKey = i === 1 ? 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT' : `QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_${i}`;
      quest[countKey] = parseInt(quest[countKey]) || 0;
    }
    
    quest.QUEST_REWARD_COUNT = parseInt(quest.QUEST_REWARD_COUNT) || 0;
    quest.QUEST_REWARD_COUNT_WEAPON = parseInt(quest.QUEST_REWARD_COUNT_WEAPON) || 0;
    quest.QUEST_REWARD_COUNT_ARMOR = parseInt(quest.QUEST_REWARD_COUNT_ARMOR) || 0;

    return quest;
  } catch (error) {
    logger.warn({ filePath, error: error.message }, 'Failed to parse questlist file');
    return null;
  }
}

/**
 * Parse a questtask .tab file
 */
function parseQuestTaskFile(filePath) {
  try {
    const { rows } = parseDatatableFile(filePath);

    if (rows.length === 0) return [];

    const tasks = rows.map(task => {
      // Ensure boolean fields are properly parsed
      task.IS_VISIBLE = task.IS_VISIBLE === true || task.IS_VISIBLE === 1 || task.IS_VISIBLE === '1';
      task.ALLOW_REPEATS = task.ALLOW_REPEATS === true || task.ALLOW_REPEATS === 1 || task.ALLOW_REPEATS === '1';
      task.SHOW_SYSTEM_MESSAGES = task.SHOW_SYSTEM_MESSAGES === true || task.SHOW_SYSTEM_MESSAGES === 1 || task.SHOW_SYSTEM_MESSAGES === '1';
      task.CREATE_WAYPOINT = task.CREATE_WAYPOINT === true || task.CREATE_WAYPOINT === 1 || task.CREATE_WAYPOINT === '1';
      task.CREATE_ENTRANCE_WAYPOINT = task.CREATE_ENTRANCE_WAYPOINT === true || task.CREATE_ENTRANCE_WAYPOINT === 1 || task.CREATE_ENTRANCE_WAYPOINT === '1';
      task.WAIT_MARKER_CREATE = task.WAIT_MARKER_CREATE === true || task.WAIT_MARKER_CREATE === 1 || task.WAIT_MARKER_CREATE === '1';
      task.GRANT_QUEST_ON_COMPLETE_SHOW_SYSTEM_MESSAGE = task.GRANT_QUEST_ON_COMPLETE_SHOW_SYSTEM_MESSAGE === true || task.GRANT_QUEST_ON_COMPLETE_SHOW_SYSTEM_MESSAGE === 1 || task.GRANT_QUEST_ON_COMPLETE_SHOW_SYSTEM_MESSAGE === '1';

      // Ensure numeric fields
      task.CHANCE_TO_ACTIVATE = parseInt(task.CHANCE_TO_ACTIVATE) || 0;
      task.LOCATION_X = parseFloat(task.LOCATION_X) || 0;
      task.LOCATION_Y = parseFloat(task.LOCATION_Y) || 0;
      task.LOCATION_Z = parseFloat(task.LOCATION_Z) || 0;
      task.TIMER_AMOUNT = parseInt(task.TIMER_AMOUNT) || 0;
      task.NUM_REQUIRED = parseInt(task.NUM_REQUIRED) || 0;
      task.DROP_PERCENT = parseInt(task.DROP_PERCENT) || 0;
      task.COUNTDOWN_TIMER = parseInt(task.COUNTDOWN_TIMER) || 0;

      // Extract task type from ATTACH_SCRIPT
      if (task.ATTACH_SCRIPT) {
        const scriptParts = task.ATTACH_SCRIPT.split('.');
        task.taskType = scriptParts[scriptParts.length - 1] || 'unknown';
      } else {
        task.taskType = 'unknown';
      }

      return task;
    });

    return tasks;
  } catch (error) {
    logger.warn({ filePath, error: error.message }, 'Failed to parse questtask file');
    return [];
  }
}

/**
 * Parse string reference (e.g., @quest/ground/axkva_min_intro:journal_entry_title)
 * This is the exported function that resolves to actual string values
 */
export function parseStringRef(stringRef) {
  return resolveStringRef(stringRef);
}

/**
 * Load all quests from questlist directory
 */
export function loadAllQuests(questListPath) {
  const basePath = questListPath || config.quest?.questListPath;

  if (!basePath) {
    logger.error('No questlist path configured');
    return;
  }

  logger.info({ basePath }, 'Loading quests from questlist directory');

  questCache.clear();
  questTaskCache.clear();

  const questDir = path.join(basePath, 'quest');

  if (!fs.existsSync(questDir)) {
    logger.warn({ questDir }, 'Quest directory not found');
    return;
  }

  const files = fs.readdirSync(questDir).filter(f => f.endsWith('.tab'));

  for (const file of files) {
    const questName = file.replace('.tab', '');
    const filePath = path.join(questDir, file);

    const quest = parseQuestListFile(filePath);
    if (quest) {
      quest.questName = questName;
      quest.questId = `quest/${questName}`;
      questCache.set(questName, quest);
    }
  }

  logger.info({ questCount: questCache.size }, 'Loaded quests');
  questListLoaded = true;
}

/**
 * Load quest tasks for a specific quest
 */
export function loadQuestTasks(questName, questTaskPath) {
  const basePath = questTaskPath || config.quest?.questTaskPath;

  if (!basePath) {
    logger.error('No questtask path configured');
    return [];
  }

  // Check cache first
  if (questTaskCache.has(questName)) {
    return questTaskCache.get(questName);
  }

  const filePath = path.join(basePath, 'quest', `${questName}.tab`);

  if (!fs.existsSync(filePath)) {
    logger.warn({ questName, filePath }, 'Quest task file not found');
    return [];
  }

  const tasks = parseQuestTaskFile(filePath);
  questTaskCache.set(questName, tasks);

  return tasks;
}

/**
 * Get all quests
 */
export function getAllQuests() {
  if (!questListLoaded) {
    loadAllQuests();
  }

  return Array.from(questCache.values());
}

/**
 * Get quest by name
 */
export function getQuestByName(questName) {
  if (!questListLoaded) {
    loadAllQuests();
  }

  return questCache.get(questName) || null;
}

/**
 * Get quest with tasks
 */
export function getQuestWithTasks(questName) {
  const quest = getQuestByName(questName);

  if (!quest) {
    return null;
  }

  const tasks = loadQuestTasks(questName);

  return {
    ...quest,
    tasks
  };
}

/**
 * Search quests by various criteria
 */
export function searchQuests(options = {}) {
  const {
    search,
    level,
    minLevel,
    maxLevel,
    tier,
    type,
    category,
    faction,
    planet,
    hasRewards,
    limit = 100,
    offset = 0
  } = options;

  let quests = getAllQuests();

  // Apply filters
  if (search) {
    const searchLower = search.toLowerCase();
    quests = quests.filter(q =>
      q.questName.toLowerCase().includes(searchLower) ||
      q.JOURNAL_ENTRY_TITLE?.toLowerCase().includes(searchLower) ||
      q.JOURNAL_ENTRY_DESCRIPTION?.toLowerCase().includes(searchLower) ||
      q.CATEGORY?.toLowerCase().includes(searchLower)
    );
  }

  if (level !== undefined) {
    quests = quests.filter(q => q.LEVEL === level);
  }

  if (minLevel !== undefined) {
    quests = quests.filter(q => q.LEVEL >= minLevel);
  }

  if (maxLevel !== undefined) {
    quests = quests.filter(q => q.LEVEL <= maxLevel);
  }

  if (tier !== undefined) {
    quests = quests.filter(q => q.TIER === tier);
  }

  if (type) {
    quests = quests.filter(q => q.TYPE?.toLowerCase() === type.toLowerCase());
  }

  if (category) {
    quests = quests.filter(q => q.CATEGORY?.toLowerCase().includes(category.toLowerCase()));
  }

  if (faction) {
    const factionLower = faction.toLowerCase();
    quests = quests.filter(q =>
      q.QUEST_REWARD_FACTION_NAME?.toLowerCase().includes(factionLower) ||
      q.QUEST_PENALTY_FACTION_NAME?.toLowerCase().includes(factionLower)
    );
  }

  if (planet) {
    // Filter by planet - need to check tasks for waypoint locations
    quests = quests.filter(q => {
      const tasks = loadQuestTasks(q.questName);
      return tasks.some(t => t.PLANET_NAME?.toLowerCase() === planet.toLowerCase());
    });
  }

  if (hasRewards) {
    quests = quests.filter(q =>
      q.QUEST_REWARD_BANK_CREDITS > 0 ||
      q.QUEST_REWARD_EXPERIENCE_AMOUNT > 0 ||
      q.QUEST_REWARD_LOOT_NAME ||
      q.QUEST_REWARD_ITEM ||
      q.QUEST_REWARD_WEAPON ||
      q.QUEST_REWARD_ARMOR
    );
  }

  // Sort by level, then by name
  quests.sort((a, b) => {
    if (a.LEVEL !== b.LEVEL) return a.LEVEL - b.LEVEL;
    return a.questName.localeCompare(b.questName);
  });

  const total = quests.length;

  // Apply pagination
  quests = quests.slice(offset, offset + limit);

  return {
    quests,
    total,
    limit,
    offset
  };
}

/**
 * Get quest categories
 */
export function getQuestCategories() {
  const quests = getAllQuests();
  const categories = new Set();

  for (const quest of quests) {
    if (quest.CATEGORY) {
      categories.add(quest.CATEGORY);
    }
  }

  return Array.from(categories).sort();
}

/**
 * Get quest types
 */
export function getQuestTypes() {
  const quests = getAllQuests();
  const types = new Set();

  for (const quest of quests) {
    if (quest.TYPE) {
      types.add(quest.TYPE);
    }
  }

  return Array.from(types).sort();
}

/**
 * Get unique planets from quest tasks
 */
export function getQuestPlanets() {
  const planets = new Set();

  // This is expensive - would need to scan all task files
  // For now, return known SWG planets
  return [
    'corellia', 'dantooine', 'dathomir', 'endor', 'kashyyyk',
    'lok', 'mustafar', 'naboo', 'rori', 'talus', 'tatooine', 'yavin4'
  ];
}

// Cache for resolved reward item names
const rewardNameCache = new Map();

/**
 * Resolve a reward item name from a .iff path or static_item key.
 * Uses the same TPF/string resolution pattern as schematic ingredients.
 *
 * @param {string} itemRef - Item reference (.iff path, static_item key, or plain name)
 * @returns {string} Resolved display name
 */
function resolveRewardItemName(itemRef) {
  if (!itemRef || !itemRef.trim()) return 'Unknown Item';

  const trimmed = itemRef.trim();

  // Check cache
  if (rewardNameCache.has(trimmed)) return rewardNameCache.get(trimmed);

  let resolved = null;

  try {
    const stringsPath = config.schematic?.stringsPath;
    const sharedBasePath = config.schematic?.sharedBasePath;
    const serverBasePath = config.schematic?.serverBasePath;

    if (trimmed.endsWith('.iff') && sharedBasePath) {
      // It's a .iff template path -- resolve via shared TPF
      let templatePath = trimmed.slice(0, -4); // remove .iff
      const lastSlash = templatePath.lastIndexOf('/');
      const dir = lastSlash >= 0 ? templatePath.substring(0, lastSlash) : '';
      const basename = lastSlash >= 0 ? templatePath.substring(lastSlash + 1) : templatePath;
      const sharedFilename = `shared_${basename}.tpf`;
      const sharedRelativePath = dir ? `${dir}/${sharedFilename}` : sharedFilename;

      // Try shared base path
      const sharedFullPath = path.join(sharedBasePath, sharedRelativePath);
      if (fs.existsSync(sharedFullPath)) {
        const refs = parseTPFStringRefs(sharedFullPath);
        if (refs?.objectNameFile && refs?.objectNameKey && stringsPath) {
          resolved = stfResolveStringRef(refs.objectNameFile, refs.objectNameKey, stringsPath);
        }
      }

      // Try server base path if shared didn't work
      if (!resolved && serverBasePath) {
        const serverTpfPath = path.join(serverBasePath, trimmed.slice(0, -4) + '.tpf');
        if (fs.existsSync(serverTpfPath)) {
          const refs = parseTPFStringRefs(serverTpfPath);
          if (refs?.objectNameFile && refs?.objectNameKey && stringsPath) {
            resolved = stfResolveStringRef(refs.objectNameFile, refs.objectNameKey, stringsPath);
          }
        }
      }
    } else if (!trimmed.includes('/') && !trimmed.includes('.') && stringsPath) {
      // Looks like a static_item key (no path separators, no extension)
      const result = stfResolveStringRef('static_item_n', trimmed, stringsPath);
      // If it resolved to the key itself, it wasn't found
      if (result && result !== trimmed) resolved = result;
    }
  } catch (error) {
    logger.debug({ error: error.message, itemRef: trimmed }, 'Failed to resolve reward item name');
  }

  // Fallback: clean up the raw name
  if (!resolved) {
    let name = trimmed;
    if (name.includes('/')) name = name.split('/').pop();
    if (name.endsWith('.iff')) name = name.slice(0, -4);
    resolved = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  rewardNameCache.set(trimmed, resolved);
  return resolved;
}

/**
 * Format quest rewards for display
 */
export function formatQuestRewards(quest) {
  const rewards = [];

  if (quest.QUEST_REWARD_BANK_CREDITS > 0) {
    rewards.push({
      type: 'credits',
      value: quest.QUEST_REWARD_BANK_CREDITS,
      display: `${quest.QUEST_REWARD_BANK_CREDITS.toLocaleString()} credits`
    });
  }

  if (quest.QUEST_REWARD_EXPERIENCE_AMOUNT > 0) {
    rewards.push({
      type: 'experience',
      experienceType: quest.QUEST_REWARD_EXPERIENCE_TYPE,
      value: quest.QUEST_REWARD_EXPERIENCE_AMOUNT,
      display: `${quest.QUEST_REWARD_EXPERIENCE_AMOUNT.toLocaleString()} ${quest.QUEST_REWARD_EXPERIENCE_TYPE || 'XP'}`
    });
  }

  if (quest.QUEST_REWARD_FACTION_NAME && quest.QUEST_REWARD_FACTION_NAME.trim() && quest.QUEST_REWARD_FACTION_AMOUNT > 0) {
    rewards.push({
      type: 'faction',
      faction: quest.QUEST_REWARD_FACTION_NAME,
      value: quest.QUEST_REWARD_FACTION_AMOUNT,
      display: `+${quest.QUEST_REWARD_FACTION_AMOUNT} ${quest.QUEST_REWARD_FACTION_NAME} faction`
    });
  }

  // Loot rewards - only add if name is a non-empty string and not a header
  for (let i = 1; i <= 3; i++) {
    const nameKey = i === 1 ? 'QUEST_REWARD_LOOT_NAME' : `QUEST_REWARD_LOOT_NAME_${i}`;
    const countKey = i === 1 ? 'QUEST_REWARD_LOOT_COUNT' : `QUEST_REWARD_LOOT_COUNT_${i}`;

    const lootName = quest[nameKey];
    const lootCount = quest[countKey] || 1;

    // Skip if empty or looks like a column header
    if (lootName && lootName.trim() && !lootName.toUpperCase().startsWith('QUEST_REWARD')) {
      const resolvedLoot = resolveRewardItemName(lootName);
      rewards.push({
        type: 'loot',
        item: lootName,
        resolvedName: resolvedLoot,
        count: lootCount,
        display: `${lootCount}x ${resolvedLoot}`
      });
    }
  }

  // Exclusive loot rewards - only add if there are valid items
  const exclusiveLoots = [];
  for (let i = 1; i <= 10; i++) {
    const nameKey = i === 1 ? 'QUEST_REWARD_EXCLUSIVE_LOOT_NAME' : `QUEST_REWARD_EXCLUSIVE_LOOT_NAME_${i}`;
    const countKey = i === 1 ? 'QUEST_REWARD_EXCLUSIVE_LOOT_COUNT' : `QUEST_REWARD_EXCLUSIVE_LOOT_COUNT_${i}`;

    const lootName = quest[nameKey];
    const lootCount = quest[countKey] || 1;

    // Skip if empty or looks like a column header
    if (lootName && lootName.trim() && !lootName.toUpperCase().startsWith('QUEST_REWARD')) {
      exclusiveLoots.push({
        item: lootName,
        resolvedName: resolveRewardItemName(lootName),
        count: lootCount
      });
    }
  }

  if (exclusiveLoots.length > 0) {
    rewards.push({
      type: 'exclusive_choice',
      options: exclusiveLoots,
      display: `Choice of ${exclusiveLoots.length} exclusive items`
    });
  }

  // Item reward - skip if looks like column header
  if (quest.QUEST_REWARD_ITEM && quest.QUEST_REWARD_ITEM.trim() && !quest.QUEST_REWARD_ITEM.toUpperCase().startsWith('QUEST_REWARD')) {
    const resolvedItem = resolveRewardItemName(quest.QUEST_REWARD_ITEM);
    rewards.push({
      type: 'item',
      item: quest.QUEST_REWARD_ITEM,
      resolvedName: resolvedItem,
      count: quest.QUEST_REWARD_COUNT || 1,
      display: `${quest.QUEST_REWARD_COUNT || 1}x ${resolvedItem}`
    });
  }

  // Weapon reward - skip if looks like column header
  if (quest.QUEST_REWARD_WEAPON && quest.QUEST_REWARD_WEAPON.trim() && !quest.QUEST_REWARD_WEAPON.toUpperCase().startsWith('QUEST_REWARD')) {
    const resolvedWeapon = resolveRewardItemName(quest.QUEST_REWARD_WEAPON);
    rewards.push({
      type: 'weapon',
      item: quest.QUEST_REWARD_WEAPON,
      resolvedName: resolvedWeapon,
      count: quest.QUEST_REWARD_COUNT_WEAPON || 1,
      speed: quest.QUEST_REWARD_SPEED,
      damage: quest.QUEST_REWARD_DAMAGE,
      efficiency: quest.QUEST_REWARD_EFFICIENCY,
      elementalValue: quest.QUEST_REWARD_ELEMENTAL_VALUE,
      display: `Weapon: ${resolvedWeapon}`
    });
  }

  // Armor reward - skip if looks like column header
  if (quest.QUEST_REWARD_ARMOR && quest.QUEST_REWARD_ARMOR.trim() && !quest.QUEST_REWARD_ARMOR.toUpperCase().startsWith('QUEST_REWARD')) {
    const resolvedArmor = resolveRewardItemName(quest.QUEST_REWARD_ARMOR);
    rewards.push({
      type: 'armor',
      item: quest.QUEST_REWARD_ARMOR,
      resolvedName: resolvedArmor,
      count: quest.QUEST_REWARD_COUNT_ARMOR || 1,
      quality: quest.QUEST_REWARD_QUALITY,
      display: `Armor: ${resolvedArmor}`
    });
  }

  // Badge reward - skip if looks like column header
  if (quest.REWARD_BADGE && quest.REWARD_BADGE.trim() && !quest.REWARD_BADGE.toUpperCase().startsWith('REWARD_')) {
    rewards.push({
      type: 'badge',
      badge: quest.REWARD_BADGE,
      display: `Badge: ${quest.REWARD_BADGE}`
    });
  }

  return rewards;
}

/**
 * Helper to check if a value looks like a column header
 */
function isColumnHeader(val) {
  if (!val || typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  // Column headers are typically ALL_CAPS_WITH_UNDERSCORES
  return /^[A-Z_]+$/.test(trimmed) && trimmed.includes('_');
}

/**
 * Format task for display
 */
export function formatTask(task, index) {
  // Filter out tasks that look like header rows
  const taskName = isColumnHeader(task.TASK_NAME) ? null : task.TASK_NAME;
  const taskType = isColumnHeader(task.taskType) ? 'unknown' : task.taskType;

  return {
    index,
    name: taskName,
    type: taskType,
    script: isColumnHeader(task.ATTACH_SCRIPT) ? null : task.ATTACH_SCRIPT,
    title: parseStringRef(task.JOURNAL_ENTRY_TITLE),
    description: parseStringRef(task.JOURNAL_ENTRY_DESCRIPTION),
    visible: task.IS_VISIBLE,
    prerequisiteTasks: task.PREREQUISITE_TASKS ? task.PREREQUISITE_TASKS.split(',').map(s => s.trim()).filter(s => s && !isColumnHeader(s)) : [],
    tasksOnComplete: task.TASKS_ON_COMPLETE ? task.TASKS_ON_COMPLETE.split(',').map(s => s.trim()).filter(s => s && !isColumnHeader(s)) : [],
    tasksOnFail: task.TASKS_ON_FAIL ? task.TASKS_ON_FAIL.split(',').map(s => s.trim()).filter(s => s && !isColumnHeader(s)) : [],
    grantQuestOnComplete: isColumnHeader(task.GRANT_QUEST_ON_COMPLETE) ? null : task.GRANT_QUEST_ON_COMPLETE,
    grantQuestOnFail: isColumnHeader(task.GRANT_QUEST_ON_FAIL) ? null : task.GRANT_QUEST_ON_FAIL,
    waypoint: task.CREATE_WAYPOINT && task.PLANET_NAME && !isColumnHeader(task.PLANET_NAME) ? {
      planet: task.PLANET_NAME,
      x: task.LOCATION_X,
      y: task.LOCATION_Y,
      z: task.LOCATION_Z,
      name: isColumnHeader(task.WAYPOINT_NAME) ? null : task.WAYPOINT_NAME
    } : null,
    timer: task.TIMER_AMOUNT > 0 ? task.TIMER_AMOUNT : null,
    serverTemplate: isColumnHeader(task.SERVER_TEMPLATE) ? null : task.SERVER_TEMPLATE,
    retrieveMenuText: parseStringRef(task.RETRIEVE_MENU_TEXT),
    startMessage: parseStringRef(task.START_MESSAGE),
    commMessage: parseStringRef(task.COMM_MESSAGE_TEXT),
    npcAppearance: isColumnHeader(task.NPC_APPEARANCE_SERVER_TEMPLATE) ? null : task.NPC_APPEARANCE_SERVER_TEMPLATE,
    itemName: isColumnHeader(task.ITEM_NAME) ? null : task.ITEM_NAME,
    numRequired: task.NUM_REQUIRED,
    dropPercent: task.DROP_PERCENT,
    waves: formatWaves(task),
    subTasks: formatSubTasks(task)
  };
}

/**
 * Format wave event data
 */
function formatWaves(task) {
  const waves = [];

  for (let i = 1; i <= 6; i++) {
    const target = task[`PRIMARY_TARGET_WAVE_${i}`];
    if (target) {
      waves.push({
        wave: i,
        primaryTarget: target,
        utterance: parseStringRef(task[`UTTERANCE_WAVE_${i}`]),
        radius: parseFloat(task[`RADIUS_WAVE_${i}`]) || 0,
        guardsSpawned: task[`GUARDS_SPAWNED_WAVE_${i}`],
        numGuards: parseInt(task[`NUM_GUARDS_WAVE_${i}`]) || 0,
        delay: parseInt(task[`DELAY_WAVE_${i}`]) || 0
      });
    }
  }

  return waves;
}

/**
 * Format sub-task references
 */
function formatSubTasks(task) {
  const subTasks = [];

  for (let i = 1; i <= 6; i++) {
    const questName = task[`TASK_QUEST_NAME_${i}`];
    const taskName = task[`TASK_TASK_NAME_${i}`];
    const displayString = task[`TASK_DISPLAY_STRING_${i}`];

    if (questName && taskName) {
      subTasks.push({
        questName,
        taskName,
        displayString: parseStringRef(displayString)
      });
    }
  }

  return subTasks;
}

export default {
  loadAllQuests,
  loadQuestTasks,
  getAllQuests,
  getQuestByName,
  getQuestWithTasks,
  searchQuests,
  getQuestCategories,
  getQuestTypes,
  getQuestPlanets,
  formatQuestRewards,
  formatTask,
  parseStringRef
};

