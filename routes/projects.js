const express = require('express');
const router = express.Router();
const Project = require('../models/Project');

// GET /projects - lista svih projekata
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const {
      name,
      url,
      description,
      stars,
      forks,
      language,
      updated_at,
      greenScore,
      lastSha,
    } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'Name and url are required.' });
    }

    const project = new Project({
      name,
      url,
      description,
      stars,
      forks,
      language,
      updated_at: updated_at ? new Date(updated_at) : undefined,
      greenScore,
      lastSha,
    });

    await project.save();

    res.status(201).json(project);
  } catch (err) {
    console.error('Greška prilikom dodavanja projekta:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
