require('dotenv').config();
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { analyzeCode } = require('./jobs/analyze');

// 🔌 Redis konekcija
const connection = new IORedis({
  host: '127.0.0.1', // ili 'localhost'
  port: 6379,        // default port
  maxRetriesPerRequest: null,
  // password: 'ako si postavio', 
});

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