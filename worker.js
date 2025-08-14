require('dotenv').config();
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { analyzeCode } = require('./jobs/analyze');

// 🔌 Redis konekcija
const connection = new IORedis
  (process.env.REDIS_URL);

const worker = new Worker(
  'analyze',
  async job => {
    console.log('Pokrećem analizu za:', job.data.repoUrl);
    await analyzeCode(job.data);
  },
  { connection } // <- obavezno!
);

worker.on('completed', () => console.log('✅ Job završio'));
worker.on('failed', (job, err) => console.error('❌ Job failed:', err));