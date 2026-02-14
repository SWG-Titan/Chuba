# Chuba – Titan Tracker

A Node.js web application for **SWG (Star Wars Galaxies)** server emulators such as SWG Titan. It provides resource tracking, schematic browsing, item lookup, quest journal, terrain mapping, and player/city administration.

---

## Features

| Feature | Description |
|---------|-------------|
| **Resources** | Live and historical resource data from Oracle; search and filter by class and stats |
| **Schematic Datapad** | Browse draft schematics, view best resources per slot, preview 3D models |
| **Armory** | Item database with search by name, template, category, tier, and stats |
| **Quest Journal** | Quest list, tasks, and rewards from datatables and STF strings |
| **Cartographer** | Interactive map with waypoints and optional player overlay |
| **Player Lookup** | Search characters, view details and inventory; admin actions (rename, move, lock) |
| **Cities** | Browse and filter cities from the game database |
| **Admin Panel** | Health checks, manual sync, error logs, cache and DB management |

---

## Prerequisites

- **Node.js** 18 or higher (20 LTS recommended)
- **Oracle Instant Client** (optional – for live resources, players, cities, status; omit to run offline)
- **Game data paths** (dsrc / data / serverdata) for schematics, items, quests, terrain, and resource names

---

## Setup

### 1. Install

```bash
git clone <repository-url>
cd Chuba
npm install
```

### 2. Environment

Copy the example env and edit with your paths and credentials:

```bash
cp .env.example .env
```

