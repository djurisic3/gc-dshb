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
app.use(express.json());
app.use(cors());

const projectRoutes = require('./routes/projects');
const analyzeUrlRoute = require('./jobs/analyze-url');
app.use('/api/analyze', analyzeUrlRoute);
app.use('/api/projects', projectRoutes);
const analysisRoutes = require('./routes/analyses');
app.use('/api/analyses', analysisRoutes);

const PORT = process.env.PORT || 3000;

// Redis konekcija sa debug logovima
const IORedis = require('ioredis');
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerCommand: 3,
});

// ✅ Dodaj debug logove za Redis
connection.on('connect', () => console.log('🔌 Redis CONNECTED successfully'));
connection.on('ready', () => console.log('✅ Redis READY'));
connection.on('error', (err) => console.error('❌ Redis ERROR:', err));
connection.on('close', () => console.log('🔌 Redis connection CLOSED'));
connection.on('reconnecting', () => console.log('🔄 Redis RECONNECTING...'));

const { Queue } = require('bullmq');
const analyzeQueue = new Queue('analyze', { connection });

// ✅ Dodaj debug logove za Queue
analyzeQueue.on('waiting', (job) => console.log('⏳ Job WAITING:', job.id));
analyzeQueue.on('active', (job) => console.log('🏃 Job ACTIVE:', job.id));
analyzeQueue.on('completed', (job) => console.log('✅ Job COMPLETED:', job.id));
analyzeQueue.on('failed', (job, err) => console.error('❌ Job FAILED:', job.id, err.message));

app.post('/api/analyze/:name', async (req, res) => {
  console.log('🎯 POST /api/analyze/:name called for:', req.params.name);
  
  const repo = await Project.findOne({ name: req.params.name });
  if (!repo) return res.status(404).send('Not found');

  try {
    const job = await analyzeQueue.add('analyze', {
      repoUrl: repo.url.replace('https://github.com/', 'https://github.com/').concat('.git'),
      projectId: repo._id,
      commitSha: repo.lastSha
    });
    
    console.log('✅ Job ADDED to queue:', job.id);
    res.send(`Analysis job queued ✅ (Job ID: ${job.id})`);
  } catch (error) {
    console.error('❌ Error adding job to queue:', error);
    res.status(500).json({ error: 'Failed to queue job' });
  }
});

// ✅ Debug endpoint za health check
app.get('/api/health', async (req, res) => {
  const health = {
    server: 'OK',
    redis: 'Unknown',
    mongodb: 'Unknown',
    openai: 'Unknown',
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      hasRedisUrl: !!process.env.REDIS_URL,
      hasMongoUri: !!process.env.MONGO_URI,
      hasOpenAiKey: !!process.env.OPENAI_API_KEY,
      hasGithubToken: !!process.env.GITHUB_TOKEN,
    }
  };

  // Test Redis
  try {
    await connection.ping();
    health.redis = 'OK';
  } catch (err) {
    health.redis = `Error: ${err.message}`;
  }

  // Test MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      health.mongodb = 'OK';
    } else {
      health.mongodb = `State: ${mongoose.connection.readyState}`;
    }
  } catch (err) {
    health.mongodb = `Error: ${err.message}`;
  }

  res.json(health);
});

// ✅ Debug endpoint za monitoring queue-a
app.get('/api/queue/status', async (req, res) => {
  try {
    const waiting = await analyzeQueue.getWaiting();
    const active = await analyzeQueue.getActive();
    const completed = await analyzeQueue.getCompleted();
    const failed = await analyzeQueue.getFailed();
    
    res.json({
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      jobs: {
        waiting: waiting.map(j => ({ id: j.id, data: j.data })),
        active: active.map(j => ({ id: j.id, data: j.data })),
        failed: failed.map(j => ({ id: j.id, failedReason: j.failedReason }))
      }
    });
  } catch (error) {
    console.error('Queue status error:', error);
    res.status(500).json({ error: error.message });
  }
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
      const greenScore = calculateGreenScore(repo);

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

  const lastUpdated = new Date(repo.updated_at);
  const monthsAgo = (new Date() - lastUpdated) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo > 6) score -= 15;

  return Math.max(score, 0);
}

// Serve static files from React build
app.use(express.static(path.join(__dirname, 'frontend', 'build')));

// Sve ostale GET rute šalju index.html (React SPA)
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server radi na portu ${PORT}`);
});

// ✅ Worker setup sa više debug logova
const { Worker } = require('bullmq');
const { analyzeCode } = require('./jobs/analyze');

console.log('🔧 Initializing Worker...');

const worker = new Worker(
  'analyze',
  async job => {
    console.log('🏃 Worker: Pokrećem analizu za:', job.data.repoUrl);
    console.log('📋 Job data:', JSON.stringify(job.data, null, 2));
    
    try {
      await analyzeCode(job.data);
      console.log('✅ Worker: Analiza uspešno završena');
    } catch (error) {
      console.error('❌ Worker: Greška u analizi:', error);
      throw error; // Re-throw da BullMQ zna da je job failed
    }
  },
  { 
    connection,
    concurrency: 1, // Samo jedan job istovremeno
    limiter: {
      max: 3, // Maksimalno 3 job-a
      duration: 60000, // u toku 1 minute
    },
  }
);

worker.on('ready', () => console.log('✅ Worker is READY'));
worker.on('active', (job) => console.log('🏃 Worker: Job ACTIVE:', job.id));
worker.on('completed', job => console.log('✅ Worker: Job COMPLETED:', job.id));
worker.on('failed', (job, err) => console.error('❌ Worker: Job FAILED:', job?.id, err.message));
worker.on('error', (err) => console.error('❌ Worker ERROR:', err));

console.log('✅ Worker initialized successfully');