import express from 'express';
import { authenticateUser, checkAdminLevel } from '../services/auth-service.js';
import { createSession, getSession, destroySession, SESSION_COOKIE_NAME } from '../services/session-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('auth-api');
const router = express.Router();

/**
 * POST /api/auth/login
 * Authenticate user and create session
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required',
      });
    }

    // Authenticate against swgtitan.org
    const authResult = await authenticateUser(username, password);

    if (!authResult.success) {
      return res.status(401).json({
        success: false,
        error: authResult.message || 'Authentication failed',
      });
    }

    // Check admin level
    const adminResult = await checkAdminLevel(username);
    const adminLevel = adminResult.adminLevel || 0;

    // Create session
    const sessionId = createSession(username, adminLevel);

    // Set session cookie
    res.cookie(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    logger.info({ username, adminLevel }, 'User logged in');

    res.json({
      success: true,
      data: {
        username,
        adminLevel,
        isAdmin: adminLevel >= 50,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Login error');
    res.status(500).json({
      success: false,
      error: 'Login failed',
    });
  }
});

/**
 * POST /api/auth/logout
 * Destroy session and clear cookie
 */
router.post('/logout', (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];

  if (sessionId) {
    destroySession(sessionId);
  }

  res.clearCookie(SESSION_COOKIE_NAME);

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * GET /api/auth/session
 * Get current session info
 */
router.get('/session', (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  const session = getSession(sessionId);

  if (!session) {
    return res.json({
      success: true,
      data: {
        authenticated: false,
      },
    });
  }

  res.json({
    success: true,
    data: {
      authenticated: true,
      username: session.username,
      adminLevel: session.adminLevel,
      isAdmin: session.isAdmin,
    },
  });
});

/**
 * GET /api/auth/check-admin
 * Check if current user has admin access
 */
router.get('/check-admin', (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  const session = getSession(sessionId);

  res.json({
    success: true,
    data: {
      isAdmin: session?.isAdmin || false,
      adminLevel: session?.adminLevel || 0,
    },
  });
});

export default router;

