/**
 * Resource Tree Service
 *
 * Parses and manages the SWG resource hierarchy from resource_tree.tab
 * Provides:
 * - Resource class name translation
 * - Parent/child relationships
 * - Attribute information per resource class
 * - Icon assignment based on class hierarchy
 */
import fs from 'fs';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { getLocalDb } from '../database/local-db.js';
import { STFReader } from '../parsers/stf-reader.js';

const logger = createLogger('resource-tree');

/**
 * Resource class data structure
 * @typedef {Object} ResourceClass
 * @property {number} index - Unique index
 * @property {string} enumName - Internal enum name (e.g., 'milk_domesticated_corellia')
 * @property {string} displayName - Human-readable name from CLASS columns
 * @property {string|null} parent - Parent enum name
 * @property {string[]} ancestors - All ancestors from root to parent
 * @property {string[]} children - Direct children enum names
 * @property {number} depth - Depth in hierarchy (0 = root)
 * @property {string[]} attributes - Applicable attributes (e.g., 'res_decay_resist')
 * @property {Object} attributeRanges - Min/max ranges for each attribute
 * @property {boolean} recycled - Is this a recycled resource type
 * @property {boolean} permanent - Is this a permanent resource type
 * @property {string} containerType - Resource container IFF path
 */

// Cache for resource tree data
let resourceTree = null;
let resourceByEnum = new Map();
let resourceChildren = new Map();
let resourceNames = new Map(); // enum -> display name from resource_tree.tab

// Cache for string names from resource_names.tab
let resourceStringNames = null; // STFReader instance

// Cache for available icons
let availableIcons = new Set();

/**
 * Parse the resource_tree.tab file
 * @param {string} filePath - Path to resource_tree.tab
 * @returns {Object} { resources: Map, childrenMap: Map, namesMap: Map }
 */
