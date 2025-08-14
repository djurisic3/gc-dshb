const mongoose = require('mongoose');

const analysisSchema = new mongoose.Schema({
  file: String,
  score: Number,
  issues: [String],
  project: mongoose.Schema.Types.ObjectId
});

module.exports = mongoose.model('Analysis', analysisSchema);
