/**
 * Models API
 *
 * Endpoints for serving 3D model data from SWG appearance files
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { getModelForTemplate, parseDDSFile } from '../services/model-service.js';
import { parseTPFStringRefs } from '../parsers/tpf-parser.js';

const logger = createLogger('models-api');
const router = express.Router();

/**
 * GET /api/models/texture/*
 * Get texture data for a texture path
 * Returns the texture as base64 encoded data with metadata
 */
router.get('/texture/*', (req, res) => {
  try {
    let texturePath = req.params[0];

    if (!texturePath) {
      return res.status(400).json({
        success: false,
        error: 'Texture path required',
      });
    }

    // Normalize path separators (Windows backslashes to forward slashes)
    texturePath = texturePath.replace(/\\/g, '/');

    // Add .dds extension if not present
    if (!texturePath.endsWith('.dds')) {
      texturePath += '.dds';
    }

    const clientDataPath = config.model?.clientDataPath;
    logger.info({ texturePath, clientDataPath }, 'Texture load request');

    if (!clientDataPath) {
      return res.status(500).json({
        success: false,
        error: 'Server not configured for texture loading',
      });
    }

    // Try multiple possible paths for texture
    const possiblePaths = [
      path.join(clientDataPath, texturePath),
      path.join(clientDataPath, 'texture', texturePath),
    ];

    // Also try without leading directories if texture path starts with texture/
    if (texturePath.startsWith('texture/')) {
      possiblePaths.push(path.join(clientDataPath, texturePath.substring(8)));
    }

    // Add serverdata path as fallback
    const serverdataPath = clientDataPath.replace(/data[/\\]sku\.0[/\\]sys\.client[/\\]compiled[/\\]game/g, 'serverdata');
    if (serverdataPath !== clientDataPath) {
      possiblePaths.push(path.join(serverdataPath, texturePath));
      possiblePaths.push(path.join(serverdataPath, 'texture', texturePath));
    }

    let fullPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        fullPath = p;
        break;
      }
    }

    logger.info({ texturePath, possiblePaths, foundPath: fullPath }, 'Texture path resolution');

    if (!fullPath) {
      return res.status(404).json({
        success: false,
        error: 'Texture not found',
        tried: possiblePaths,
      });
    }

    logger.info({ texturePath, fullPath }, 'Loading texture');

    const ddsData = parseDDSFile(fullPath);

    if (!ddsData) {
      return res.status(500).json({
        success: false,
        error: 'Failed to parse DDS texture',
      });
    }

    // Convert raw data to base64
    const base64Data = Buffer.from(ddsData.data).toString('base64');

    res.json({
      success: true,
      data: {
        path: texturePath,
        width: ddsData.width,
        height: ddsData.height,
        format: ddsData.format,
        data: base64Data,
        mipmapCount: ddsData.mipmaps?.length || 0,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load texture');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/models/template/:templatePath
 * Get 3D model data for a crafted object template
 * templatePath should be URL-encoded, e.g., object%2Ftangible%2Fdice%2Feqp_chance_cube.iff
 */
router.get('/template/*', (req, res) => {
  try {
    const templatePath = req.params[0];

    if (!templatePath) {
      return res.status(400).json({
        success: false,
        error: 'Template path required',
      });
    }

    logger.info({ templatePath }, 'Loading model for template');

    const sharedBasePath = config.schematic?.sharedBasePath;
    const clientDataPath = config.model?.clientDataPath || sharedBasePath;

    if (!sharedBasePath) {
      return res.status(500).json({
        success: false,
        error: 'Server not configured for model loading',
      });
    }

    const modelData = getModelForTemplate(templatePath, sharedBasePath, clientDataPath, parseTPFStringRefs);

    if (!modelData) {
      return res.status(404).json({
        success: false,
        error: 'Model not found for template',
      });
    }

    res.json({
      success: true,
      data: modelData,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load model');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/models/schematic/:schematicId
 * Get 3D model data for a schematic's crafted object
 */
router.get('/schematic/:schematicId', async (req, res) => {
  try {
    const { schematicId } = req.params;

    // Import here to avoid circular dependency
    const { getSchematicById } = await import('../services/schematic-service.js');

    const schematic = getSchematicById(schematicId);

    if (!schematic) {
      return res.status(404).json({
        success: false,
        error: 'Schematic not found',
      });
    }

    if (!schematic.crafted_template) {
      return res.status(404).json({
        success: false,
        error: 'Schematic has no crafted template',
      });
    }

    logger.info({ schematicId, craftedTemplate: schematic.crafted_template }, 'Loading model for schematic');

    const sharedBasePath = config.schematic?.sharedBasePath;
    const clientDataPath = config.model?.clientDataPath || sharedBasePath;

    const modelData = getModelForTemplate(schematic.crafted_template, sharedBasePath, clientDataPath, parseTPFStringRefs);

    if (!modelData) {
      return res.status(404).json({
        success: false,
        error: 'Model not found for schematic',
      });
    }

    res.json({
      success: true,
      data: {
        schematicId,
        schematicName: schematic.schematic_name,
        ...modelData,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load schematic model');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

