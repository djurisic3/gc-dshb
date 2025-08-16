const express = require('express');
const router = express.Router();
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const { Queue } = require('bullmq');
const Project = require('../models/Project');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL);
connection.on('connect', () => console.log('Redis spojen'));
connection.on('error', (err) => console.error('Redis error', err));
const analyzeQueue = new Queue('analyze', {connection});

// POST /analyze-url — Kreira ili ažurira projekt i pokreće analizu
router.post('/api/analyze-url', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('github.com')) {
    return res.status(400).json({ error: 'Neispravan GitHub URL' });
  }

  const name = url.split('/').pop().replace('.git', '');

  try {
    const tmpDir = path.join(__dirname, '..', 'tmp', Date.now().toString());
    await simpleGit().clone(url, tmpDir);

    // Jednostavna metrika
    const fileCount = fs.readdirSync(tmpDir).length;
    const greenScore = 100 - fileCount;

    // Umjesto .create koristi upsert da izbjegnemo duplikate
    const project = await Project.findOneAndUpdate(
      { url },
      {
        name,
        url,
        description: '',
        stars: 0,
        forks: 0,
        language: '',
        updated_at: new Date(),
        greenScore,
        lastSha: ''
      },
      { upsert: true, new: true }
    );

    await analyzeQueue.add('run', {
      repoUrl: url,
      projectId: project._id,
    });

    res.json({ message: '✅ Repo spremljen i analiza pokrenuta.', project });
  } catch (err) {
    console.error('❌ Greška:', err.message);
    res.status(500).json({ error: 'Greška prilikom obrade.' });
  }
});

// POST /reanalyze — Ponovno pokreće analizu za postojeći projekt
router.post('/reanalyze', async (req, res) => {
  const { repoUrl, projectId } = req.body;

  if (!repoUrl || !projectId) {
    return res.status(400).json({ error: 'Nedostaju podaci' });
  }

  try {
    await analyzeQueue.add('analyze', { repoUrl, projectId });
    res.json({ message: 'Analiza ponovno pokrenuta' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri pokretanju analize' });
  }
});

// GET /projects — Dohvaća sve projekte
router.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.find().sort({ updated_at: -1 });
    res.json(projects);
  } catch (err) {
    console.error('❌ Greška kod dohvaćanja projekata:', err.message);
    res.status(500).json({ error: 'Greška pri dohvaćanju projekata' });
  }
});

// DELETE /projects/:id — Briše projekt iz baze
router.delete('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Project.findByIdAndDelete(id);
    res.json({ message: '✅ Projekt obrisan.' });
  } catch (err) {
    console.error('❌ Greška pri brisanju:', err.message);
    res.status(500).json({ error: 'Greška pri brisanju projekta.' });
  }
});

module.exports = router;