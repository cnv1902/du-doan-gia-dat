const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const compression = require('compression');
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const { Transform } = require('stream');

const app = express();
app.use(cors());
app.use(compression());
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
  // Prevent PM2 cluster workers from seeding simultaneously (race condition leading to duplicate data)
  if (process.env.pm_id !== undefined && process.env.pm_id !== '0') {
    console.log('Worker is not instance 0. Skipping seed check to avoid race conditions.');
    return;
  }

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
app.get('/api/parcels', (req, res) => {
  const { ward } = req.query;
  if (!ward) {
    return res.status(400).json({ error: 'ward query parameter is required' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.write('{"type":"FeatureCollection","features":[');

  const cursor = Parcel.find({ ward }, { _id: 0, type: 1, properties: 1, geometry: 1 }).lean().cursor();
  let first = true;

  cursor.on('data', (doc) => {
    if (!first) res.write(',');
    first = false;
    res.write(JSON.stringify(doc));
  });

  cursor.on('end', () => {
    res.write(']}');
    res.end();
  });

  cursor.on('error', (error) => {
    console.error("Error fetching parcels:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.end();
    }
  });
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


// GET /api/export-excel - Xuất toàn bộ dữ liệu ra Excel
app.get('/api/export-excel', async (req, res) => {
  try {
    // Tìm TẤT CẢ các khóa (cột) tồn tại trong properties của toàn bộ dữ liệu
    const keysAggr = await Parcel.aggregate([
      { $match: { properties: { $exists: true, $type: 'object' } } },
      { $project: { keys: { $objectToArray: "$properties" } } },
      { $unwind: "$keys" },
      { $group: { _id: "$keys.k" } }
    ]);
    
    let propKeys = keysAggr.map(k => k._id).filter(k => k !== '_layerRef');

    // Đảm bảo luôn có cột gia_bd
    if (!propKeys.includes('gia_bd')) {
      propKeys.push('gia_bd');
    }
    
    if (propKeys.length === 0) {
      return res.status(404).send('Không có dữ liệu thuộc tính');
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="DuLieu_GiaDat.xlsx"');

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
    const worksheet = workbook.addWorksheet('GiaDat');

    const headers = ['PHUONG_XA', ...propKeys.map(k => k === 'gia_bd' ? 'GIA_BD' : k)];
    
    worksheet.columns = headers.map(h => ({ header: h, key: h }));

    const cursor = Parcel.find({}, { properties: 1, ward: 1, _id: 0 }).lean().cursor();

    cursor.on('data', (doc) => {
      let wardValue = doc.ward;
      if (wardValue === 'TAY_HIEU') wardValue = 'is_TayHieu';
      if (wardValue === 'DONG_HIEU') wardValue = 'isDongHieu';
      if (wardValue === 'THAI_HOA') wardValue = 'isThaiHoa';

      const row = {
        'PHUONG_XA': wardValue
      };
      if (doc.properties) {
        propKeys.forEach(k => {
          const colKey = k === 'gia_bd' ? 'GIA_BD' : k;
          row[colKey] = doc.properties[k] !== undefined ? doc.properties[k] : '';
        });
      }
      worksheet.addRow(row).commit();
    });

    cursor.on('end', () => {
      worksheet.commit();
      workbook.commit();
    });

    cursor.on('error', (err) => {
      console.error('Lỗi khi xuất excel:', err);
      if (!res.headersSent) {
        res.status(500).send('Lỗi máy chủ');
      }
    });

  } catch (error) {
    console.error('Lỗi xuất excel:', error);
    if (!res.headersSent) {
      res.status(500).send('Lỗi máy chủ');
    }
  }
});

// GET /api/export-gis - Xuất toàn bộ dữ liệu ra 3 file GeoJSON (nén trong 1 file ZIP)
app.get('/api/export-gis', async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="DuLieu_GIS.zip"');

    const archive = new archiver.ZipArchive({
      zlib: { level: 9 } // Mức độ nén tối đa
    });

    archive.on('error', (err) => {
      console.error('Archiver error:', err);
      if (!res.headersSent) {
        res.status(500).send('Lỗi máy chủ');
      }
      res.end();
    });

    archive.pipe(res);

    const wards = ['TAY_HIEU', 'DONG_HIEU', 'THAI_HOA'];

    for (const ward of wards) {
      let isFirst = true;
      const transform = new Transform({
        objectMode: true,
        transform(doc, encoding, callback) {
          let str = '';
          if (isFirst) {
            str += '{"type":"FeatureCollection","features":[';
            isFirst = false;
          } else {
            str += ',';
          }

          if (doc.properties && doc.properties.gia_bd !== undefined) {
            doc.properties.GIA_BD = doc.properties.gia_bd;
            delete doc.properties.gia_bd;
          }

          str += JSON.stringify({
            type: doc.type || 'Feature',
            geometry: doc.geometry,
            properties: doc.properties
          });

          callback(null, str);
        },
        flush(callback) {
          if (isFirst) {
            // Nếu không có dữ liệu nào
            callback(null, '{"type":"FeatureCollection","features":[]}');
          } else {
            callback(null, ']}');
          }
        }
      });

      // Tạo con trỏ stream từ DB
      const cursor = Parcel.find({ ward }, { type: 1, geometry: 1, properties: 1, _id: 0 }).lean().cursor();
      
      // Bắt lỗi từ DB cursor
      cursor.on('error', (err) => {
        console.error(`Cursor error for ward ${ward}:`, err);
        transform.emit('error', err);
      });

      // Kết nối DB -> Transform
      cursor.pipe(transform);

      // Đưa luồng này vào file zip tương ứng
      archive.append(transform, { name: `${ward}.geojson` });
    }

    archive.finalize();
  } catch (error) {
    console.error('Lỗi xuất GIS:', error);
    if (!res.headersSent) {
      res.status(500).send('Lỗi máy chủ');
    }
  }
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
