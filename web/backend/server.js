const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Base path to the JSON files in the frontend public folder
const DATA_DIR = path.join(__dirname, '../frontend/public/data');

const WARD_FILES = {
  'TAY_HIEU': 'TAY_HIEU_processed.json',
  'DONG_HIEU': 'DONG_HIEU_processed.json',
  'THAI_HOA': 'THAI_HOA_processed.json'
};

app.post('/api/update-parcels', (req, res) => {
  const { updates } = req.body; 
  // expected format:
  // updates = {
  //   'TAY_HIEU': { ids: [1700510266, ...], properties: { gia_bd: 15000, ... } },
  //   'DONG_HIEU': { ... }
  // }

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  let totalUpdated = 0;

  try {
    for (const [ward, data] of Object.entries(updates)) {
      if (!WARD_FILES[ward]) continue;

      const { ids, properties } = data;
      if (!ids || !ids.length || !properties) continue;

      const filePath = path.join(DATA_DIR, WARD_FILES[ward]);
      
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
      }

      // Read current file
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const geoJson = JSON.parse(fileContent);

      let modifiedCount = 0;

      // Update features
      geoJson.features = geoJson.features.map(f => {
        // Assume THUAID is the unique identifier. Fallback to OBJECTID.
        const featureId = f.properties.THUAID || f.properties.OBJECTID;
        
        if (ids.includes(featureId)) {
          // Merge properties
          f.properties = { ...f.properties, ...properties };
          modifiedCount++;
        }
        return f;
      });

      if (modifiedCount > 0) {
        // Save back to file
        fs.writeFileSync(filePath, JSON.stringify(geoJson, null, 2), 'utf8');
        console.log(`Updated ${modifiedCount} features in ${ward}`);
        totalUpdated += modifiedCount;
      }
    }

    res.json({ success: true, totalUpdated });
  } catch (error) {
    console.error("Error updating parcels:", error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
