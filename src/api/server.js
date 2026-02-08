import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import resourceRoutes from './resources.js';
import schematicRoutes from './schematics.js';
import healthRoutes from './health.js';
import authRoutes from './auth.js';
import adminRoutes from './admin.js';
import itemRoutes from './items.js';
import modelRoutes from './models.js';
import waypointRoutes from './waypoints.js';
import questRoutes from './quests.js';
import statusRoutes from './status.js';
import playerRoutes from './players.js';
import cityRoutes from './cities.js';

const logger = createLogger('api-server');

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure Express application
 * @returns {express.Application}
 */
export function createApp() {
  const app = express();

  // Middleware
  app.use(cors({
    origin: true,
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.debug({
        method: req.method,
        url: req.url,
        status: res.statusCode,
        durationMs: duration,
      });
    });
    next();
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/schematics', schematicRoutes);
  app.use('/api/items', itemRoutes);
  app.use('/api/models', modelRoutes);
  app.use('/api/waypoints', waypointRoutes);
  app.use('/api/quests', questRoutes);
  app.use('/api/status', statusRoutes);
  app.use('/api/players', playerRoutes);
  app.use('/api/cities', cityRoutes);
  app.use('/api/health', healthRoutes);

  // Serve static files from public directory
  const publicPath = path.join(__dirname, '../../public');
  app.use(express.static(publicPath));

  // Serve images from images directory
  const imagesPath = path.join(__dirname, '../../images');
  app.use('/images', express.static(imagesPath));

  // Serve fonts directory
  const fontsPath = path.join(__dirname, '../../fonts');
  app.use('/fonts', express.static(fontsPath));

  // Serve index.html for root and any non-API routes (SPA support)
  app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // API info endpoint
  app.get('/api', (req, res) => {
    res.json({
      name: 'Chuba - Titan Tracker API',
      version: '1.0.0',
      endpoints: {
        resources: '/api/resources',
        schematics: '/api/schematics',
        health: '/api/health',
      },
    });
  });

  // 404 handler for API routes
  app.all('/api/*', (req, res) => {
    logger.warn({ method: req.method, url: req.originalUrl }, 'API endpoint not found');
    res.status(404).json({
      success: false,
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // Fallback to index.html for client-side routing
  app.use((req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Error handler
  app.use((err, req, res, next) => {
    logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  });

  return app;
}

/**
 * Start the API server
 * @returns {Promise<import('http').Server>}
 */
export function startServer() {
  return new Promise((resolve) => {
    const app = createApp();
    const server = app.listen(config.api.port, config.api.host, () => {
      logger.info({ host: config.api.host, port: config.api.port }, 'API server started');
      resolve(server);
    });
  });
}

