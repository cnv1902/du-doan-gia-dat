const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'frontend', 'public', 'data');

const WARD_FILES = {
  TAY_HIEU: 'TAY_HIEU_processed.json',
  DONG_HIEU: 'DONG_HIEU_processed.json',
  THAI_HOA: 'THAI_HOA_processed.json'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { updates } = req.body || {};

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  let totalUpdated = 0;

  try {
    for (const [ward, data] of Object.entries(updates)) {
      if (!WARD_FILES[ward]) continue;

      const { ids, properties } = data || {};
      if (!Array.isArray(ids) || ids.length === 0 || !properties) continue;

      const filePath = path.join(DATA_DIR, WARD_FILES[ward]);
      if (!fs.existsSync(filePath)) continue;

      const geoJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let modifiedCount = 0;

      geoJson.features = geoJson.features.map((feature) => {
        const featureId = feature?.properties?.THUAID || feature?.properties?.OBJECTID;
        if (ids.includes(featureId)) {
          feature.properties = { ...feature.properties, ...properties };
          modifiedCount += 1;
        }
        return feature;
      });

      if (modifiedCount > 0) {
        fs.writeFileSync(filePath, JSON.stringify(geoJson, null, 2), 'utf8');
        totalUpdated += modifiedCount;
      }
    }

    return res.status(200).json({ success: true, totalUpdated });
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};