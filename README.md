# Chuba - Titan Tracker

A Node.js web app for tracking game resources, schematics, items, quests, terrain, and players for SWG (Star Wars Galaxies) server emulators such as SWG Titan.

---

## Setup

### Prerequisites

- **Node.js** 18 or higher (20 LTS recommended)
- **Oracle Instant Client** (only if you need live game data: resources, players, cities, status)
- **Game data paths** (dsrc / serverdata) for schematics, items, quests, terrain, and resource names

### 1. Clone and install

```bash
git clone <repository-url>
cd Chuba

npm install
```

### 2. Environment configuration

Copy the example env file and edit it with your paths and credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Purpose |
|----------|---------|
| `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECTION_STRING` | Read-only Oracle connection to the SWG game database (resources, players, status). Omit or leave wrong to run in offline mode. |
| `LOCAL_DB_PATH` | SQLite file for local cache (default `./data/chuba.db`). |
| `SCHEMATIC_SOURCE_PATH`, `STRINGS_PATH`, `DATATABLE_PATH`, `SERVER_BASE_PATH`, `SHARED_BASE_PATH` | Paths to dsrc/compiled game data for schematics and crafting. |
| `MASTER_ITEM_PATH`, `ITEM_STATS_PATH` | Paths for the item/armory database. |
| `CLIENT_DATA_PATH` | Path to client game data for 3D models. |
| `TERRAIN_PATH` | Path to terrain data for the Cartographer. |
| `RESOURCE_TREE_PATH`, `RESOURCE_NAMES_PATH` | Resource tree and names for the resource tracker. |
| `QUEST_LIST_PATH`, `QUEST_TASK_PATH`, `QUEST_STRINGS_PATH` | Quest datatables and strings for the Quest Journal. |
| `API_PORT`, `API_HOST` | Server port and bind address (default `3000`, `0.0.0.0`). |
| `POLL_INTERVAL_MINUTES` | How often to poll Oracle for resources (default `5`). |
| `LOG_LEVEL` | Logging level (e.g. `info`, `debug`). |
| `DISCORD_WEBHOOK_URL`, `ENABLE_DISCORD_ALERTS` | Optional Discord alerts on start/failure. |

Paths can be Windows or Linux style; adjust for your SWG install (e.g. Titan `dsrc` / `data` layout).

### 3. Local database (first run)

Create the SQLite DB and run migrations:

```bash
npm run migrate
```

Optional: seed test data:

```bash
npm run seed
```

### 4. Start the app

```bash
npm start
```

For development with auto-restart on file changes:

```bash
npm run dev
```

The app will:

- Create `./data` if needed and use the SQLite DB at `LOCAL_DB_PATH`.
- Try to connect to Oracle; if it fails, it runs in **offline mode** (no live resources/players/status).
- Serve the web UI at **http://localhost:3000** (or the host/port you set in `.env`).

Open that URL in a browser to use the app.

---

## Usage

### Logging in

- Use your **SWG Titan website** username and password (same as swgtitan.org).
- Login is validated against the Titan auth endpoint; session is kept in a cookie.
- Some features (e.g. **Profile – My Characters**) require a valid station ID from the Titan site (`station-parse.php`).

### After login

- **Dashboard** – Logo and **Player Count Over Time** graph (24h / 7d / 30d). Requires Oracle and status polling.
- **Resources** – Search and filter live/historical resources; view by class and stats. Requires Oracle and resource polling.
- **Schematic Datapad** – Browse schematics, see best resources per slot, view 3D model. Uses local schematic + resource data.
- **Armory** – Search items by name, template, category, tier; view stats. Uses local item datatables.
- **Quest Journal** – Browse and search quests; view tasks and rewards. Uses local quest datatables and STF strings.
- **Cartographer** – Terrain and waypoints; optional player overlay (admin). Uses terrain data and optional Oracle.
- **Lookup** (dropdown)  
  - **Players** – Search by character name; view details, inventory, and (if admin) admin actions.  
  - **Cities** – List/filter cities. Requires Oracle.
- **Profile** – Click your **username** in the header to open **My Characters** (characters tied to your station ID). Same Details/Admin actions as Player Lookup.
- **Admin Panel** (if your account has admin level ≥ 50) – Health, manual sync, errors, cache and DB management.

### Typical workflow

