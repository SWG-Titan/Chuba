import { createLogger } from '../utils/logger.js';

const logger = createLogger('error-tracker');

/**
 * In-memory error storage
 * Stores recent errors for admin review
 */
const errorStore = {
  schematicErrors: [],
  itemErrors: [],
  resourceErrors: [],
  generalErrors: [],
  maxErrors: 500, // Keep last 500 errors per category
};

/**
 * Add an error to the store
 * @param {string} category - Error category (schematic, item, resource, general)
 * @param {Object} error - Error details
 */
export function trackError(category, error) {
  const errorEntry = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    category,
    message: error.message || String(error),
    file: error.file || error.filePath || null,
    details: error.details || null,
    stack: error.stack || null,
  };

  const storeKey = `${category}Errors`;
  if (!errorStore[storeKey]) {
    errorStore[storeKey] = [];
  }

  errorStore[storeKey].unshift(errorEntry);

  // Trim to max size
  if (errorStore[storeKey].length > errorStore.maxErrors) {
    errorStore[storeKey] = errorStore[storeKey].slice(0, errorStore.maxErrors);
  }

  logger.debug({ category, message: errorEntry.message, file: errorEntry.file }, 'Error tracked');
}

/**
 * Get errors by category
 * @param {string} category - Error category or 'all'
 * @param {number} limit - Max errors to return
 * @returns {Array} Errors
 */
export function getErrors(category = 'all', limit = 100) {
  if (category === 'all') {
    const allErrors = [
      ...errorStore.schematicErrors,
      ...errorStore.itemErrors,
      ...errorStore.resourceErrors,
      ...errorStore.generalErrors,
    ];
    // Sort by timestamp descending
    allErrors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return allErrors.slice(0, limit);
  }

  const storeKey = `${category}Errors`;
  return (errorStore[storeKey] || []).slice(0, limit);
}

/**
 * Get error summary/counts
 * @returns {Object} Error counts by category
 */
export function getErrorSummary() {
  return {
    schematic: errorStore.schematicErrors.length,
    item: errorStore.itemErrors.length,
    resource: errorStore.resourceErrors.length,
    general: errorStore.generalErrors.length,
    total: errorStore.schematicErrors.length +
           errorStore.itemErrors.length +
           errorStore.resourceErrors.length +
           errorStore.generalErrors.length,
  };
}

/**
 * Clear errors by category
 * @param {string} category - Error category or 'all'
 */
export function clearErrors(category = 'all') {
  if (category === 'all') {
    errorStore.schematicErrors = [];
    errorStore.itemErrors = [];
    errorStore.resourceErrors = [];
    errorStore.generalErrors = [];
    logger.info('All errors cleared');
  } else {
    const storeKey = `${category}Errors`;
    if (errorStore[storeKey]) {
      errorStore[storeKey] = [];
      logger.info({ category }, 'Errors cleared');
    }
  }
}

/**
 * Get recent errors for a specific file
 * @param {string} filePath - File path to search for
 * @returns {Array} Errors for that file
 */
export function getErrorsForFile(filePath) {
  const allErrors = [
    ...errorStore.schematicErrors,
    ...errorStore.itemErrors,
    ...errorStore.resourceErrors,
  ];

  return allErrors.filter(e => e.file && e.file.includes(filePath));
}

