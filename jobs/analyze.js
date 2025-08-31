// @ts-nocheck

require('dotenv').config();
const simpleGit = require('simple-git');
const { glob } = require('glob');
const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const OpenAI = require('openai');

const Project = require('../models/Project');
const Analysis = require('../models/Analysis');

if (mongoose.connection.readyState === 0) {
  mongoose.connect(process.env.MONGO_URI, {
    // ⚠️ Ove opcije su deprecated, možeš ih i izostaviti
  }).then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tmpDir = path.join(__dirname, '../tmp');

// ✅ Rate limiting za OpenAI API
class RateLimiter {
  constructor(tokensPerMinute = 25000) { // Ostavljamo malo rezerve od 30k
    this.tokensPerMinute = tokensPerMinute;
    this.tokensUsed = 0;
    this.windowStart = Date.now();
    this.queue = [];
    this.processing = false;
  }

  // Proceni broj tokena u tekstu (aproksimacija: ~4 karaktera = 1 token)
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  async waitForCapacity(estimatedTokens) {
    return new Promise((resolve, reject) => {
      this.queue.push({ estimatedTokens, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      
      // Reset counter svaki minut
      if (now - this.windowStart >= 60000) {
        this.tokensUsed = 0;
        this.windowStart = now;
        console.log('🔄 Rate limit window reset');
      }

      const { estimatedTokens, resolve, reject } = this.queue[0];

      // Proveri da li imamo dovoljno kapaciteta
      if (this.tokensUsed + estimatedTokens <= this.tokensPerMinute) {
        this.tokensUsed += estimatedTokens;
        this.queue.shift();
        console.log(`✅ Rate limit OK: ${this.tokensUsed}/${this.tokensPerMinute} tokens used`);
        resolve();
      } else {
        // Sačekaj do sledećeg prozora
        const waitTime = 60000 - (now - this.windowStart);
        console.log(`⏳ Rate limit exceeded, waiting ${Math.ceil(waitTime/1000)}s...`);
        
        setTimeout(() => {
          this.tokensUsed = 0;
          this.windowStart = Date.now();
          this.processQueue();
        }, waitTime);
        
        break;
      }
    }

    this.processing = false;
  }
}

const rateLimiter = new RateLimiter();

async function analyzeCode({ repoUrl, projectId, commitSha }) {
  console.log('🎯 analyzeCode started with:', { repoUrl, projectId, commitSha });
  
  const localPath = path.join(tmpDir, projectId.toString());

  try {
    // ✅ Debug: početak procesa
    console.log('🧹 Cleaning up existing directory:', localPath);
    await fs.remove(localPath);
    await fs.ensureDir(localPath);

    const git = simpleGit();

    console.log(`📥 Cloning repo ${repoUrl} to ${localPath}...`);
    await git.clone(repoUrl, localPath);
    console.log('✅ Repository cloned successfully');

    await git.cwd({ path: localPath });
    
    if (commitSha) {
      try {
        console.log(`🔀 Checking out commit: ${commitSha}`);
        await git.checkout(commitSha);
        console.log('✅ Checkout successful');
      } catch (err) {
        console.warn(`⚠️ Nije moguće checkout-ati na ${commitSha}, preskačem.`, err.message);
      }
    }

    console.log('🔍 Searching for source files...');
    const files = await glob('**/*.{js,ts,py,java,sql}', { cwd: localPath, absolute: true });
    console.log(`📁 Found ${files.length} files to analyze`);

    if (files.length === 0) {
      console.log('⚠️ No source files found, skipping analysis');
      return;
    }

    // ✅ Ograniči broj fajlova da ne prekoračimo rate limit
    const maxFiles = 15; // Maksimalno 15 fajlova po analizi
    const filesToAnalyze = files.slice(0, maxFiles);
    
    if (files.length > maxFiles) {
      console.log(`⚠️ Limiting analysis to ${maxFiles} files (found ${files.length})`);
    }

    const results = [];

    for (let i = 0; i < filesToAnalyze.length; i++) {
      const file = filesToAnalyze[i];
      console.log(`📄 Analyzing file ${i + 1}/${filesToAnalyze.length}: ${path.basename(file)}`);
      
      const stat = await fs.stat(file);
      if (!stat.isFile()) {
        console.log(`⏭️ Skipping ${file} (not a file)`);
        continue;
      }

      let content;
      try {
        content = await fs.readFile(file, 'utf-8');
        console.log(`📖 Read ${content.length} characters from ${path.basename(file)}`);
      } catch (readError) {
        console.error(`❌ Error reading file ${file}:`, readError.message);
        continue;
      }

      // ✅ Skrati sadržaj ako je predugačak
      const maxContentLength = 6000; // Još kraći da budemo sigurni
      if (content.length > maxContentLength) {
        content = content.substring(0, maxContentLength) + '\n// ... (truncated)';
        console.log(`✂️ Truncated file content to ${maxContentLength} characters`);
      }

      const prompt = `Ocijeni ovaj fajl po ekološkoj energetskoj efikasnosti. Vrati SAMO čisti JSON u odgovoru, bez dodatnih objašnjenja ili teksta.
Vrati JSON s poljima: { "score": 0-100, "issues": ["..."] }

Kod:
\`\`\`
${content}
\`\`\`
`;

      // ✅ Proceni tokene i čekaj ako je potrebno
      const estimatedTokens = rateLimiter.estimateTokens(prompt);
      console.log(`🧮 Estimated tokens for this request: ${estimatedTokens}`);

      try {
        // ✅ Čekaj rate limit
        await rateLimiter.waitForCapacity(estimatedTokens);
        
        console.log(`🤖 Sending to OpenAI for analysis...`);
        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 200, // Ograniči odgovor
        });

        const resultTxt = response.choices[0].message.content.trim();
        console.log(`🤖 OpenAI response received`);
        
        let parsed = null;

        // Pokušaj izvući JSON između ```json i ```
        const jsonMatch = resultTxt.match(/```json\s*([\s\S]*?)```/i);

        let jsonStr;

        if (jsonMatch) {
          jsonStr = jsonMatch[1];
          console.log('📋 Found JSON in code block');
        } else {
          // fallback: pokušaj naći JSON između prve i zadnje vitičaste zagrade
          const startIdx = resultTxt.indexOf('{');
          const endIdx = resultTxt.lastIndexOf('}');
          if (startIdx === -1 || endIdx === -1) throw new Error('Nema JSON objekta u odgovoru');
          jsonStr = resultTxt.substring(startIdx, endIdx + 1);
          console.log('📋 Extracted JSON from response');
        }

        try {
          parsed = JSON.parse(jsonStr);
          console.log('✅ JSON parsed successfully:', parsed);
        } catch (parseErr) {
          console.warn(`⚠️ JSON parse greška u fajlu ${path.basename(file)}:`, parseErr.message);
          console.log('Raw JSON string:', jsonStr);
        }

        if (parsed && parsed.score !== undefined) {
          parsed.project = projectId;
          parsed.file = path.basename(file);
          if (!parsed.issues || parsed.issues.length === 0) {
            parsed.score = Math.max(parsed.score, 80);
          }
          results.push(parsed);
          console.log(`✅ Added result for ${path.basename(file)}: score ${parsed.score}`);
        } else {
          const fallbackResult = {
            project: projectId,
            file: path.basename(file),
            score: 50,
            issues: ['AI nije vratio validan JSON ili score'],
            rawResult: resultTxt.substring(0, 500)
          };
          results.push(fallbackResult);
          console.log(`⚠️ Used fallback result for ${path.basename(file)}`);
        }

      } catch (err) {
        console.error(`❌ Greška pri AI analizi fajla ${file}:`, err.message);
        
        // ✅ Specifična greška za rate limiting
        if (err.message.includes('rate_limit') || err.message.includes('429')) {
          console.log('🛑 Rate limit hit, stopping analysis for this batch');
          // Dodaj rezultate za preostale fajlove kao "skipped"
          for (let j = i; j < filesToAnalyze.length; j++) {
            results.push({
              project: projectId,
              file: path.basename(filesToAnalyze[j]),
              score: 75, // Neutral score
              issues: ['Preskočeno zbog rate limit-a'],
            });
          }
          break;
        }
        
        // Dodaj fallback rezultat
        results.push({
          project: projectId,
          file: path.basename(file),
          score: 0,
          issues: [`AI analiza neuspešna: ${err.message}`],
        });
      }

      // ✅ Kratka pauza između zahteva
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`💾 Saving ${results.length} analysis results to database...`);
    
    // Obriši postojeće analize za ovaj projekat
    const deleteResult = await Analysis.deleteMany({ project: projectId });
    console.log(`🗑️ Deleted ${deleteResult.deletedCount} existing analyses`);
    
    if (results.length > 0) {
      const insertResult = await Analysis.insertMany(results);
      console.log(`💾 Inserted ${insertResult.length} new analyses`);
    }

    console.log(`✅ Analiza završena za ${repoUrl}`);
    
    // Cleanup
    console.log('🧹 Cleaning up temporary directory...');
    await fs.remove(localPath);
    console.log('✅ Cleanup complete');
    
  } catch (error) {
    console.error('❌ Greška u analyzeCode:', error);
    console.error('Stack trace:', error.stack);
    
    // Cleanup i u slučaju greške
    try {
      await fs.remove(localPath);
    } catch (cleanupError) {
      console.error('❌ Cleanup error:', cleanupError.message);
    }
    
    throw error;
  }
}

module.exports = { analyzeCode };