export function parseResourceTree(filePath) {
  if (!fs.existsSync(filePath)) {
    logger.error({ filePath }, 'Resource tree file not found');
    return { resources: new Map(), childrenMap: new Map(), namesMap: new Map() };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  // Skip header lines (first two lines: column names and types)
  const dataLines = lines.slice(2).filter(line => line.trim());

  const resources = new Map();
  const childrenMap = new Map();
  const namesMap = new Map();

  for (const line of dataLines) {
    const columns = line.split('\t');
    if (columns.length < 10) continue;

    const index = parseInt(columns[0], 10);
    const enumName = columns[1];

    if (!enumName) continue;

    // CLASS 1-8 columns (indexes 2-9) define the hierarchy
    // The last non-empty CLASS column is the display name
    // Previous CLASS columns are ancestors
    const classColumns = columns.slice(2, 10).map(c => c.trim());

    // Find the depth and display name
    let depth = 0;
    let displayName = '';
    for (let i = 0; i < classColumns.length; i++) {
      if (classColumns[i]) {
        depth = i;
        displayName = classColumns[i];
      }
    }

    // Build ancestors list from CLASS columns
    const ancestors = [];
    for (let i = 0; i < depth; i++) {
      if (classColumns[i]) {
        // Find the enum for this ancestor by matching display name
        // This is a bit tricky - we'll need to do a second pass
        ancestors.push(classColumns[i]);
      }
    }

    // Parse attributes (columns 15-25 in 0-indexed: 16-26)
    const attributeNames = [];
    for (let i = 15; i <= 25; i++) {
      if (columns[i] && columns[i].trim()) {
        attributeNames.push(columns[i].trim());
      }
    }

    // Parse attribute ranges (columns 26-47)
    const attributeRanges = {};
    for (let i = 0; i < attributeNames.length; i++) {
      const minIdx = 26 + (i * 2);
      const maxIdx = 27 + (i * 2);
      if (columns[minIdx] && columns[maxIdx]) {
        attributeRanges[attributeNames[i]] = {
          min: parseInt(columns[minIdx], 10) || 0,
          max: parseInt(columns[maxIdx], 10) || 1000
        };
      }
    }

    const recycled = columns[13] === '1' || columns[13]?.toLowerCase() === 'true';
    const permanent = columns[14] === '1' || columns[14]?.toLowerCase() === 'true';
    const containerType = columns[48] || '';

    const resourceClass = {
      index,
      enumName,
      displayName: displayName || enumName,
      parent: null, // Will be set in second pass
      ancestors: [],
      children: [],
      depth,
      attributes: attributeNames,
      attributeRanges,
      recycled,
      permanent,
      containerType: containerType.trim()
    };

    resources.set(enumName, resourceClass);
    namesMap.set(enumName, displayName || enumName);
  }

  // Second pass: establish parent-child relationships based on depth
  // Resources are ordered in the file, so we can track the last resource at each depth
  const lastAtDepth = new Map();

  for (const line of dataLines) {
    const columns = line.split('\t');
    if (columns.length < 10) continue;

    const enumName = columns[1];
    if (!enumName || !resources.has(enumName)) continue;

    const resource = resources.get(enumName);

    // Find parent (the last resource at depth - 1)
    if (resource.depth > 0) {
      const parentResource = lastAtDepth.get(resource.depth - 1);
      if (parentResource) {
        resource.parent = parentResource.enumName;

        // Build ancestors chain
        resource.ancestors = [...parentResource.ancestors, parentResource.enumName];

        // Add to parent's children
        if (!childrenMap.has(parentResource.enumName)) {
          childrenMap.set(parentResource.enumName, []);
        }
        childrenMap.get(parentResource.enumName).push(enumName);
      }
    }

    lastAtDepth.set(resource.depth, resource);
  }

  // Set children arrays
  for (const [parentEnum, children] of childrenMap) {
    if (resources.has(parentEnum)) {
      resources.get(parentEnum).children = children;
    }
  }

  return { resources, childrenMap, namesMap };
}

/**
 * Load resource string names from resource_names.tab
 * @param {string} [namesPath] - Optional path to resource_names.tab
 */
export function loadResourceStringNames(namesPath) {
  const filePath = namesPath || config.resource?.namesPath;

  if (!filePath || !fs.existsSync(filePath)) {
    logger.warn({ filePath }, 'Resource names file not found');
    return;
  }

  try {
    resourceStringNames = new STFReader();
    resourceStringNames.loadSync(filePath);
    logger.info({ filePath, count: resourceStringNames.size }, 'Loaded resource string names');
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to load resource string names');
  }
}

/**
 * Load available resource icons from images directory
 * @param {string} [imagesPath] - Optional path to images directory
 */
export function loadResourceIcons(imagesPath) {
  const dirPath = imagesPath || config.resource?.imagesPath || './images';

  if (!fs.existsSync(dirPath)) {
    logger.warn({ dirPath }, 'Resource images directory not found');
    return;
  }

  try {
    const files = fs.readdirSync(dirPath);
    availableIcons.clear();

    for (const file of files) {
      if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.gif')) {
        // Store without extension for easier matching
        const iconName = file.replace(/\.(png|jpg|gif)$/, '');
        availableIcons.add(iconName);
      }
    }

    logger.info({ dirPath, count: availableIcons.size }, 'Loaded resource icons');
  } catch (error) {
    logger.error({ error: error.message, dirPath }, 'Failed to load resource icons');
  }
}

/**
 * Get the translated string name for a resource class from resource_names.tab
 * @param {string} enumName - Resource class enum (e.g., 'milk_domesticated_corellia')
 * @returns {string} Translated string name or enumName as fallback
 */
export function getResourceStringName(enumName) {
  if (!resourceStringNames) {
    loadResourceStringNames();
  }

  if (resourceStringNames) {
    const stringName = resourceStringNames.get(enumName);
    if (stringName) {
      return stringName;
    }
  }

  // Fallback to display name from resource tree
  return getResourceClassName(enumName);
}

/**
 * Get the icon filename for a resource class, walking up the hierarchy to find a match
 * @param {string} enumName - Resource class enum (e.g., 'milk_domesticated_corellia')
 * @returns {string} Icon filename (e.g., 'milk.png') or 'default.png' if no match
 */
export function getResourceIcon(enumName) {
  if (!availableIcons.size) {
    loadResourceIcons();
  }

  if (!resourceTree) {
    getResourceTree();
  }

  // Check if there's an exact match for this class
  if (availableIcons.has(enumName)) {
    return `${enumName}.png`;
  }

  // Walk up the hierarchy to find a matching icon
  const resource = resourceTree.get(enumName);
  if (resource) {
    // Check ancestors from most specific to least specific (reverse order)
    for (let i = resource.ancestors.length - 1; i >= 0; i--) {
      const ancestor = resource.ancestors[i];
      if (availableIcons.has(ancestor)) {
        return `${ancestor}.png`;
      }
    }
  }

  // Return default icon if no match found
  return 'default.png';
}

