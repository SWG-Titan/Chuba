/**
 * Quest API
 * Endpoints for quest data - wiki-style quest information
 */
import express from 'express';
import { createLogger } from '../utils/logger.js';
import {
  loadAllQuests,
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
} from '../services/quest-service.js';

const logger = createLogger('quest-api');
const router = express.Router();

/**
 * GET /api/quests
 * Get all quests with optional filtering
 */
router.get('/', (req, res) => {
  try {
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
    } = req.query;

    const result = searchQuests({
      search,
      level: level ? parseInt(level) : undefined,
      minLevel: minLevel ? parseInt(minLevel) : undefined,
      maxLevel: maxLevel ? parseInt(maxLevel) : undefined,
      tier: tier ? parseInt(tier) : undefined,
      type,
      category,
      faction,
      planet,
      hasRewards: hasRewards === 'true',
      limit: Math.min(parseInt(limit) || 100, 500),
      offset: parseInt(offset) || 0
    });

    // Helper to check if a value looks like a column header (all caps with underscores)
    const isColumnHeader = (val) => {
      if (!val || typeof val !== 'string') return true;
      const trimmed = val.trim();
      if (!trimmed) return true;
      // Column headers are typically ALL_CAPS_WITH_UNDERSCORES
      return /^[A-Z_]+$/.test(trimmed) && trimmed.includes('_');
    };

    // Format quests for response
    const formattedQuests = result.quests.map(quest => ({
      questId: quest.questId,
      questName: quest.questName,
      level: quest.LEVEL,
      tier: quest.TIER,
      type: isColumnHeader(quest.TYPE) ? null : quest.TYPE,
      visible: quest.VISIBLE,
      allowRepeats: quest.ALLOW_REPEATS,
      title: parseStringRef(quest.JOURNAL_ENTRY_TITLE),
      description: parseStringRef(quest.JOURNAL_ENTRY_DESCRIPTION),
      category: parseStringRef(quest.CATEGORY),
      completionSummary: parseStringRef(quest.JOURNAL_ENTRY_COMPLETION_SUMMARY),
      prerequisiteQuests: quest.PREREQUISITE_QUESTS
        ? quest.PREREQUISITE_QUESTS.split(',').map(s => s.trim()).filter(s => s && !isColumnHeader(s))
        : [],
      exclusionQuests: quest.EXCLUSION_QUESTS
        ? quest.EXCLUSION_QUESTS.split(',').map(s => s.trim()).filter(s => s && !isColumnHeader(s))
        : [],
      rewards: formatQuestRewards(quest),
      grantGcw: quest.GRANT_GCW
    }));

    res.json({
      success: true,
      count: formattedQuests.length,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      data: formattedQuests
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get quests');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/quests/categories
 * Get all quest categories
 */
router.get('/categories', (req, res) => {
  try {
    const categories = getQuestCategories();

    res.json({
      success: true,
      count: categories.length,
      data: categories.map(cat => parseStringRef(cat))
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get quest categories');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/quests/types
 * Get all quest types
 */
router.get('/types', (req, res) => {
  try {
    const types = getQuestTypes();

    res.json({
      success: true,
      count: types.length,
      data: types
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get quest types');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/quests/planets
 * Get all planets with quests
 */
router.get('/planets', (req, res) => {
  try {
    const planets = getQuestPlanets();

    res.json({
      success: true,
      count: planets.length,
      data: planets
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get quest planets');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/quests/reload
 * Reload quest data from files
 */
router.get('/reload', (req, res) => {
  try {
    loadAllQuests();
    const count = getAllQuests().length;

    logger.info({ count }, 'Reloaded quests');

    res.json({
      success: true,
      message: `Reloaded ${count} quests`
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to reload quests');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/quests/:questName
 * Get a specific quest with full details including tasks
 */
router.get('/:questName', (req, res) => {
  try {
    const { questName } = req.params;

    const questWithTasks = getQuestWithTasks(questName);

    if (!questWithTasks) {
      return res.status(404).json({
        success: false,
        error: 'Quest not found'
      });
    }

    // Helper to filter out column headers that were mistakenly treated as data
    const isValidValue = (val) => {
      if (!val || typeof val !== 'string') return false;
      const trimmed = val.trim();
      if (!trimmed) return false;
      // Filter out common column header patterns
      if (/^[A-Z_]+$/.test(trimmed) && trimmed.includes('_')) return false;
      return true;
    };

    // Parse and filter prerequisite quests
    const prerequisiteQuests = questWithTasks.PREREQUISITE_QUESTS
      ? questWithTasks.PREREQUISITE_QUESTS.split(',').map(s => s.trim()).filter(s => isValidValue(s) && !s.toUpperCase().includes('PREREQUISITE'))
      : [];

    // Parse and filter exclusion quests
    const exclusionQuests = questWithTasks.EXCLUSION_QUESTS
      ? questWithTasks.EXCLUSION_QUESTS.split(',').map(s => s.trim()).filter(s => isValidValue(s) && !s.toUpperCase().includes('EXCLUSION'))
      : [];

    // Format penalties, filtering out column header values
    const penalties = [];
    if (questWithTasks.QUEST_PENALTY_FACTION_NAME &&
        questWithTasks.QUEST_PENALTY_FACTION_NAME.trim() &&
        !questWithTasks.QUEST_PENALTY_FACTION_NAME.toUpperCase().includes('PENALTY') &&
        questWithTasks.QUEST_PENALTY_FACTION_AMOUNT > 0) {
      penalties.push({
        type: 'faction',
        faction: questWithTasks.QUEST_PENALTY_FACTION_NAME,
        amount: questWithTasks.QUEST_PENALTY_FACTION_AMOUNT,
        display: `-${questWithTasks.QUEST_PENALTY_FACTION_AMOUNT} ${questWithTasks.QUEST_PENALTY_FACTION_NAME} faction`
      });
    }

    // Format full quest data
    const formattedQuest = {
      questId: questWithTasks.questId,
      questName: questWithTasks.questName,
      level: questWithTasks.LEVEL,
      tier: questWithTasks.TIER,
      type: questWithTasks.TYPE && !questWithTasks.TYPE.toUpperCase().includes('TYPE') ? questWithTasks.TYPE : null,
      visible: questWithTasks.VISIBLE,
      allowRepeats: questWithTasks.ALLOW_REPEATS,
      completeWhenTasksComplete: questWithTasks.COMPLETE_WHEN_TASKS_COMPLETE,
      title: parseStringRef(questWithTasks.JOURNAL_ENTRY_TITLE),
      description: parseStringRef(questWithTasks.JOURNAL_ENTRY_DESCRIPTION),
      category: parseStringRef(questWithTasks.CATEGORY),
      completionSummary: parseStringRef(questWithTasks.JOURNAL_ENTRY_COMPLETION_SUMMARY),
      prerequisiteQuests,
      exclusionQuests,
      conditionalGrantQuest: questWithTasks.CONDITIONAL_QUEST_GRANT_QUEST,
      conditionalGrantQuestRequirements: questWithTasks.CONDITIONAL_QUEST_GRANT_QUEST_LIST_OF_COMPLETED_QUESTS,
      rewards: formatQuestRewards(questWithTasks),
      penalties,
      grantGcw: questWithTasks.GRANT_GCW,
      target: questWithTasks.TARGET,
      parameter: questWithTasks.PARAMETER,
      tasks: questWithTasks.tasks.map((task, index) => formatTask(task, index)),
      taskCount: questWithTasks.tasks.length
    };

    res.json({
      success: true,
      data: formattedQuest
    });
  } catch (error) {
    logger.error({ error: error.message, questName: req.params.questName }, 'Failed to get quest');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

