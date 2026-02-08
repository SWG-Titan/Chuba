import 'dotenv/config';

export const config = {
  oracle: {
    user: process.env.ORACLE_USER || 'swg',
    password: process.env.ORACLE_PASSWORD || '',
    connectionString: process.env.ORACLE_CONNECTION_STRING || 'localhost:1521/swg',
    poolMin: parseInt(process.env.ORACLE_POOL_MIN, 10) || 2,
    poolMax: parseInt(process.env.ORACLE_POOL_MAX, 10) || 10,
  },
  localDb: {
    path: process.env.LOCAL_DB_PATH || './data/chuba.db',
  },
  schematic: {
    sourcePath: process.env.SCHEMATIC_SOURCE_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.server/compiled/game/object/draft_schematic/',
    stringsPath: process.env.STRINGS_PATH || '/home/swg/swg-main/data/sku.0/sys.client/compiled/game/string/en/',
    datatablePath: process.env.DATATABLE_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.server/compiled/game/datatables/crafting/',
    serverBasePath: process.env.SERVER_BASE_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.server/compiled/game/',
    sharedBasePath: process.env.SHARED_BASE_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.shared/compiled/game/',
  },
  resource: {
    treePath: process.env.RESOURCE_TREE_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.shared/compiled/game/datatables/resource/resource_tree.tab',
    namesPath: process.env.RESOURCE_NAMES_PATH || '/home/swg/swg-main/serverdata/string/en/resource/resource_names.tab',
    imagesPath: process.env.RESOURCE_IMAGES_PATH || './images',
  },
  model: {
    clientDataPath: process.env.CLIENT_DATA_PATH || '/home/swg/swg-main/data/sku.0/sys.client/compiled/game/',
  },
  terrain: {
    terrainPath: process.env.TERRAIN_PATH || '/home/swg/swg-main/serverdata/terrain/',
  },
  item: {
    masterItemPath: process.env.MASTER_ITEM_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.server/compiled/game/datatables/item/master_item/',
    statsPath: process.env.ITEM_STATS_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.server/compiled/game/datatables/item/',
  },
  quest: {
    questListPath: process.env.QUEST_LIST_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.shared/compiled/game/datatables/questlist/',
    questTaskPath: process.env.QUEST_TASK_PATH || '/home/swg/swg-main/dsrc/sku.0/sys.shared/compiled/game/datatables/questtask/',
    questStringsPath: process.env.QUEST_STRINGS_PATH || '/home/swg/swg-main/serverdata/string/en/quest/ground/',
  },
  polling: {
    intervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 5,
  },
  api: {
    port: parseInt(process.env.API_PORT, 10) || 3000,
    host: process.env.API_HOST || '0.0.0.0',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  alerts: {
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    enableDiscord: process.env.ENABLE_DISCORD_ALERTS === 'true',
  },
};

