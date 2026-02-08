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

### GET `/api/admin/test-stf`
Test STF file parsing.

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

## Authentication

Most endpoints require authentication via session cookie. Admin endpoints require `adminLevel >= 50`.

Session cookie name: `chuba_session`

