import express from 'express';
import { getCities, getCityById } from '../services/city-service.js';

const router = express.Router();

/**
 * GET /api/cities
 * List all cities
 */
router.get('/', async (req, res) => {
  try {
    const cities = await getCities();
    res.json({ success: true, count: cities.length, data: cities });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cities/:id
 * Get city details
 */
router.get('/:id', async (req, res) => {
  try {
    const city = await getCityById(req.params.id);
    if (!city) {
      return res.status(404).json({ success: false, error: 'City not found' });
    }
    res.json({ success: true, data: city });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
