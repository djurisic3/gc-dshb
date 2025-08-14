// models/FileStat.js
const mongoose = require('mongoose');
const FileStatSchema = new mongoose.Schema({
  project:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  commitSha:  String,
  path:       String,
  loc:        Number,
  complexity: Number,
  halsteadEffort: Number,
  greenScore: Number,
});
module.exports = mongoose.model('FileStat', FileStatSchema);
