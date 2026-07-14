const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));


// Mongoose Configuration
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/land-pricing';

const parcelSchema = new mongoose.Schema({
  ward: { type: String, required: true, index: true },
  type: { type: String, default: 'Feature' },
  properties: { type: mongoose.Schema.Types.Mixed },
  geometry: { type: mongoose.Schema.Types.Mixed }
});

const Parcel = mongoose.model('Parcel', parcelSchema);

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    checkAndSeedData();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// Seed data function
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../frontend/public/data');
const WARD_FILES = {
  'TAY_HIEU': 'TAY_HIEU_processed.json',
  'DONG_HIEU': 'DONG_HIEU_processed.json',
  'THAI_HOA': 'THAI_HOA_processed.json'
};

async function checkAndSeedData() {
  try {
    const count = await Parcel.countDocuments();
    if (count > 0) {
      console.log(`Database already has ${count} parcels. Skipping seed.`);
      return;
    }

    console.log('Database is empty. Seeding data from JSON files... (This may take a while)');

    for (const [ward, filename] of Object.entries(WARD_FILES)) {
      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) {
        console.warn(`Seed file not found: ${filePath}`);
        continue;
      }

      console.log(`Reading ${filename}...`);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const geoJson = JSON.parse(fileContent);

      if (geoJson.features && Array.isArray(geoJson.features)) {
        const docs = geoJson.features.map(f => ({
          ward: ward,
          type: f.type,
          properties: f.properties,
          geometry: f.geometry
        }));

        // Insert in batches of 5000 to avoid memory overload
        const batchSize = 5000;
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = docs.slice(i, i + batchSize);
          await Parcel.insertMany(batch);
          console.log(`Inserted ${Math.min(i + batchSize, docs.length)} / ${docs.length} parcels for ${ward}`);
        }
        console.log(`Successfully seeded ${ward}.`);
      }
    }
    console.log('Database seeding completed.');
  } catch (error) {
    console.error('Error during database seeding:', error);
  }
}

// GET /api/parcels - Fetch all parcels for a specific ward
app.get('/api/parcels', async (req, res) => {
  const { ward } = req.query;
  if (!ward) {
    return res.status(400).json({ error: 'ward query parameter is required' });
  }

  try {
    // We only need type, properties and geometry
    const parcels = await Parcel.find({ ward }, { _id: 0, type: 1, properties: 1, geometry: 1 }).lean();
    
    res.json({
      type: "FeatureCollection",
      features: parcels
    });
  } catch (error) {
    console.error("Error fetching parcels:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/update-parcels - Update properties of multiple parcels
app.post('/api/update-parcels', async (req, res) => {
  const { updates } = req.body; 
  // expected format:
  // updates = {
  //   'TAY_HIEU': { ids: [1700510266, ...], properties: { gia_bd: 15000, ... } },
  //   ...
  // }

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  let totalUpdated = 0;

  try {
    // Generate the $set object for mongoose update
    for (const [ward, data] of Object.entries(updates)) {
      const { ids, properties } = data;
      if (!ids || !ids.length || !properties) continue;

      const setOps = {};
      for (const [key, val] of Object.entries(properties)) {
        setOps[`properties.${key}`] = val;
      }

      // MongoDB updateMany matching the ward and the THUAID or OBJECTID
      // This is a bit tricky if they can have either THUAID or OBJECTID as ID. 
      // We will match either one that is in the ids array.
      const result = await Parcel.updateMany(
        { 
          ward: ward, 
          $or: [
            { "properties.THUAID": { $in: ids } },
            { "properties.OBJECTID": { $in: ids } }
          ]
        },
        { $set: setOps }
      );

      console.log(`Updated ${result.modifiedCount} features in ${ward}`);
      totalUpdated += result.modifiedCount;
    }

    res.json({ success: true, totalUpdated });
  } catch (error) {
    console.error("Error updating parcels:", error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});


const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
