import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

const logger = createLogger('local-db');

let db = null;

/**
 * Initialize the local SQLite database
 * @returns {Database.Database}
 */
export function initLocalDb() {
  if (db) return db;

  // Ensure data directory exists
  const dbDir = path.dirname(config.localDb.path);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.localDb.path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  logger.info({ path: config.localDb.path }, 'Local database initialized');
  return db;
}

/**
 * Get the database instance
 * @returns {Database.Database}
 */
export function getLocalDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initLocalDb() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeLocalDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('Local database connection closed');
  }
}

/**
 * Run database migrations
 */
export function runMigrations() {
  const database = getLocalDb();

  logger.info('Running database migrations...');

  // Helper to check if a column exists in a table
  const columnExists = (table, column) => {
    try {
      const result = database.prepare(`PRAGMA table_info(${table})`).all();
      return result.some(col => col.name === column);
    } catch (error) {
      logger.error({ table, column, error: error.message }, 'Error checking column existence');
      return false;
    }
  };

  // Helper to add a column if it doesn't exist
  const addColumnIfNotExists = (table, column, definition) => {
    if (!columnExists(table, column)) {
      try {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        logger.info({ table, column }, 'Added missing column');
      } catch (error) {
        logger.error({ table, column, error: error.message }, 'Failed to add column');
      }
    }
  };

  // Resources table
  database.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id TEXT UNIQUE NOT NULL,
      resource_name TEXT NOT NULL,
      resource_class TEXT NOT NULL,
      planet TEXT,
      stat_oq INTEGER DEFAULT 0,
      stat_cd INTEGER DEFAULT 0,
      stat_dr INTEGER DEFAULT 0,
      stat_fl INTEGER DEFAULT 0,
      stat_hr INTEGER DEFAULT 0,
      stat_ma INTEGER DEFAULT 0,
      stat_pe INTEGER DEFAULT 0,
      stat_sr INTEGER DEFAULT 0,
      stat_ut INTEGER DEFAULT 0,
      stat_cr INTEGER DEFAULT 0,
      stat_er INTEGER DEFAULT 0,
      stat_fingerprint TEXT,
      spawn_time DATETIME,
      despawn_time DATETIME,
      is_active INTEGER DEFAULT 1,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_resources_class ON resources(resource_class);
    CREATE INDEX IF NOT EXISTS idx_resources_active ON resources(is_active);
    CREATE INDEX IF NOT EXISTS idx_resources_class_active ON resources(resource_class, is_active);
    CREATE INDEX IF NOT EXISTS idx_resources_fingerprint ON resources(stat_fingerprint);
  `);

  // Resource classes table (from resource_tree.tab)
  database.exec(`
    CREATE TABLE IF NOT EXISTS resource_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enum_name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      parent_enum TEXT,
      depth INTEGER DEFAULT 0,
      attributes TEXT,
      attribute_ranges TEXT,
      recycled INTEGER DEFAULT 0,
      permanent INTEGER DEFAULT 0,
      container_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_resource_classes_enum ON resource_classes(enum_name);
    CREATE INDEX IF NOT EXISTS idx_resource_classes_parent ON resource_classes(parent_enum);
    CREATE INDEX IF NOT EXISTS idx_resource_classes_depth ON resource_classes(depth);
  `);

  // Resource history table (tracks changes over time)
  database.exec(`
    CREATE TABLE IF NOT EXISTS resource_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (resource_id) REFERENCES resources(resource_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_resource_history_resource ON resource_history(resource_id);
    CREATE INDEX IF NOT EXISTS idx_resource_history_event ON resource_history(event_type);
  `);

  // Best resource snapshots (tracks best-ever for each class/stat combo)
  database.exec(`
    CREATE TABLE IF NOT EXISTS best_resource_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_class TEXT NOT NULL,
      stat_name TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      stat_value INTEGER NOT NULL,
      snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(resource_class, stat_name),
      FOREIGN KEY (resource_id) REFERENCES resources(resource_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_best_snapshots_class ON best_resource_snapshots(resource_class);
  `);

  // Template names table (cache for filename -> display name mappings)
  database.exec(`
    CREATE TABLE IF NOT EXISTS template_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_path TEXT UNIQUE NOT NULL,
      display_name TEXT,
      description TEXT,
      string_file TEXT,
      string_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_template_names_path ON template_names(template_path);
  `);

  // Schematics table
  database.exec(`
    CREATE TABLE IF NOT EXISTS schematics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schematic_id TEXT UNIQUE NOT NULL,
      schematic_name TEXT NOT NULL,
      complexity INTEGER DEFAULT 0,
      category TEXT,
      crafting_station TEXT,
      crafted_template TEXT,
      file_path TEXT,
      file_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_schematics_category ON schematics(category);
    CREATE INDEX IF NOT EXISTS idx_schematics_station ON schematics(crafting_station);
  `);

  // Add missing columns to schematics table (for existing databases)
  addColumnIfNotExists('schematics', 'crafted_template', 'TEXT');
  addColumnIfNotExists('schematics', 'file_path', 'TEXT');
  addColumnIfNotExists('schematics', 'file_hash', 'TEXT');

  // Schematic slots table
  database.exec(`
    CREATE TABLE IF NOT EXISTS schematic_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schematic_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      slot_name TEXT,
      resource_class TEXT,
      quantity INTEGER DEFAULT 1,
      optional INTEGER DEFAULT 0,
      ingredient_type TEXT DEFAULT 'IT_resourceClass',
      UNIQUE(schematic_id, slot_index),
      FOREIGN KEY (schematic_id) REFERENCES schematics(schematic_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_schematic_slots_schematic ON schematic_slots(schematic_id);
    CREATE INDEX IF NOT EXISTS idx_schematic_slots_class ON schematic_slots(resource_class);
  `);

  // Add missing columns to schematic_slots table (for existing databases)
  addColumnIfNotExists('schematic_slots', 'ingredient_type', "TEXT DEFAULT 'IT_resourceClass'");

  // Schematic stat weights table
  database.exec(`
    CREATE TABLE IF NOT EXISTS schematic_stat_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schematic_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      stat_name TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      UNIQUE(schematic_id, slot_index, stat_name),
      FOREIGN KEY (schematic_id) REFERENCES schematics(schematic_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_stat_weights_schematic ON schematic_stat_weights(schematic_id);
  `);

  // Cached match results
  database.exec(`
    CREATE TABLE IF NOT EXISTS cached_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schematic_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      best_active_resource_id TEXT,
      best_active_score REAL,
      best_historical_resource_id TEXT,
      best_historical_score REAL,
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(schematic_id, slot_index),
      FOREIGN KEY (schematic_id) REFERENCES schematics(schematic_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_cached_matches_schematic ON cached_matches(schematic_id);
  `);

  // Items table (master_item data)
  // Columns: name, template_name, type, unique, required_level, required_skill,
  // creation_objvars, charges, tier, value, scripts, version,
  // can_reverse_engineer, string_name, string_detail, comments

  // Check if items table exists first
  const tableExists = (tableName) => {
    const result = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tableName);
    return !!result;
  };

  const itemsTableExists = tableExists('items');

  if (!itemsTableExists) {
    // Create fresh table with new schema
    logger.info('Creating items table with new schema');
    database.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_name TEXT UNIQUE,
        name TEXT,
        type TEXT,
        category TEXT,
        item_type TEXT,
        unique_item INTEGER DEFAULT 0,
        required_level INTEGER DEFAULT 0,
        required_skill TEXT,
        creation_objvars TEXT,
        charges INTEGER DEFAULT 0,
        tier INTEGER DEFAULT 0,
        value INTEGER DEFAULT 0,
        scripts TEXT,
        version INTEGER DEFAULT 0,
        can_reverse_engineer INTEGER DEFAULT 0,
        string_name TEXT,
        string_detail TEXT,
        comments TEXT,
        raw_data TEXT,
        hidden INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
      CREATE INDEX IF NOT EXISTS idx_items_template ON items(template_name);
      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
      CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
      CREATE INDEX IF NOT EXISTS idx_items_tier ON items(tier);
      CREATE INDEX IF NOT EXISTS idx_items_hidden ON items(hidden);
    `);
  } else {
    // Table exists - check schema
    const hasOldTemplateColumn = columnExists('items', 'template');
    const hasNewTemplateColumn = columnExists('items', 'template_name');

    if (hasOldTemplateColumn || !hasNewTemplateColumn) {
      // Old schema or missing template_name - need to recreate table
      logger.info('Migrating items table to new schema (dropping old data)');
      try {
        database.exec('DROP TABLE IF EXISTS items');
        database.exec(`
          CREATE TABLE items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_name TEXT UNIQUE,
            name TEXT,
            type TEXT,
            category TEXT,
            item_type TEXT,
            unique_item INTEGER DEFAULT 0,
            required_level INTEGER DEFAULT 0,
            required_skill TEXT,
            creation_objvars TEXT,
            charges INTEGER DEFAULT 0,
            tier INTEGER DEFAULT 0,
            value INTEGER DEFAULT 0,
            scripts TEXT,
            version INTEGER DEFAULT 0,
            can_reverse_engineer INTEGER DEFAULT 0,
            string_name TEXT,
            string_detail TEXT,
            comments TEXT,
            raw_data TEXT,
            hidden INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
          CREATE INDEX IF NOT EXISTS idx_items_template ON items(template_name);
          CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
          CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
          CREATE INDEX IF NOT EXISTS idx_items_tier ON items(tier);
          CREATE INDEX IF NOT EXISTS idx_items_hidden ON items(hidden);
        `);
        logger.info('Items table recreated with new schema');
      } catch (migrationError) {
        logger.error({ error: migrationError.message }, 'Failed to recreate items table');
        throw migrationError;
      }
    } else {
      // New schema exists - add any missing columns (non-unique columns only)
      addColumnIfNotExists('items', 'name', 'TEXT');
      addColumnIfNotExists('items', 'type', 'TEXT');
      addColumnIfNotExists('items', 'category', 'TEXT');
      addColumnIfNotExists('items', 'item_type', 'TEXT');
      addColumnIfNotExists('items', 'unique_item', 'INTEGER DEFAULT 0');
      addColumnIfNotExists('items', 'required_level', 'INTEGER DEFAULT 0');
      addColumnIfNotExists('items', 'required_skill', 'TEXT');
      addColumnIfNotExists('items', 'creation_objvars', 'TEXT');
      addColumnIfNotExists('items', 'charges', 'INTEGER DEFAULT 0');
      addColumnIfNotExists('items', 'tier', 'INTEGER DEFAULT 0');
      addColumnIfNotExists('items', 'value', 'INTEGER DEFAULT 0');
      addColumnIfNotExists('items', 'scripts', 'TEXT');
      addColumnIfNotExists('items', 'version', 'INTEGER DEFAULT 0');
      addColumnIfNotExists('items', 'can_reverse_engineer', 'INTEGER DEFAULT 0');
      addColumnIfNotExists('items', 'string_name', 'TEXT');
      addColumnIfNotExists('items', 'string_detail', 'TEXT');
      addColumnIfNotExists('items', 'comments', 'TEXT');
      addColumnIfNotExists('items', 'raw_data', 'TEXT');
      addColumnIfNotExists('items', 'hidden', 'INTEGER DEFAULT 0');
    }
  }

  // Item column visibility settings
  database.exec(`
    CREATE TABLE IF NOT EXISTS item_column_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      visible INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );
  `);

  // Waypoints table (local store, synced from Oracle daily)
  database.exec(`
    CREATE TABLE IF NOT EXISTS waypoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waypoint_id TEXT UNIQUE NOT NULL,
      object_id TEXT,
      name TEXT DEFAULT 'Waypoint',
      planet TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      z REAL NOT NULL DEFAULT 0,
      color INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      source TEXT DEFAULT 'local',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_waypoints_planet ON waypoints(planet);
    CREATE INDEX IF NOT EXISTS idx_waypoints_object ON waypoints(object_id);
    CREATE INDEX IF NOT EXISTS idx_waypoints_source ON waypoints(source);
  `);

  // Poll log table
  database.exec(`
    CREATE TABLE IF NOT EXISTS poll_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_type TEXT NOT NULL,
      status TEXT NOT NULL,
      resources_processed INTEGER DEFAULT 0,
      new_resources INTEGER DEFAULT 0,
      updated_resources INTEGER DEFAULT 0,
      despawned_resources INTEGER DEFAULT 0,
      error_message TEXT,
      started_at DATETIME,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Server status history table (for dashboard player-count charting)
  database.exec(`
    CREATE TABLE IF NOT EXISTS server_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME NOT NULL,
      player_count INTEGER,
      highest_player_count INTEGER,
      cluster_name TEXT,
      raw_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_status_history_timestamp ON server_status_history(timestamp);
  `);

  // Objvar key mappings — human-readable labels for object variable names
  database.exec(`
    CREATE TABLE IF NOT EXISTS objvar_key_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      objvar_name TEXT UNIQUE NOT NULL,
      display_label TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_objvar_key_name ON objvar_key_mappings(objvar_name);
  `);

  // LOCATION_SCENE (int) to planet name — for waypoint sync (WAYPOINTS.LOCATION_SCENE is numeric)
  database.exec(`
    CREATE TABLE IF NOT EXISTS location_scene_planet_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_scene INTEGER UNIQUE NOT NULL,
      planet TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_location_scene ON location_scene_planet_mappings(location_scene);
  `);

  logger.info('Database migrations completed');
}

