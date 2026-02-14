import express from 'express';
import {
  searchPlayers,
  getPlayerDetails,
  getPlayerInventory,
  buildInventoryTree,
  getPlayerObjvars,
  getPlayersByPlanet,
  getCharactersByStationId,
  renameCharacter,
  moveCharacter,
  changeCharacterRace,
  lockAccount,
} from '../services/player-service.js';
import { getStationId } from '../services/auth-service.js';
import { getSession, SESSION_COOKIE_NAME } from '../services/session-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('players-api');
const router = express.Router();

/** Helper to get any valid session */
function getReqSession(req) {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  return getSession(sessionId) || null;
}

/** Helper to check admin from session */
function getAdminSession(req) {
  const session = getReqSession(req);
  return session?.isAdmin ? session : null;
}

/**
 * GET /api/players/search?q=name
 * Search players by name
 */
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.trim().length < 2) {
      return res.json({ success: true, count: 0, data: [] });
    }
    const players = await searchPlayers(query);
    res.json({ success: true, count: players.length, data: players });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/players/my-characters
 * List current user's characters by station_id (from swgtitan.org station-parse). Requires login.
 */
router.get('/my-characters', async (req, res) => {
  const session = getReqSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Login required' });
  }

  try {
    const stationId = await getStationId(session.username);
    if (stationId == null) {
      return res.status(404).json({ success: false, error: 'Station ID not found for user' });
    }
    const characters = await getCharactersByStationId(stationId);
    res.json({ success: true, count: characters.length, data: characters });
  } catch (error) {
    logger.error({ error: error.message, username: session?.username }, 'My characters failed');
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/players/by-planet?planet=tatooine
 * Get all players on a specific planet (admin only, for map overlay)
 */
router.get('/by-planet', async (req, res) => {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const planet = req.query.planet;
  if (!planet) {
    return res.status(400).json({ success: false, error: 'planet query parameter is required' });
  }

  try {
    const players = await getPlayersByPlanet(planet);
    res.json({ success: true, count: players.length, data: players });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/players/:id
 * Get player details
 */
router.get('/:id', async (req, res) => {
  try {
    const player = await getPlayerDetails(req.params.id);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }
    res.json({ success: true, data: player });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/players/:id/inventory
 * Get recursive inventory tree for a player
 */
router.get('/:id/inventory', async (req, res) => {
  try {
    const items = await getPlayerInventory(req.params.id);
    const tree = buildInventoryTree(items, req.params.id);
    res.json({
      success: true,
      totalItems: items.length,
      data: tree,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/players/:id/objvars
 * Get object variables for a player character (admin only)
 */
router.get('/:id/objvars', async (req, res) => {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  try {
    const objvars = await getPlayerObjvars(req.params.id);
    res.json({ success: true, count: objvars.length, data: objvars });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Admin Character Actions (require admin) =====

/**
 * POST /api/players/:id/rename
 * Rename a character
 */
router.post('/:id/rename', async (req, res) => {
  const session = getAdminSession(req);
  if (!session) return res.status(403).json({ success: false, error: 'Admin access required' });

  const { newName } = req.body;
  if (!newName || !newName.trim()) {
    return res.status(400).json({ success: false, error: 'newName is required' });
  }

  try {
    logger.warn({ admin: session.username, charId: req.params.id, newName }, 'Admin renaming character');
    await renameCharacter(req.params.id, newName.trim());
    res.json({ success: true, message: `Character renamed to ${newName.trim()}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/players/:id/move
 * Move a character to a new location
 */
router.post('/:id/move', async (req, res) => {
  const session = getAdminSession(req);
  if (!session) return res.status(403).json({ success: false, error: 'Admin access required' });

  const { planet, x, y, z } = req.body;
  if (!planet) return res.status(400).json({ success: false, error: 'planet is required' });

  try {
    logger.warn({ admin: session.username, charId: req.params.id, planet, x, y, z }, 'Admin moving character');
    await moveCharacter(req.params.id, planet, Number(x) || 0, Number(y) || 0, Number(z) || 0);
    res.json({ success: true, message: `Character moved to ${planet} (${x}, ${y}, ${z})` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/players/:id/race
 * Change a character's race/template
 */
router.post('/:id/race', async (req, res) => {
  const session = getAdminSession(req);
  if (!session) return res.status(403).json({ success: false, error: 'Admin access required' });

  const { templateId } = req.body;
  if (templateId == null) return res.status(400).json({ success: false, error: 'templateId is required' });

  try {
    logger.warn({ admin: session.username, charId: req.params.id, templateId }, 'Admin changing character race');
    await changeCharacterRace(req.params.id, Number(templateId));
    res.json({ success: true, message: `Character race changed to template ${templateId}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/players/:id/lock
 * Lock or unlock the account associated with this character
 */
router.post('/:id/lock', async (req, res) => {
  const session = getAdminSession(req);
  if (!session) return res.status(403).json({ success: false, error: 'Admin access required' });

  const { locked, stationId } = req.body;
  if (locked == null || !stationId) {
    return res.status(400).json({ success: false, error: 'locked (bool) and stationId are required' });
  }

  try {
    logger.warn({ admin: session.username, stationId, locked }, 'Admin changing account lock');
    await lockAccount(stationId, !!locked);
    res.json({ success: true, message: `Account ${locked ? 'locked' : 'unlocked'}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
