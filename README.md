# Chuba – SWG Emulator Tracker

A Node.js web application for **SWG (Star Wars Galaxies)** server emulators. It provides resource tracking, schematic browsing, item lookup, quest journal, terrain mapping, and player/city administration.

> **Compatibility note:** Chuba was originally built for **SWG: Titan**. If you are running another Star Wars Galaxies server, replace all deployment-specific references (auth URLs, status URLs, hostnames, branding text, and related config) to match your environment.

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

Each feature expects specific SWG game files. Paths vary by server layout (SRC, custom, legacy forks). Typical roots: `dsrc/` and `data/` (or `serverdata/`) for compiled/string data.

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

- Login uses your emulator website credentials.
- Auth is validated against your configured auth endpoint; sessions use a cookie.
- **Profile → My Characters** uses station ID from your configured account endpoint.

---

## How to Use Chuba

This section covers daily usage for both regular users and admins.

### First launch checklist

1. Start the app with `npm start`.
2. Open `http://localhost:3000` (or your configured host/port).
3. Log in with your emulator account.
4. Verify data is loading:
   - `Dashboard` shows server status/player history.
   - `Resources` returns current resources.
   - `Schematic Datapad`, `Armory`, and `Quest Journal` show data from local files.
5. If something is missing, open **Admin Panel → Paths** and confirm configured paths exist.

### User guide (non-admin)

#### Dashboard

- Use for a quick health view and player-count trend.
- If chart data is empty, status polling or Oracle connectivity is likely missing.

#### Resources

- Search by name/class and filter active resources.
- Use class view + stat filters to find best crafting candidates.
- Open a resource to inspect detailed stats and usage context.

#### Schematic Datapad

- Search by schematic name/category.
- Open a schematic to inspect slots and ingredient requirements.
- Use **Best Resources** to match current resources against slot weights.
- Use model preview to inspect crafted object appearance when templates are resolvable.

#### Armory

- Search by name/template/category/type.
- Use sort and column controls for focused comparisons.
- Open item details to inspect derived stats and effects.

#### Quest Journal

- Filter by level, category, planet, tier, type, and reward presence.
- Open quest detail to review full task flow and rewards.
- Search supports quest names and resolved journal text.

#### Cartographer (Waypoints)

- Select a planet and pan/zoom the map.
- View synced in-game waypoints plus local waypoints.
- Create, edit, and delete local waypoints from the map/list.
- Use search to quickly focus waypoints by name.

#### Lookup

- **Players**: Search character names and open full details/inventory.
- **Cities**: Browse and inspect city details.
- **Profile → My Characters**: Shows your characters linked to your station ID.

### Admin guide

Admin features require `adminLevel >= 50`.

#### Operational health and diagnostics

- Review service status, polling health, and aggregate stats.
- Check error logs and summaries for parser/path/Oracle failures.
- Use paths verification to catch missing or incorrect data directories.

#### Data refresh and synchronization

- Trigger manual resource polling.
- Trigger schematic sync from disk.
- Trigger item sync and stats reload.
- Trigger waypoint Oracle sync.
- Reload resource tree and sync resource classes into DB.
- Refresh template-name cache for faster display resolution.

#### Waypoint and mapping administration

- Configure **LOCATION_SCENE → planet** mappings so Oracle waypoints map correctly.
- Clear local-only or all waypoints when cleanup is required.
- Prune duplicate waypoints if map data has repeated entries.

#### Player administration

- Rename character.
- Move character to new coordinates.
- Change race/template.
- Lock/unlock account associated with a character.
- Inspect object variables for deeper diagnostics.

#### Item display administration

- Hide/show item categories for UI control.
- Update item column visibility and display metadata.

#### Safety-critical actions

Use with care in non-production first:

- Nuke database (destructive reset).
- Clear resource history.
- Clear all resources.
- Bulk import mapping data.

### Recommended workflows

#### Crafting workflow

1. Find target item/schematic in **Schematic Datapad**.
2. Review weighted slots and ingredient types.
3. Use **Resources** filters to find top candidates.
4. Validate final crafted output in model preview (if available).

#### Character support workflow (admin)

1. Search player in **Lookup → Players**.
2. Review profile, location, and inventory.
3. Apply rename/move/race/lock action as needed.
4. Re-open details to verify the action.

#### Data onboarding workflow (new environment)

1. Configure `.env` paths.
2. Run `npm run migrate`.
3. Start app and log in.
4. Use **Admin Panel → Paths** to validate file availability.
5. Run manual syncs (resources, schematics, items, waypoints).
6. Verify each user-facing module has data.

### Troubleshooting by symptom

- **Login works, but pages are empty**: Check file paths and run syncs.
- **Resources missing**: Confirm Oracle connectivity and resource polling.
- **Quest names show raw keys**: Verify quest strings path and `.tab` dumps.
- **Model preview missing**: Verify `CLIENT_DATA_PATH` and `SHARED_BASE_PATH`.
- **Waypoints missing planet assignment**: Add LOCATION_SCENE mappings.
- **Frequent parser errors**: Validate source files are complete and readable.

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

Full documentation: [API.md](API.md). Live API demo: **[`<your-api-host>:<port>`](http://localhost:3000)**.

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
