// @ts-nocheck

require('dotenv').config();

const connectDB = require('./db');
const Project = require('./models/Project');

connectDB();

const express = require('express');
const axios = require('axios');
const cors = require('cors');

 const path = require('path');

const app = express();
app.use(express.json()); // obavezno da možeš parsirati JSON body
app.use(cors());
const analyzeRouteUrlRoute = require('./routes/analyzeUrl');
app.use('/api/reanalyze', analyzeRouteUrlRoute);
const projectRoutes = require('./routes/projects');
const analyzeUrlRoute = require('./jobs/analyze-url');
app.use('/api/analyze-url', analyzeUrlRoute);
app.use('/api/projects', projectRoutes);
const analysisRoutes = require('./routes/analyses');
app.use('/api/analyses', analysisRoutes);
const PORT = process.env.PORT || 3000;

const IORedis = require('ioredis');
const connection = new IORedis(process.env.REDIS_URL);

const { Queue } = require('bullmq');
const analyzeQueue = new Queue('analyze', {connection});


app.post('/api/analyze/:name', async (req, res) => {
  const repo = await Project.findOne({ name: req.params.name });
  if (!repo) return res.status(404).send('Not found');

  analyzeQueue.add('run', {
    repoUrl: repo.url.replace('https://github.com/', 'https://github.com/').concat('.git'),
    projectId: repo._id,
    commitSha: repo.lastSha      // upiši ranije pri fetch-u
  });

  res.send('Analysis job queued ✅');
});


 app.get('/api/projects', async (req, res) => {
  try {
    const response = await axios.get(`https://api.github.com/users/${process.env.GITHUB_USERNAME}/repos`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`
      }
    });

    const savedProjects = [];

    for (const repo of response.data) {
      const greenScore = calculateGreenScore(repo); // vidi ispod

      const projectData = {
        name: repo.name,
        url: repo.html_url,
        description: repo.description,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        updated_at: repo.updated_at,
        greenScore
      };

      // Sačuvaj u bazu (update ako već postoji)
      const saved = await Project.findOneAndUpdate(
        { name: repo.name },
        projectData,
        { upsert: true, new: true }
      );

      savedProjects.push(saved);
    }

    res.json(savedProjects);
  } catch (error) {
    console.error('GitHub API error:', error.response?.data || error.message);

    res.status(500).json({ error: 'Greška pri dohvatu GitHub projekata' });
  }
});

function calculateGreenScore(repo) {
  let score = 100;

  if (repo.forks > 50) score -= 10;
  if (repo.stargazers_count < 5) score -= 15;
  if (!repo.language) score -= 20;

  // penalizuj ako nije skoro ažuriran
  const lastUpdated = new Date(repo.updated_at);
  const monthsAgo = (new Date() - lastUpdated) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo > 6) score -= 15;

  return Math.max(score, 0); // nikad ispod 0
}

app.listen(PORT, () => {
  console.log(`Server radi na portu ${PORT}`);
});


// Serve static files from React build
app.use(express.static(path.join(__dirname, 'frontend', 'build')));

console.log("before catch-all");
// Sve ostale GET rute šalju index.html (React SPA)
app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'build', 'index.html'));
});

const fs = require('fs');
const indexPath = path.join(__dirname, 'frontend', 'build', 'index.html');
console.log('index.html exists?', fs.existsSync(indexPath));
console.log("after catch-all");