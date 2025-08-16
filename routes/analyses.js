const express = require('express');
const router = express.Router();
const Analysis = require('../models/Analysis'); // napravi model ili iz worker-a izvezi

// GET /analyses/:projectId - vrati sve analize za dati projectId
router.get('/api/analyses/:projectId', async (req, res) => {
  try {
    const analyses = await Analysis.find({ project: req.params.projectId });
    res.json(analyses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Greška pri dohvaćanju analiza' });
  }
});

module.exports = router;
