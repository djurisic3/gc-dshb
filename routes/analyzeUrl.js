// routes/analyze-url.js
const express = require('express');
const router = express.Router();
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const Project = require('../models/Project');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL);
const analyzeQueue = new Queue('analyze', { connection });

router.post('/analyze-url', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('github.com')) {
    return res.status(400).json({ error: 'Neispravan GitHub URL' });
  }

  const name = url.split('/').pop().replace('.git', '');

  try {
    // Kloniranje u privremeni folder
    const tmpDir = path.join(__dirname, '..', 'tmp', Date.now().toString());
    await simpleGit().clone(url, tmpDir);

    // Opcionalno: dohvat metapodataka s GitHub API-ja
    const apiRes = await axios.get(`https://api.github.com/repos/${url.split('github.com/')[1].replace('.git','')}`, {
      headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` }
    });
    const repoData = apiRes.data;

    // Napravi novi dokument u bazi
    const project = await Project.create({
      name: repoData.name,
      url: repoData.html_url,
      description: repoData.description || '',
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      language: repoData.language || '',
      updated_at: repoData.updated_at ? new Date(repoData.updated_at) : new Date(),
      greenScore: 0,   // naknadno ćemo ažurirati
      lastSha: repoData.pushed_at || ''
    });

    // Pokreni worker job
    await analyzeQueue.add('run', {
      repoUrl: url,
      projectId: project._id,
      commitSha: repoData.pushed_at || ''
    });

    res.json({ message: '✅ Repo spremljen i analiza pokrenuta.', project });
  } catch (err) {
    console.error('❌ Greška u /analyze-url:', err.message);
    res.status(500).json({ error: 'Greška prilikom dodavanja projekta' });
  }
});

module.exports = router;