Configure `.env` – see [File layout by feature](#file-layout-by-feature) for what each path must contain.

| Variable | Purpose |
|----------|---------|
| `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECTION_STRING` | Read-only Oracle connection to the SWG game DB. Omit to run offline. |
| `ORACLE_POOL_MIN`, `ORACLE_POOL_MAX` | Connection pool limits (default: 2, 10) |
| `LOCAL_DB_PATH` | SQLite file (default: `./data/chuba.db`) |
| `SCHEMATIC_SOURCE_PATH`, `STRINGS_PATH`, `DATATABLE_PATH`, `SERVER_BASE_PATH`, `SHARED_BASE_PATH` | Paths for schematic and crafting data |
| `MASTER_ITEM_PATH`, `ITEM_STATS_PATH` | Paths for item/armory data |
| `CLIENT_DATA_PATH`, `SHARED_BASE_PATH` | Paths for 3D model lookups |
| `RESOURCE_TREE_PATH`, `RESOURCE_NAMES_PATH` | Resource tree and names |
| `QUEST_LIST_PATH`, `QUEST_TASK_PATH`, `QUEST_STRINGS_PATH` | Quest datatables and strings |
| `RESOURCE_IMAGES_PATH` | Optional; directory for resource class icons (default: `./images`) |
| `API_PORT`, `API_HOST` | Server port and bind address (default: `3000`, `0.0.0.0`) |
| `POLL_INTERVAL_MINUTES` | Oracle poll interval for resources (default: `5`) |
| `LOG_LEVEL` | Logging level (e.g. `info`, `debug`) |
| `DISCORD_WEBHOOK_URL`, `ENABLE_DISCORD_ALERTS` | Optional Discord alerts on start/failure |

Paths may use Windows (`D:/path/to/`) or Linux (`/home/user/path/`) separators.

### 3. Database

Create SQLite schema and run migrations:

```bash
npm run migrate
```

Optional – seed test data:

```bash
npm run seed
```

### 4. Run

```bash
npm start
```

Development with auto-restart:

```bash
npm run dev
```

The app serves the UI at **http://localhost:3000** (or your configured host/port).

---

## File layout by feature

Each feature expects specific SWG game files. Paths vary by server layout (Titan, SRC, custom). Typical roots: `dsrc/` and `data/` (or `serverdata/`) for compiled/string data.

**Strings:** Where the app expects `.tab` string files (e.g. under `STRINGS_PATH`, `RESOURCE_NAMES_PATH`, `QUEST_STRINGS_PATH`), game `.stf` assets must be dumped to `.tab` first. Use **Aconite's LocalizationToolCon_d.exe** to export STF to tab format.

### Schematics (Schematic Datapad, 3D preview)

| Env variable | Points to | Required files |
|--------------|-----------|----------------|
| `SCHEMATIC_SOURCE_PATH` | Directory of draft schematic `.tpf` files | Recursively scanned for `*.tpf` |
| `STRINGS_PATH` | Client string files (STF) | `*.stf` for object names, descriptions |
| `DATATABLE_PATH` | Crafting datatables | `weapon_schematics.tab` (optional) |
| `SERVER_BASE_PATH` | Server compiled game root | `object/` tree for resolving `.tpf` templates |
| `SHARED_BASE_PATH` | Shared compiled game root | `object/` for `shared_*.tpf` and string refs |

**Example (Windows):**
```
D:/titan/dsrc/sku.0/sys.server/compiled/game/object/draft_schematic/   ← SCHEMATIC_SOURCE_PATH
D:/titan/data/sku.0/sys.client/compiled/game/string/en/                 ← STRINGS_PATH
D:/titan/dsrc/sku.0/sys.server/compiled/game/datatables/crafting/       ← DATATABLE_PATH
D:/titan/dsrc/sku.0/sys.server/compiled/game/                           ← SERVER_BASE_PATH
D:/titan/dsrc/sku.0/sys.shared/compiled/game/                           ← SHARED_BASE_PATH
```

### Items (Armory)

| Env variable | Points to | Required files |
|--------------|-----------|----------------|
| `MASTER_ITEM_PATH` | Directory of master item `.tab` files | One `.tab` per category (e.g. `armor.tab`, `weapon.tab`) |
| `ITEM_STATS_PATH` | Directory of item stat files | `item_stats.tab`, `armor_stats.tab`, `weapon_stats.tab` |

**Example:**
```
.../datatables/item/master_item/   ← MASTER_ITEM_PATH (contains armor.tab, weapon.tab, etc.)
.../datatables/item/               ← ITEM_STATS_PATH (contains item_stats.tab, armor_stats.tab, weapon_stats.tab)
```

### Resources (Resource tracker)

| Env variable | Points to | Required files |
|--------------|-----------|----------------|
| `RESOURCE_TREE_PATH` | Single file | `resource_tree.tab` – class hierarchy and stats |
| `RESOURCE_NAMES_PATH` | Single file | `resource_names.tab` – display names for classes |
| `RESOURCE_IMAGES_PATH` | Optional directory | Icons for resource classes (e.g. `./images`) |

**Example:**
```
.../datatables/resource/resource_tree.tab   ← RESOURCE_TREE_PATH
.../string/en/resource/resource_names.tab  ← RESOURCE_NAMES_PATH (client or serverdata)
```

### Quests (Quest Journal)

| Env variable | Points to | Required files |
|--------------|-----------|----------------|
| `QUEST_LIST_PATH` | Quest list directory | `quest/*.tab` – one `.tab` per quest |
| `QUEST_TASK_PATH` | Quest task directory | `quest/*.tab` – task data (matches quest names) |
| `QUEST_STRINGS_PATH` | Quest string directory | `*.tab` – STF strings (e.g. `axkva_min_intro.tab`) |

**Example:**
```
.../datatables/questlist/quest/      ← QUEST_LIST_PATH (contains questname.tab)
.../datatables/questtask/quest/      ← QUEST_TASK_PATH (contains questname.tab)
.../string/en/quest/ground/          ← QUEST_STRINGS_PATH (contains questname.tab)
```

### 3D models (Schematic preview)

| Env variable | Points to | Purpose |
|--------------|-----------|---------|
| `CLIENT_DATA_PATH` | Client compiled game root | Textures, meshes, appearance files |
| `SHARED_BASE_PATH` | Shared compiled game root | Object templates and string refs |

The model service resolves paths relative to these bases (e.g. `object/...`, `appearance/...`, `texture/...`).

### Terrain (Cartographer)

The Cartographer map works with **waypoints** and a hardcoded planet list; terrain files are optional for future use.

| Env variable | Points to | Purpose |
|--------------|-----------|---------|
| `TERRAIN_PATH` | Terrain data directory | `.trn`, `.hmap`, `.btrn` per planet (e.g. `tatooine.trn`) |

**Example:** `data/sku.0/sys.client/compiled/game/terrain/` or `serverdata/terrain/`

### Oracle (live data)

When configured, Oracle provides:

- **Resources** – live and historical resource rows
- **Players** – character search, inventory, admin actions
- **Cities** – city list and details
- **Status** – player count over time
- **Waypoints** – in-game waypoints synced into local DB

**LOCATION_SCENE mapping:** Oracle waypoints use `LOCATION_SCENE` (int) to identify planets. Configure mappings in **Admin Panel → LOCATION_SCENE to Planet** so waypoints resolve to the correct planet.

### Minimal vs full setup

| Features | Paths needed |
|----------|--------------|
| **Minimal** (login, dashboard) | None (Oracle optional) |
| **Resources** | `RESOURCE_TREE_PATH`, `RESOURCE_NAMES_PATH`, Oracle |
| **Schematics** | All schematic paths |
| **Armory** | `MASTER_ITEM_PATH`, `ITEM_STATS_PATH` |
| **Quest Journal** | `QUEST_LIST_PATH`, `QUEST_TASK_PATH`, `QUEST_STRINGS_PATH` |
| **3D model preview** | `CLIENT_DATA_PATH`, `SHARED_BASE_PATH` |
| **Cartographer** | Oracle + waypoint sync + LOCATION_SCENE mappings |

Use **Admin Panel → Paths** to verify that configured paths exist and are readable.

---

## Authentication

- Login uses your **SWG Titan website** credentials (same as swgtitan.org).
- Auth is validated against the Titan auth endpoint; sessions use a cookie.
- **Profile → My Characters** uses station ID from the Titan site.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server |
| `npm run dev` | Start with `--watch` (restart on file change) |
| `npm run migrate` | Run SQLite migrations |
| `npm run seed` | Seed test data |
| `npm test` | Run tests |
| `npm run sync-schematics` | Sync schematics from disk |
| `npm run test-parser` | Run parser test script |

---

## API Overview

Full documentation: [API.md](API.md). Live API demo: **[test.swgtitan.org:1526](http://test.swgtitan.org:1526)**.

All **public (non-admin)** routes:

| Area | Methods and routes |
|------|--------------------|
| **Auth** | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `GET /api/auth/check-admin` |
| **Health** | `GET /api/health`, `GET /api/health/stats`, `GET /api/health/polls` |
| **Resources** | `GET /api/resources`, `GET /api/resources/classes`, `GET /api/resources/class-info/:className`, `GET /api/resources/stats`, `GET /api/resources/best`, `GET /api/resources/:id` |
| **Schematics** | `GET /api/schematics`, `GET /api/schematics/categories`, `GET /api/schematics/by-resource-class/:class`, `GET /api/schematics/:id`, `GET /api/schematics/:id/best-resources`, `GET /api/schematics/:id/slots/:slotIndex/top-resources` |
| **Items** | `GET /api/items`, `GET /api/items/search`, `GET /api/items/stats`, `GET /api/items/categories`, `GET /api/items/types`, `GET /api/items/columns`, `GET /api/items/by-template/*`, `GET /api/items/:id`, `POST /api/items/load-stats`, `PUT /api/items/columns`, `PUT /api/items/columns/:columnName` |
| **Quests** | `GET /api/quests`, `GET /api/quests/categories`, `GET /api/quests/types`, `GET /api/quests/planets`, `GET /api/quests/reload`, `GET /api/quests/:questName` |
| **Waypoints** | `GET /api/waypoints/planets`, `GET /api/waypoints/stats`, `GET /api/waypoints/settings/creation`, `POST /api/waypoints/settings/creation`, `GET /api/waypoints`, `GET /api/waypoints/:id`, `POST /api/waypoints`, `PUT /api/waypoints/:id`, `DELETE /api/waypoints/:id` |
| **Players** | `GET /api/players/search`, `GET /api/players/:id`, `GET /api/players/:id/inventory` |
| **Cities** | `GET /api/cities`, `GET /api/cities/:id` |
| **Status** | `GET /api/status/current`, `GET /api/status/history`, `POST /api/status/poll` |
| **Models (3D)** | `GET /api/models/texture/*`, `GET /api/models/template/*`, `GET /api/models/schematic/:schematicId` |
| **Terrain** | `GET /api/terrain/planets`, `GET /api/terrain/heightmap/:planetName`, `GET /api/terrain/buildouts/:planetName`, `GET /api/terrain/objects/:planetName`, `GET /api/terrain/info/:planetName`, `GET /api/terrain/shaders/:planetName` |

Endpoints that require login use the session cookie. Admin-only routes (e.g. `/api/admin/*`, `POST /api/players/:id/rename`, `POST /api/waypoints/sync`) require `adminLevel >= 50`; see [API.md](API.md).

---

## Project Structure

```
Chuba/
├── public/           # Frontend (HTML, CSS, JS)
├── src/
│   ├── api/          # Express routes
│   ├── config/       # Configuration
│   ├── database/     # SQLite and Oracle
│   ├── parsers/      # TPF, STF, datatable parsers
│   ├── services/     # Business logic
│   └── utils/        # Logging, alerts, helpers
├── .env.example      # Example environment
├── API.md            # API documentation
└── package.json
```

---

## License

ISC
