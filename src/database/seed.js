import { initLocalDb, runMigrations, getLocalDb, closeLocalDb } from './local-db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('seed');

/**
 * Sample resource classes
 */
const RESOURCE_CLASSES = [
  'Copper', 'Iron', 'Steel', 'Aluminum', 'Titanium',
  'Polymer', 'Lubricating Oil', 'Reactive Gas', 'Inert Gas',
  'Wooly Hide', 'Leathery Hide', 'Bristly Hide', 'Scaley Hide',
  'Softwood', 'Hardwood', 'Evergreen', 'Deciduous',
  'Crystalline Gemstone', 'Amorphous Gemstone',
  'Radioactive', 'Known Radioactive', 'Unknown Radioactive',
  'Solid Petrochem Fuel', 'Liquid Petrochem Fuel',
  'Vegetable Fungus', 'Herbivore Meat', 'Carnivore Meat'
];

/**
 * Sample planets
 */
const PLANETS = [
  'Tatooine', 'Naboo', 'Corellia', 'Talus', 'Rori',
  'Dantooine', 'Lok', 'Yavin 4', 'Dathomir', 'Endor'
];

/**
 * Generate a random resource name
 */
function generateResourceName(resourceClass) {
  const prefixes = ['Prime', 'Ultra', 'Super', 'Mega', 'Hyper', 'Neo', 'Pure', 'Rich'];
  const suffixes = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega', 'X', 'Z', 'Prime'];

  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const classShort = resourceClass.split(' ')[0].substring(0, 4);
  const num = Math.floor(Math.random() * 999);

  return `${prefix}${classShort}${suffix}${num}`;
}

/**
 * Generate random stats
 */
function generateStats() {
  return {
    OQ: Math.floor(Math.random() * 1000),
    CD: Math.floor(Math.random() * 1000),
    DR: Math.floor(Math.random() * 1000),
    FL: Math.floor(Math.random() * 1000),
    HR: Math.floor(Math.random() * 1000),
    MA: Math.floor(Math.random() * 1000),
    PE: Math.floor(Math.random() * 1000),
    SR: Math.floor(Math.random() * 1000),
    UT: Math.floor(Math.random() * 1000),
    CR: Math.floor(Math.random() * 1000),
    ER: Math.floor(Math.random() * 1000),
  };
}

/**
 * Seed sample resources
 */
