// @ts-nocheck

// workers/analyzeRepo.js
const simpleGit   = require('simple-git');
const tmp         = require('tmp-promise');
const { execSync }= require('child_process');
const escomplex   = require('escomplex');
const fs          = require('fs/promises');
const path        = require('path');
const Project     = require('../models/Project');
const FileStat    = require('../models/FileStat');   // kreiramo ispod

module.exports = async function analyzeRepo(job) {
  const { repoUrl, projectId, commitSha } = job.data;

  // 1. clone
  const tmpDir = await tmp.dir();
  await simpleGit().clone(repoUrl, tmpDir.path, ['--depth', '1', '--single-branch']);
  
  // 2. traverse files
  const allFiles = await getSourceFiles(tmpDir.path);      // helper niže
  const fileResults = [];

  for (const file of allFiles) {
    const code = await fs.readFile(file, 'utf-8');
    const ext  = path.extname(file);
    let metrics = {};

    if (['.js', '.ts'].includes(ext)) {
      // escomplex
      metrics = escomplex.analyse(code).aggregate;
    } else if (ext === '.py') {
      // radon cc json
      const out = execSync(`radon cc -j "${file}"`).toString();
      const json = JSON.parse(out)[file][0];   // prvi entry
      metrics = { complex: json.complexity };
    }
    fileResults.push({
      project: projectId,
      path: path.relative(tmpDir.path, file),
      loc: metrics.sloc?.physical ?? code.split('\n').length,
      complexity: metrics.cyclomatic || metrics.complex || 0,
      halsteadEffort: metrics.halstead?.effort ?? 0,
      greenScore: scoreFile(metrics)               // funkcija ispod
    });
  }

  // 3. write to Mongo
  await FileStat.deleteMany({ project: projectId, commitSha });
  await FileStat.insertMany(fileResults.map(r => ({ ...r, commitSha })));

  // 4. repo-level score (srednja vrednost – možeš menjati)
  const repoScore =
    fileResults.reduce((sum, f) => sum + f.greenScore, 0) / fileResults.length;

  await Project.findByIdAndUpdate(projectId, { greenScore: repoScore });

  // 5. cleanup
  await tmpDir.cleanup();
};

// Helpers
function scoreFile(m) {
  // jednostavna formula: start 100, penalizuj po komplexnosti/halstead
  let s = 100;
  s -= Math.min(m.complexity * 2, 50);
  s -= Math.min(m.halsteadEffort / 10000, 30);
  return Math.max(s, 0);
}

async function getSourceFiles(dir) {
  let files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(await getSourceFiles(res));
    else if (/\.(js|ts|py)$/.test(entry.name)) files.push(res);
  }
  return files;
}