/**
 * Get resource class info with translated name and icon
 * @param {string} enumName - Resource class enum
 * @returns {Object} { enumName, displayName, stringName, icon }
 */
export function getResourceClassInfo(enumName) {
  const resource = getResourceClass(enumName);
  return {
    enumName,
    displayName: resource?.displayName || enumName,
    stringName: getResourceStringName(enumName),
    icon: getResourceIcon(enumName),
    parent: resource?.parent || null,
    depth: resource?.depth || 0,
  };
}

/**
 * Load and cache the resource tree
 * @param {string} [treePath] - Optional path to resource_tree.tab
 */
export function loadResourceTree(treePath) {
  const filePath = treePath || config.resource?.treePath;

  if (!filePath) {
    logger.error('No resource tree path configured');
    resourceTree = new Map();
    resourceByEnum = new Map();
    resourceChildren = new Map();
    resourceNames = new Map();
    return resourceTree;
  }

  logger.info({ filePath }, 'Loading resource tree');

  const result = parseResourceTree(filePath);
  resourceTree = result.resources;
  resourceByEnum = result.resources;
  resourceChildren = result.childrenMap;
  resourceNames = result.namesMap;

  logger.info({ count: resourceTree.size }, 'Resource tree loaded');

  // Also load resource string names and icons
  loadResourceStringNames();
  loadResourceIcons();

  return resourceTree;
}

/**
 * Get resource tree (load if not cached)
 * @returns {Map<string, ResourceClass>}
 */
export function getResourceTree() {
  if (!resourceTree) {
    loadResourceTree();
  }
  return resourceTree;
}

/**
 * Get translated display name for a resource class
 * @param {string} enumName - Resource class enum (e.g., 'milk_domesticated_corellia')
 * @returns {string} Display name or the enum name if not found
 */
export function getResourceClassName(enumName) {
  if (!resourceNames || !resourceNames.size) {
    getResourceTree();
  }
  return resourceNames?.get(enumName) || enumName;
}

/**
 * Get resource class data by enum name
 * @param {string} enumName - Resource class enum
 * @returns {ResourceClass|undefined}
 */
export function getResourceClass(enumName) {
  if (!resourceTree) {
    getResourceTree();
  }
  return resourceTree.get(enumName);
}

/**
 * Get parent resource class
 * @param {string} enumName - Resource class enum
 * @returns {ResourceClass|undefined}
 */
export function getParentResourceClass(enumName) {
  const resource = getResourceClass(enumName);
  if (!resource || !resource.parent) return undefined;
  return getResourceClass(resource.parent);
}

/**
 * Get all ancestor resource classes (from root to parent)
 * @param {string} enumName - Resource class enum
 * @returns {ResourceClass[]}
 */
export function getAncestorResourceClasses(enumName) {
  const resource = getResourceClass(enumName);
  if (!resource) return [];

  return resource.ancestors
    .map(ancestorEnum => getResourceClass(ancestorEnum))
    .filter(Boolean);
}

/**
 * Get direct children resource classes
 * @param {string} enumName - Resource class enum
 * @returns {ResourceClass[]}
 */
export function getChildResourceClasses(enumName) {
  const resource = getResourceClass(enumName);
  if (!resource) return [];

  return resource.children
    .map(childEnum => getResourceClass(childEnum))
    .filter(Boolean);
}

/**
 * Get all descendant resource classes (recursive)
 * @param {string} enumName - Resource class enum
 * @returns {ResourceClass[]}
 */
export function getDescendantResourceClasses(enumName) {
  const resource = getResourceClass(enumName);
  if (!resource) return [];

  const descendants = [];
  const queue = [...resource.children];

  while (queue.length > 0) {
    const childEnum = queue.shift();
    const child = getResourceClass(childEnum);
    if (child) {
      descendants.push(child);
      queue.push(...child.children);
    }
  }

  return descendants;
}

/**
 * Check if a resource class is a subclass of another
 * @param {string} childEnum - Potential child enum
 * @param {string} parentEnum - Potential parent enum
 * @returns {boolean}
 */
export function isSubclassOf(childEnum, parentEnum) {
  const child = getResourceClass(childEnum);
  if (!child) return false;

  return child.ancestors.includes(parentEnum) || child.enumName === parentEnum;
}

