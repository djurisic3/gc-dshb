const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Povezano sa MongoDB');
  } catch (error) {
    console.error('❌ Greška pri konekciji:', error);
  }
}

module.exports = connectDB;
