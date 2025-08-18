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

async function analyzeCode({ repoUrl, projectId, commitSha }) {
  const localPath = path.join(tmpDir, projectId.toString());

  try {
    await fs.remove(localPath);
    await fs.ensureDir(localPath);

    const git = simpleGit();

    console.log(`Cloning repo ${repoUrl}...`);
    await git.clone(repoUrl, localPath);

    await git.cwd({ path: localPath });
    if (commitSha) {
  try {
    await git.checkout(commitSha);
  } catch (err) {
    console.warn(`⚠️ Nije moguće checkout-ati na ${commitSha}, preskačem.`, err.message);
    // Nastavi bez checkouta ili eventualno uradi fallback na default branch
  }
}

    const files = await glob('**/*.{js,ts,py,java,sql}', { cwd: localPath, absolute: true });

    const results = [];

    for (const file of files) {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;

      const content = await fs.readFile(file, 'utf-8');

      const prompt = `Ocijeni ovaj fajl po ekološkoj energetskoj efikasnosti. Vrati SAMO čisti JSON u odgovoru, bez dodatnih objašnjenja ili teksta.
Vrati JSON s poljima: { "score": 0-100, "issues": ["..."] }

Kod:
\`\`\`
${content}
\`\`\`
`;

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        });

        const resultTxt = response.choices[0].message.content.trim();
        let parsed = null;

        
        // Pokušaj izvući JSON između ```json i ```
        const jsonMatch = resultTxt.match(/```json\s*([\s\S]*?)```/i);

        let jsonStr;

        if (jsonMatch) {
          jsonStr = jsonMatch[1]; // ovo je čist JSON string
        } else {
          // fallback: pokušaj naći JSON između prve i zadnje vitičaste zagrade
          const startIdx = resultTxt.indexOf('{');
          const endIdx = resultTxt.lastIndexOf('}');
          if (startIdx === -1 || endIdx === -1) throw new Error('Nema JSON objekta u odgovoru');
          jsonStr = resultTxt.substring(startIdx, endIdx + 1);
        }

        try {
          parsed = JSON.parse(jsonStr);
        } catch (parseErr) {
          console.warn(`⚠️ JSON parse greška u fajlu ${path.basename(file)}:`, parseErr.message);
        }

        if (parsed) {
          parsed.project = projectId;
          parsed.file = path.basename(file);
          if (parsed.issues.length === 0) {
            parsed.score = 100;
          }
          results.push(parsed);
        } else {
          results.push({
            project: projectId,
            file: parsed.file,
            score: 0,
            issues: ['AI nije vratio validan JSON'],
            rawResult: resultTxt
          });
        }
      } catch (err) {
        console.error(`❌ Greška pri AI analizi fajla ${file}:`, err.message);
      }
    }

    await Analysis.deleteMany({ project: projectId });
    await Analysis.insertMany(results);

    console.log(`✅ Analiza završena za ${repoUrl}`);
  } catch (error) {
    console.error('❌ Greška u analyzeCode:', error);
    throw error;
  }
}

module.exports = { analyzeCode };