/**
 * Get all leaf resource classes (no children)
 * @returns {ResourceClass[]}
 */
export function getLeafResourceClasses() {
  if (!resourceTree) {
    getResourceTree();
  }

  return Array.from(resourceTree.values()).filter(r => r.children.length === 0);
}

/**
 * Get all root resource classes (no parent)
 * @returns {ResourceClass[]}
 */
export function getRootResourceClasses() {
  if (!resourceTree) {
    getResourceTree();
  }

  return Array.from(resourceTree.values()).filter(r => !r.parent);
}

/**
 * Search resource classes by name (partial match)
 * @param {string} query - Search query
 * @returns {ResourceClass[]}
 */
export function searchResourceClasses(query) {
  if (!resourceTree) {
    getResourceTree();
  }

  const lowerQuery = query.toLowerCase();
  return Array.from(resourceTree.values()).filter(r =>
    r.enumName.toLowerCase().includes(lowerQuery) ||
    r.displayName.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get resource tree statistics
 * @returns {Object}
 */
export function getResourceTreeStats() {
  if (!resourceTree) {
    getResourceTree();
  }

  const roots = getRootResourceClasses();
  const leaves = getLeafResourceClasses();

  let maxDepth = 0;
  for (const resource of resourceTree.values()) {
    if (resource.depth > maxDepth) {
      maxDepth = resource.depth;
    }
  }

  return {
    totalClasses: resourceTree.size,
    rootClasses: roots.length,
    leafClasses: leaves.length,
    maxDepth
  };
}

/**
 * Export resource names to tab file format
 * @returns {string} Tab-delimited content
 */
export function exportResourceNamesToTab() {
  if (!resourceTree) {
    getResourceTree();
  }

  const lines = [];
  for (const [enumName, displayName] of resourceNames) {
    lines.push(`${enumName}\t${displayName}`);
  }
  return lines.join('\n');
}

/**
 * Sync resource classes to the local database
 * @returns {Object} Sync statistics
 */
export function syncResourceClassesToDb() {
  if (!resourceTree) {
    getResourceTree();
  }

  const db = getLocalDb();

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO resource_classes 
    (enum_name, display_name, parent_enum, depth, attributes, attribute_ranges, recycled, permanent, container_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let errors = 0;

  const insertMany = db.transaction((resources) => {
    for (const resource of resources) {
      try {
        insertStmt.run(
          resource.enumName,
          resource.displayName,
          resource.parent || null,
          resource.depth,
          JSON.stringify(resource.attributes),
          JSON.stringify(resource.attributeRanges),
          resource.recycled ? 1 : 0,
          resource.permanent ? 1 : 0,
          resource.containerType || null
        );
        inserted++;
      } catch (error) {
        logger.error({ enumName: resource.enumName, error: error.message }, 'Failed to insert resource class');
        errors++;
      }
    }
  });

  insertMany(Array.from(resourceTree.values()));

  logger.info({ inserted, errors }, 'Resource classes synced to database');

  return { inserted, errors };
}

/**
 * Get resource class display name from database (with fallback to memory cache)
 * @param {string} enumName - Resource class enum
 * @returns {string} Display name
 */
export function getResourceClassDisplayName(enumName) {
  // Try memory cache first
  if (resourceNames.has(enumName)) {
    return resourceNames.get(enumName);
  }

  // Try database
  try {
    const db = getLocalDb();
    const row = db.prepare('SELECT display_name FROM resource_classes WHERE enum_name = ?').get(enumName);
    if (row) {
      // Cache it
      resourceNames.set(enumName, row.display_name);
      return row.display_name;
    }
  } catch (error) {
    // Database might not be initialized yet
  }

  // Load full tree if not loaded
  if (!resourceTree) {
    getResourceTree();
  }

  return resourceNames.get(enumName) || enumName;
}

/**
 * Get all resource classes matching a parent class (including the parent itself)
 * Useful for finding all resources that can fulfill a schematic slot
 * @param {string} parentEnum - Parent class enum
 * @returns {string[]} Array of enum names
 */
export function getAllMatchingResourceClasses(parentEnum) {
  const result = [parentEnum];
  const descendants = getDescendantResourceClasses(parentEnum);
  for (const desc of descendants) {
    result.push(desc.enumName);
  }
  return result;
}