1. Log in with your Titan credentials.
2. Use **Dashboard** for population over time (if Oracle is configured).
3. Use **Resources** to find materials for crafting; use **Schematic Datapad** to match schematics to best resources.
4. Use **Armory** to look up items; use **Quest Journal** to browse quests.
5. Use **Lookup → Players** to search characters; use **Profile** (username) to see your own characters and open details/admin like in Player Lookup.

---

## Configuration reference

Example `.env` (minimal; adjust paths to your install):

```env
# Oracle (optional; omit for offline)
ORACLE_USER=swg_reader
ORACLE_PASSWORD=your_password
ORACLE_CONNECTION_STRING=localhost:1521/swgdb

LOCAL_DB_PATH=./data/chuba.db

# Example paths (Windows); use your dsrc/data roots
SCHEMATIC_SOURCE_PATH=D:/titan/dsrc/sku.0/sys.server/compiled/game/object/draft_schematic/
STRINGS_PATH=D:/titan/data/sku.0/sys.client/compiled/game/string/en/
DATATABLE_PATH=D:/titan/dsrc/sku.0/sys.server/compiled/game/datatables/crafting/
SERVER_BASE_PATH=D:/titan/dsrc/sku.0/sys.server/compiled/game/
SHARED_BASE_PATH=D:/titan/dsrc/sku.0/sys.shared/compiled/game/

MASTER_ITEM_PATH=D:/titan/dsrc/sku.0/sys.server/compiled/game/datatables/item/master_item/
ITEM_STATS_PATH=D:/titan/dsrc/sku.0/sys.server/compiled/game/datatables/item/
CLIENT_DATA_PATH=D:/titan/data/sku.0/sys.client/compiled/game/
TERRAIN_PATH=D:/titan/data/sku.0/sys.client/compiled/game/terrain/

RESOURCE_TREE_PATH=D:/titan/dsrc/sku.0/sys.shared/compiled/game/datatables/resource/resource_tree.tab
RESOURCE_NAMES_PATH=D:/titan/data/sku.0/sys.client/compiled/game/string/en/resource/resource_names.tab

QUEST_LIST_PATH=D:/titan/dsrc/sku.0/sys.shared/compiled/game/datatables/questlist/
QUEST_TASK_PATH=D:/titan/dsrc/sku.0/sys.shared/compiled/game/datatables/questtask/
QUEST_STRINGS_PATH=D:/titan/serverdata/string/en/quest/ground/

API_PORT=3000
API_HOST=0.0.0.0
POLL_INTERVAL_MINUTES=5
LOG_LEVEL=info
```

---

## Features (overview)

| Area | Description |
|------|-------------|
| **Resources** | Live polling from Oracle, best-ever rolls, search/filter by class and stats. |
| **Schematics** | Parse TPF/draft schematics, match best resources per slot, 3D model preview. |
| **Armory** | Master item DB, search by name/template/category/tier, armor/weapon stats. |
| **Quest Journal** | Quest list/task datatables, STF strings, waypoints and rewards. |
| **Cartographer** | Terrain, waypoints, optional player-on-planet overlay (admin). |
| **Player Lookup** | Search by name, details, inventory; admin: rename, move, race, lock account. |
| **Profile** | My Characters by station ID (Titan); same lookup behavior as Player Lookup. |
| **Cities** | List/filter cities from Oracle. |
| **Admin** | Health, manual sync, errors, cache/DB management (admin level ≥ 50). |

---

## API (summary)

- **Auth:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `GET /api/auth/check-admin`
- **Resources:** `GET /api/resources`, `GET /api/resources/:id`, etc.
- **Schematics:** `GET /api/schematics`, `GET /api/schematics/:id`, `GET /api/schematics/:id/best-resources`, etc.
- **Items:** `GET /api/items`, `GET /api/items/:id`, etc.
- **Quests:** `GET /api/quests`, `GET /api/quests/:id`, etc.
- **Status:** `GET /api/status/current`, `GET /api/status/history`
- **Players:** `GET /api/players/search`, `GET /api/players/my-characters`, `GET /api/players/:id`, etc.
- **Health:** `GET /api/health`, `GET /api/health/stats`

All relevant endpoints use the session cookie when login is required.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server (production). |
| `npm run dev` | Start with `--watch` (restart on file change). |
| `npm run migrate` | Run SQLite migrations. |
| `npm run seed` | Seed test data into SQLite. |
| `npm test` | Run tests. |

---

## License

ISC
