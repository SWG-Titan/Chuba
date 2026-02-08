import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('session');

// In-memory session store (use Redis for production)
const sessions = new Map();

// Session configuration
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_COOKIE_NAME = 'chuba_session';

/**
 * Generate a secure session ID
 * @returns {string}
 */
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session for a user
 * @param {string} username - Username
 * @param {number} adminLevel - User's admin level
 * @returns {string} Session ID
 */
export function createSession(username, adminLevel = 0) {
  const sessionId = generateSessionId();
  const session = {
    username,
    adminLevel,
    isAdmin: adminLevel >= 50,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION,
  };

  sessions.set(sessionId, session);
  logger.info({ username, adminLevel, sessionId: sessionId.substring(0, 8) }, 'Session created');

  return sessionId;
}

/**
 * Get session by ID
 * @param {string} sessionId - Session ID
 * @returns {Object|null} Session data or null
 */
export function getSession(sessionId) {
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  // Check if session has expired
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    logger.debug({ sessionId: sessionId.substring(0, 8) }, 'Session expired');
    return null;
  }

  return session;
}

/**
 * Destroy a session
 * @param {string} sessionId - Session ID
 */
export function destroySession(sessionId) {
  if (sessionId) {
    sessions.delete(sessionId);
    logger.debug({ sessionId: sessionId.substring(0, 8) }, 'Session destroyed');
  }
}

/**
 * Update session's admin level
 * @param {string} sessionId - Session ID
 * @param {number} adminLevel - New admin level
 */
export function updateSessionAdminLevel(sessionId, adminLevel) {
  const session = sessions.get(sessionId);
  if (session) {
    session.adminLevel = adminLevel;
    session.isAdmin = adminLevel >= 50;
    logger.info({ sessionId: sessionId.substring(0, 8), adminLevel }, 'Session admin level updated');
  }
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug({ cleaned }, 'Expired sessions cleaned up');
  }
}

/**
 * Get session statistics
 * @returns {Object}
 */
export function getSessionStats() {
  return {
    activeSessions: sessions.size,
  };
}

// Cleanup expired sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// Export cookie name for use in middleware
export { SESSION_COOKIE_NAME };

