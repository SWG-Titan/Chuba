# Chuba - Titan Tracker

A comprehensive Node.js web application for tracking game resources, crafting schematics, items, quests, and terrain for SWG (Star Wars Galaxies) server emulators.

## Features

### 📦 Resource Tracking
- **Live Polling**: Continuously polls and tracks active game resources from Oracle database
- **Historical Data**: Preserves "best-ever" resource rolls even after despawn
- **Advanced Search**: Filter by class, stats, and custom queries (e.g., `OQ > 900`)
- **Resource Class Tree**: Full hierarchical resource classification with icons and translated names

### 📋 Schematic Datapad
- **Schematic Parsing**: Parses draft schematics from server data files (TPF format)
- **Resource Matching**: Computes optimal resources for each schematic slot based on stat weights
- **3D Model Preview**: Renders crafted item 3D models using Three.js
- **Ingredient Display**: Shows resource requirements with translated names

### ⚔️ Armory (Items)
- **Master Item Database**: Parses and stores all game items with full stats
- **Item Search**: Search by name, template, category, or tier
- **Stat Details**: Displays armor stats, weapon damage, and item properties

### 📜 Quest Journal
- **Quest Database**: Parses quest datatables (questlist/questtask)
- **Task Visualization**: Shows quest steps, waypoints, and rewards
- **String Resolution**: Translates quest text from STF files
- **Filtering**: Search by level, type, category, faction, or planet

### 🗺️ Cartographer (Terrain)
- **Terrain Rendering**: 3D terrain visualization using heightmaps
- **Shader-Based Coloring**: Applies terrain colors from shader families
- **Buildout Objects**: Displays static world objects
- **Player Buildings**: Shows player-placed structures from database

### 🔧 Admin Panel
- **Real-time Monitoring**: View system health, resource counts, and sync status
- **Manual Sync**: Trigger resource/schematic polling on demand
- **Error Tracking**: View and clear error logs
- **Database Management**: Clear caches, rebuild indexes

## Prerequisites

- Node.js 20 LTS or higher
- Oracle Instant Client (for Oracle DB connection)
- Access to SWG server's Oracle database (read-only)
- Access to game data files (dsrc, serverdata paths)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd chuba

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Run database migrations
npm run migrate

# (Optional) Seed with sample data for testing
npm run seed

# Start the service
npm start
```

## Configuration

Create a `.env` file based on `.env.example`:

```env
# Oracle Database Connection
ORACLE_USER=swg_reader
ORACLE_PASSWORD=your_password
ORACLE_CONNECTION_STRING=localhost:1521/swgdb

# Local Database
LOCAL_DB_PATH=./data/chuba.db

# Schematic Source
SCHEMATIC_SOURCE_PATH=/path/to/schematics

# Polling
POLL_INTERVAL_MINUTES=5

# API
API_PORT=3000
API_HOST=0.0.0.0

# Logging
LOG_LEVEL=info

# Alerts (Optional)
DISCORD_WEBHOOK_URL=
ENABLE_DISCORD_ALERTS=false
```

## API Endpoints

### Resources

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/resources` | List all resources |
| GET | `/api/resources/:id` | Get resource by ID |
| GET | `/api/resources/best` | Get best resources by class |
| GET | `/api/resources/stats` | Get resource statistics |

### Schematics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/schematics` | List all schematics |
| GET | `/api/schematics/:id` | Get schematic details |
| GET | `/api/schematics/:id/best-resources` | Get best resources for schematic |
| GET | `/api/schematics/:id/slots/:index/top-resources` | Get top N resources for a slot |
| GET | `/api/schematics/categories` | List schematic categories |
| POST | `/api/schematics/sync` | Manually trigger schematic sync |

### Health & Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/health/stats` | System statistics |
| GET | `/api/health/polls` | Poll history |
| POST | `/api/health/poll/resources` | Trigger resource poll |
| POST | `/api/health/poll/schematics` | Trigger schematic sync |

## Example API Responses

### Get Best Resources for Schematic

```json
GET /api/schematics/weapon_blaster_rifle_basic/best-resources

{
  "success": true,
  "data": {
    "schematicId": "weapon_blaster_rifle_basic",
    "schematicName": "Basic Blaster Rifle",
    "overallScore": 756,
    "slots": [
      {
        "slotIndex": 0,
        "slotName": "Stock",
        "resourceClass": "Hardwood",
        "quantity": 10,
        "bestActive": {
          "resourceId": "res_123",
          "resourceName": "PrimeWoodAlpha",
          "score": 823,
          "scoreBreakdown": {
            "OQ": { "value": 890, "weight": 0.5, "contribution": 445 },
            "CD": { "value": 720, "weight": 0.3, "contribution": 216 },
            "DR": { "value": 810, "weight": 0.2, "contribution": 162 }
          }
        },
        "bestHistorical": {
          "resourceId": "res_456",
          "resourceName": "UltraWoodOmega",
          "score": 912,
          "isActive": false
        }
      }
    ]
  }
}
```

## Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f chuba
```

## Architecture

```
src/
├── api/                 # Express REST API
│   ├── server.js       # API server setup
│   ├── resources.js    # Resource endpoints
│   ├── schematics.js   # Schematic endpoints
│   └── health.js       # Health check endpoints
├── config/             # Configuration
├── database/           # Database connections
│   ├── local-db.js     # SQLite (local persistence)
│   ├── oracle-db.js    # Oracle (game data source)
│   ├── migrate.js      # Migration runner
│   └── seed.js         # Test data seeder
├── services/           # Business logic
│   ├── resource-service.js   # Resource operations
│   ├── schematic-service.js  # Schematic parsing
│   ├── matching-service.js   # Resource-schematic matching
│   └── polling-service.js    # Scheduled polling
├── utils/              # Utilities
│   ├── logger.js       # Logging
│   ├── alerts.js       # Discord alerts
│   └── resource-helpers.js  # Resource utilities
└── index.js            # Application entry point
```

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run tests
npm test
```

## Resource Stats

The system tracks these resource statistics:

| Stat | Name |
|------|------|
| OQ | Overall Quality |
| CD | Conductivity |
| DR | Decay Resistance |
| FL | Flavor |
| HR | Heat Resistance |
| MA | Malleability |
| PE | Potential Energy |
| SR | Shock Resistance |
| UT | Unit Toughness |
| CR | Cold Resistance |
| ER | Entangle Resistance |

## Scoring Algorithm

Resources are scored for schematics using weighted averages:

```
score = Σ(stat_value × weight) / Σ(weights)
```

Example for a slot with weights `{OQ: 0.5, CD: 0.3, DR: 0.2}`:
```
score = (OQ × 0.5 + CD × 0.3 + DR × 0.2)
```

## License

ISC

