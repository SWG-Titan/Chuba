import { createLogger } from '../utils/logger.js';

const logger = createLogger('auth-service');

const AUTH_URL = 'https://swgtitan.org/auth.php';
const ADMIN_CHECK_URL = 'https://www.swgtitan.org/admin_check.php';

/**
 * Authenticate user against swgtitan.org
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export async function authenticateUser(username, password) {
  try {
    const formData = new URLSearchParams();
    formData.append('user_name', username);
    formData.append('user_password', password);
    formData.append('secretKey', "330511");

    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const result = await response.text();

    logger.debug({ username, result: result.substring(0, 100) }, 'Auth response');

    // Try to parse as JSON first
    try {
      const jsonResult = JSON.parse(result);
      if (jsonResult.status === 'success' || jsonResult.success === true) {
        logger.info({ username }, 'User authenticated successfully');
        return { success: true };
      }
    } catch (e) {
      // Not JSON, try text-based detection
    }

    // Check if authentication was successful via text
    const isSuccess = result.toLowerCase().includes('success') ||
                      result.includes('1') ||
                      result.toLowerCase().includes('true') ||
                      result.toLowerCase().includes('authenticated');

    if (isSuccess) {
      logger.info({ username }, 'User authenticated successfully');
      return { success: true };
    } else {
      logger.warn({ username, result: result.substring(0, 100) }, 'Authentication failed');
      return { success: false, message: 'Invalid username or password' };
    }
  } catch (error) {
    logger.error({ error: error.message, username }, 'Authentication error');
    return { success: false, message: 'Authentication service unavailable' };
  }
}

/**
 * Check user's admin level using swgtitan.org API
 * Endpoint: https://www.swgtitan.org/admin_check.php?user_name=USERNAME
 * Response: {"status":"success","admin_level":50}
 * @param {string} username - Username
 * @returns {Promise<{success: boolean, adminLevel: number, message?: string}>}
 */
export async function checkAdminLevel(username) {
  try {
    // Use GET request with query parameter
    const url = `${ADMIN_CHECK_URL}?user_name=${encodeURIComponent(username)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const result = await response.text();

    logger.debug({ username, result: result.substring(0, 200) }, 'Admin check response');

    // Parse JSON response: {"status":"success","admin_level":50}
    try {
      const jsonResult = JSON.parse(result);

      if (jsonResult.status === 'success') {
        const adminLevel = parseInt(jsonResult.admin_level, 10) || 0;
        logger.info({ username, adminLevel }, 'Admin level checked');
        return { success: true, adminLevel };
      } else {
        logger.warn({ username, result }, 'Admin check returned non-success status');
        return { success: false, adminLevel: 0, message: jsonResult.message || 'Admin check failed' };
      }
    } catch (parseError) {
      // Fallback: try to extract a number from the response
      const levelMatch = result.match(/admin_level["\s:]+(\d+)/i);
      const adminLevel = levelMatch ? parseInt(levelMatch[1], 10) : 0;

      logger.info({ username, adminLevel, parseError: parseError.message }, 'Admin level parsed with fallback');
      return { success: true, adminLevel };
    }
  } catch (error) {
    logger.error({ error: error.message, username }, 'Admin check error');
    return { success: false, adminLevel: 0, message: 'Admin check service unavailable' };
  }
}

/**
 * Check if user has admin access (level >= 50)
 * @param {string} username - Username
 * @returns {Promise<boolean>}
 */
export async function hasAdminAccess(username) {
  const result = await checkAdminLevel(username);
  return result.success && result.adminLevel >= 50;
}

