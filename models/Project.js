const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: String,
  url: String,
  description: String,
  stars: Number,
  forks: Number,
  language: String,
  updated_at: Date,
  greenScore: Number,
  lastSha: String
});

module.exports = mongoose.model('Project', projectSchema);
