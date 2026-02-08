import express from 'express';
import { getLatestStatus, getStatusHistory, pollStatus } from '../services/status-service.js';

const router = express.Router();

/**
 * GET /api/status/current
 * Get the most recent server status snapshot
 */
router.get('/current', (req, res) => {
  try {
    const status = getLatestStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/status/history?hours=24
 * Get status history for charting
 */
router.get('/history', (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const history = getStatusHistory(hours);
    res.json({ success: true, count: history.length, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/status/poll
 * Manually trigger a status poll (admin)
 */
router.post('/poll', async (req, res) => {
  try {
    const status = await pollStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
