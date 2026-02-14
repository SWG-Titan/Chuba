# Chuba API Documentation

Base URL: `/api`

---

## Authentication

### POST `/api/auth/login`
Authenticate user and create session.

**Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "username": "string",
    "adminLevel": 50,
    "isAdmin": true
  }
}
```

### POST `/api/auth/logout`
Destroy session and clear cookie.

### GET `/api/auth/session`
Get current session info.

### GET `/api/auth/check-admin`
Check if current session has admin privileges.

---

## Health

### GET `/api/health`
Get system health status.

### GET `/api/health/stats`
Get application statistics.

### GET `/api/health/polls`
Get recent poll history.

---

## Resources

### GET `/api/resources`
Get all resources with optional filtering.

**Query Parameters:**
- `active` - Filter by active status (default: true)
- `class` - Filter by resource class
- `search` - Search term
- `limit` - Max results (default: 100)
- `offset` - Pagination offset

### GET `/api/resources/class-info/:className`
Get resource class info including icon and translated name.

### GET `/api/resources/classes`
Get all resource classes with icons and names.

### GET `/api/resources/stats`
Get resource statistics.

### GET `/api/resources/best`
Get best resources by class and/or stat.

**Query Parameters:**
- `class` - Resource class (required)
- `stat` - Specific stat to optimize
- `active` - Filter active only (default: true)

### GET `/api/resources/:id`
Get a single resource by ID with schematic usage.

---

## Schematics

### GET `/api/schematics`
Get all schematics with optional filtering.

**Query Parameters:**
- `search` - Search term
- `category` - Filter by category
- `limit` - Max results (default: 100)
- `offset` - Pagination offset

### GET `/api/schematics/categories`
Get all schematic categories with counts.

### GET `/api/schematics/by-resource-class/:class`
Get schematics that use a specific resource class.

### POST `/api/schematics/sync`
Sync schematics from disk (Admin only).

### GET `/api/schematics/:id`
Get a single schematic with full details.

### GET `/api/schematics/:id/best-resources`
Get best resources for each slot in a schematic.

### GET `/api/schematics/:id/slots/:slotIndex/top-resources`
Get top resources for a specific schematic slot.

---

## Items

### GET `/api/items`
Get items with filtering and pagination.

**Query Parameters:**
- `search` - Search term
- `category` - Filter by category
- `type` - Filter by item type
- `minLevel` - Minimum required level
- `maxLevel` - Maximum required level
- `sortBy` - Sort column
- `sortDir` - Sort direction (asc/desc)
- `limit` - Max results (default: 50)
- `offset` - Pagination offset

### GET `/api/items/search`
Quick search items by name.

**Query Parameters:**
- `q` - Search query
- `limit` - Max results (default: 50)

### GET `/api/items/stats`
Get item statistics.

### GET `/api/items/categories`
Get all item categories with counts.

### GET `/api/items/types`
Get all item types with counts.

### GET `/api/items/columns`
Get available database columns for items.

### GET `/api/items/by-template/*`
Get item by template path.

### GET `/api/items/:id`
Get a single item by ID with full stats.

### POST `/api/items/sync`
Sync master items from disk (Admin only).

### POST `/api/items/load-stats`
Reload item stats from disk.

### POST `/api/items/hide`
Hide/show item categories (Admin). Body: `{ category, hidden }`.

### GET `/api/items/columns`
Get column visibility settings.

### PUT `/api/items/columns/:columnName`
Update a single column visibility setting.

### PUT `/api/items/columns`
Bulk update column visibility. Body: `{ columns: [{ columnName, visible, displayName?, sortOrder? }] }`.

### GET `/api/items/by-template/*`
Get item by template path.

---

## Players

### GET `/api/players/search`
Search players by character name.

**Query Parameters:**
- `q` - Search term (min 2 characters)

**Response:** `{ success, count, data: [{ characterObjectId, stationId, name, planet, x, y, z, cash, bank, templateId }] }`

### GET `/api/players/by-planet`
Get all players on a specific planet (Admin only). Used for Cartographer player overlay.

**Query Parameters:**
- `planet` - Planet key (e.g. `tatooine`)

**Response:** `{ success, count, data: [{ characterObjectId, name, x, y, z }] }`

### GET `/api/players/:id`
Get player details by character object ID.

**Response:** `{ success, data: { characterObjectId, stationId, name, planet, x, y, z, cash, bank, templateId } }`

### GET `/api/players/:id/inventory`
Get recursive inventory tree for a player.

**Response:** `{ success, totalItems, data: tree }`

### GET `/api/players/:id/objvars`
Get object variables for the player character (Admin only).

**Response:** `{ success, count, data: [{ name, type, value }] }`

### POST `/api/players/:id/rename`
Rename a character (Admin only). Body: `{ newName }`.

### POST `/api/players/:id/move`
Move a character to a new location (Admin only). Body: `{ planet, x, y, z }`.

### POST `/api/players/:id/race`
Change character race/template (Admin only). Body: `{ templateId }`.

### POST `/api/players/:id/lock`
Lock or unlock the account for this character (Admin only). Body: `{ locked: boolean, stationId }`.

---

## Cities

### GET `/api/cities`
Get all cities (from Oracle via CITY_OBJECTS + OBJECT_VARIABLES_VIEW).

**Response:** `{ success, data: [{ cityId, name, mayorId, mayorName, planet, x, y, z, radius, incomeTax, ... }] }`

### GET `/api/cities/:id`
Get a single city by ID.

---

## Waypoints

Waypoints are stored locally (SQLite). In-game waypoints are synced from Oracle using LOCATION_SCENE → planet mappings (Admin).

### GET `/api/waypoints/planets`
Get list of available planets with map info (name, displayName, mapSize).

### GET `/api/waypoints/stats`
Get waypoint statistics (total, byPlanet, bySource).

### GET `/api/waypoints/settings/creation`
Check if waypoint creation from the map is enabled.

### POST `/api/waypoints/settings/creation`
Toggle waypoint creation. Body: `{ enabled: boolean }`.

### POST `/api/waypoints/sync`
Trigger Oracle waypoint sync (Admin). Populates local DB from WAYPOINTS using LOCATION_SCENE→planet mappings.

### POST `/api/waypoints/clear`
Clear waypoints (Admin). Body: `{ includeOracle?: boolean }` — if true, clears all; otherwise only local.

### GET `/api/waypoints`
Get waypoints, optionally filtered by planet.

**Query Parameters:**
- `planet` - Filter by planet key (e.g. `tatooine`)

**Response:** `{ success, count, data: [{ waypoint_id, object_id, name, planet, x, y, z, color, active, source }] }`

### GET `/api/waypoints/:id`
Get a single waypoint by ID.

### POST `/api/waypoints`
Create a new local waypoint. Body: `{ name, planet, x, y, z, color? }`.

### PUT `/api/waypoints/:id`
Update a local waypoint. Body: `{ name?, x?, y?, z?, color?, planet? }`. Server (Oracle) waypoints are read-only.

### DELETE `/api/waypoints/:id`
Delete a local waypoint. Server waypoints cannot be deleted.

---

## Status

### GET `/api/status/current`
Get current server status (player count, etc.).

### GET `/api/status/history`
Get server status history for charts.

### POST `/api/status/poll`
Trigger a manual status poll (fetch and store current status).

---

## Models (3D)

### GET `/api/models/texture/*`
Get texture file for 3D rendering.

### GET `/api/models/template/*`
Get 3D model data for an object template.

### GET `/api/models/schematic/:schematicId`
Get 3D model for a schematic's crafted object.

---

## Terrain

*Note: Cartographer map planet list and waypoint data are provided by **Waypoints** (`/api/waypoints/planets`, `/api/waypoints`).*

### GET `/api/terrain/planets`
Get list of available planets.

### GET `/api/terrain/heightmap/:planetName`
Get terrain heightmap for a planet.

**Query Parameters:**
- `resolution` - Heightmap resolution (default: 256)

### GET `/api/terrain/buildouts/:planetName`
Get buildout objects for a planet.

### GET `/api/terrain/objects/:planetName`
Get player-placed objects for a planet.

### GET `/api/terrain/info/:planetName`
Get terrain info for a planet.

### GET `/api/terrain/shaders/:planetName`
Get terrain shader families for a planet.

---

## Quests

### GET `/api/quests`
Get all quests with optional filtering.

**Query Parameters:**
- `search` - Search term
- `level` - Exact level
- `minLevel` - Minimum level
- `maxLevel` - Maximum level
- `tier` - Quest tier
- `type` - Quest type (solo, group, heroic, pvp)
- `category` - Quest category
- `faction` - Faction filter
- `planet` - Planet filter
- `hasRewards` - Filter quests with rewards
- `limit` - Max results (default: 100)
- `offset` - Pagination offset

### GET `/api/quests/categories`
Get all quest categories.

### GET `/api/quests/types`
Get all quest types.

### GET `/api/quests/planets`
Get all planets with quests.

### GET `/api/quests/reload`
Reload quest data from files.

### GET `/api/quests/:questName`
Get a specific quest with full details including tasks.

---

## Admin (Requires Admin Level 50+)

### GET `/api/admin/config`
Get current configuration (sanitized).

### GET `/api/admin/stats`
Get admin statistics (DB size, counts, etc.).

### GET `/api/admin/logs`
Get recent application logs.

### GET `/api/admin/errors`
Get tracked errors.

### GET `/api/admin/errors/summary`
Get error summary by category.

### DELETE `/api/admin/errors`
Clear tracked errors.

### GET `/api/admin/test-stf`
Test STF file parsing. Query: `?file=...&key=...`.

### GET `/api/admin/resource-tree/stats`
Get resource tree statistics.

### GET `/api/admin/resource-tree/test/:className`
Test resource class lookup.

### GET `/api/admin/template-names/stats`
Get template name cache statistics.

### GET `/api/admin/paths`
Get and verify configured file paths.

### POST `/api/admin/poll/resources`
Trigger manual resource poll.

### POST `/api/admin/poll/schematics`
Trigger manual schematic sync.

### POST `/api/admin/sync/items`
Sync master items from disk.

### POST `/api/admin/nuke-database`
Reset entire database (destructive).

### POST `/api/admin/clear-history`
Clear resource history.

### POST `/api/admin/clear-resources`
Clear all resources.

### POST `/api/admin/resource-tree/reload`
Reload resource tree from disk.

### POST `/api/admin/resource-tree/sync-db`
Sync resource classes to database.

### POST `/api/admin/template-names/cache-all`
Cache all template names.

### GET `/api/admin/objvar-mappings`
Get all objvar key → display label mappings (for player Object Information).

**Response:** `{ success, count, data: [{ id, objvar_name, display_label, category }] }`

### POST `/api/admin/objvar-mappings`
Add or update an objvar mapping. Body: `{ objvarName, displayLabel, category? }`.

### DELETE `/api/admin/objvar-mappings/:id`
Delete an objvar key mapping.

### POST `/api/admin/objvar-mappings/bulk`
Bulk import objvar mappings. Body: `{ mappings: [{ objvarName, displayLabel, category? }, ...] }`.

### GET `/api/admin/location-scene-mappings`
Get all LOCATION_SCENE (int) → planet mappings (for waypoint sync from Oracle).

**Response:** `{ success, count, data: [{ id, location_scene, planet }], planets: [...] }`

### POST `/api/admin/location-scene-mappings`
Add or update a LOCATION_SCENE → planet mapping. Body: `{ locationScene: number, planet: string }`.

### DELETE `/api/admin/location-scene-mappings/:idOrScene`
Delete a mapping by row id or by location_scene value.

---

## Response Format

All endpoints return JSON with the following structure:

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "count": 100,
  "total": 500
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message"
}
```

---

## Notes

- Most endpoints require authentication via session cookie.
- Admin endpoints require `adminLevel >= 50` (session `isAdmin`).
- Session cookie name: `chuba_session`.
- Cartographer (map) uses **Waypoints** (`/api/waypoints/planets`, `/api/waypoints?planet=...`) and optionally **Players** (`/api/players/by-planet`) for the player overlay.

