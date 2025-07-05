require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const app = express();
const port = process.env.PORT || 3000;

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer config (store files in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.static('public'));

// Store image URLs in memory (use DB for production)
let images = [];

// Upload endpoint
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).send('No image uploaded');
  try {
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload_stream(
      { folder: "uploads" },
      (error, result) => {
        if (error) return res.status(500).send('Cloud upload failed');
        images.push(result.secure_url);
        res.json({ url: result.secure_url });
      }
    );
    // Pipe file buffer to Cloudinary
    require('streamifier').createReadStream(req.file.buffer).pipe(result);
  } catch (err) {
    res.status(500).send('Upload failed');
  }
});

// Get all images
app.get('/images', (req, res) => {
  res.json(images);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