function seedResources(count = 500) {
  const db = getLocalDb();

  const stmt = db.prepare(`
    INSERT INTO resources (
      resource_id, resource_name, resource_class, planet,
      stat_oq, stat_cd, stat_dr, stat_fl, stat_hr, stat_ma,
      stat_pe, stat_sr, stat_ut, stat_cr, stat_er,
      stat_fingerprint, spawn_time, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((resources) => {
    for (const r of resources) {
      stmt.run(
        r.resource_id, r.resource_name, r.resource_class, r.planet,
        r.stats.OQ, r.stats.CD, r.stats.DR, r.stats.FL, r.stats.HR, r.stats.MA,
        r.stats.PE, r.stats.SR, r.stats.UT, r.stats.CR, r.stats.ER,
        r.fingerprint, r.spawn_time, r.is_active
      );
    }
  });

  const resources = [];

  for (let i = 0; i < count; i++) {
    const resourceClass = RESOURCE_CLASSES[Math.floor(Math.random() * RESOURCE_CLASSES.length)];
    const stats = generateStats();

    resources.push({
      resource_id: `res_${Date.now()}_${i}`,
      resource_name: generateResourceName(resourceClass),
      resource_class: resourceClass,
      planet: PLANETS[Math.floor(Math.random() * PLANETS.length)],
      stats,
      fingerprint: `fp_${Math.random().toString(36).substring(2, 10)}`,
      spawn_time: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      is_active: Math.random() > 0.3 ? 1 : 0, // 70% active
    });
  }

  insertMany(resources);
  logger.info({ count }, 'Seeded resources');
  return resources.length;
}

/**
 * Seed sample schematics
 */
function seedSchematics() {
  const db = getLocalDb();

  const schematics = [
    {
      schematic_id: 'weapon_blaster_rifle_basic',
      schematic_name: 'Basic Blaster Rifle',
      complexity: 15,
      category: 'weapon',
      crafting_station: 'Weapon Workbench',
      slots: [
        { slot_name: 'Stock', resource_class: 'Hardwood', quantity: 10, weights: { OQ: 0.5, CD: 0.3, DR: 0.2 } },
        { slot_name: 'Barrel', resource_class: 'Steel', quantity: 15, weights: { OQ: 0.4, CD: 0.4, DR: 0.2 } },
        { slot_name: 'Power Core', resource_class: 'Radioactive', quantity: 5, weights: { OQ: 0.6, PE: 0.4 } },
      ],
    },
    {
      schematic_id: 'armor_composite_chest',
      schematic_name: 'Composite Armor Chest Plate',
      complexity: 20,
      category: 'armor',
      crafting_station: 'Armor Workbench',
      slots: [
        { slot_name: 'Outer Shell', resource_class: 'Titanium', quantity: 20, weights: { DR: 0.5, OQ: 0.3, CD: 0.2 } },
        { slot_name: 'Padding', resource_class: 'Wooly Hide', quantity: 15, weights: { OQ: 0.4, DR: 0.3, FL: 0.3 } },
        { slot_name: 'Bindings', resource_class: 'Polymer', quantity: 8, weights: { OQ: 0.5, UT: 0.5 } },
      ],
    },
    {
      schematic_id: 'droid_r2_unit',
      schematic_name: 'R2 Astromech Droid',
      complexity: 25,
      category: 'droid',
      crafting_station: 'Droid Engineer Station',
      slots: [
        { slot_name: 'Chassis', resource_class: 'Aluminum', quantity: 25, weights: { OQ: 0.3, MA: 0.3, DR: 0.4 } },
        { slot_name: 'Processor', resource_class: 'Copper', quantity: 10, weights: { CD: 0.5, OQ: 0.3, PE: 0.2 } },
        { slot_name: 'Power Supply', resource_class: 'Solid Petrochem Fuel', quantity: 8, weights: { PE: 0.6, OQ: 0.4 } },
        { slot_name: 'Lubricant', resource_class: 'Lubricating Oil', quantity: 5, weights: { OQ: 0.5, FL: 0.5 } },
      ],
    },
    {
      schematic_id: 'furniture_table_wood',
      schematic_name: 'Wooden Dining Table',
      complexity: 8,
      category: 'furniture',
      crafting_station: 'Generic Crafting Tool',
      slots: [
        { slot_name: 'Table Top', resource_class: 'Hardwood', quantity: 30, weights: { OQ: 0.6, CD: 0.2, DR: 0.2 } },
        { slot_name: 'Legs', resource_class: 'Softwood', quantity: 20, weights: { OQ: 0.4, DR: 0.4, MA: 0.2 } },
      ],
    },
    {
      schematic_id: 'food_ration_basic',
      schematic_name: 'Basic Ration Pack',
      complexity: 5,
      category: 'food',
      crafting_station: 'Food/Chemical Crafting Station',
      slots: [
        { slot_name: 'Protein', resource_class: 'Herbivore Meat', quantity: 10, weights: { OQ: 0.5, FL: 0.3, PE: 0.2 } },
        { slot_name: 'Filler', resource_class: 'Vegetable Fungus', quantity: 15, weights: { OQ: 0.6, FL: 0.4 } },
      ],
    },
  ];

  const schematicStmt = db.prepare(`
    INSERT INTO schematics (schematic_id, schematic_name, complexity, category, crafting_station, file_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const slotStmt = db.prepare(`
    INSERT INTO schematic_slots (schematic_id, slot_index, slot_name, resource_class, quantity, optional)
    VALUES (?, ?, ?, ?, ?, 0)
  `);

  const weightStmt = db.prepare(`
    INSERT INTO schematic_stat_weights (schematic_id, slot_index, stat_name, weight)
    VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const schematic of schematics) {
      schematicStmt.run(
        schematic.schematic_id,
        schematic.schematic_name,
        schematic.complexity,
        schematic.category,
        schematic.crafting_station,
        `seed_${schematic.schematic_id}`
      );

      schematic.slots.forEach((slot, index) => {
        slotStmt.run(
          schematic.schematic_id,
          index,
          slot.slot_name,
          slot.resource_class,
          slot.quantity
        );

        for (const [stat, weight] of Object.entries(slot.weights)) {
          weightStmt.run(schematic.schematic_id, index, stat, weight);
        }
      });
    }
  });

  insertAll();
  logger.info({ count: schematics.length }, 'Seeded schematics');
  return schematics.length;
}

/**
 * Main seed function
 */
async function main() {
  try {
    logger.info('Starting database seed...');

    initLocalDb();
    runMigrations();

    // Clear existing data
    const db = getLocalDb();
    db.exec('DELETE FROM schematic_stat_weights');
    db.exec('DELETE FROM schematic_slots');
    db.exec('DELETE FROM schematics');
    db.exec('DELETE FROM resource_history');
    db.exec('DELETE FROM best_resource_snapshots');
    db.exec('DELETE FROM resources');
    db.exec('DELETE FROM cached_matches');
    db.exec('DELETE FROM poll_log');

    // Seed data
    const resourceCount = seedResources(500);
    const schematicCount = seedSchematics();

    logger.info({ resources: resourceCount, schematics: schematicCount }, 'Seed completed');

    closeLocalDb();
    process.exit(0);
  } catch (error) {
    logger.error({ error: error.message }, 'Seed failed');
    process.exit(1);
  }
}

main();

