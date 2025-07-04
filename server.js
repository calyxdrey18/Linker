const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb');

// --- INITIALIZE APP ---
const app = express();
const PORT = process.env.PORT || 5000;

// --- DEFINE PERSISTENT STORAGE PATHS ---
// This is the mount path we defined in render.yaml
const DATA_DIR = '/var/data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// --- ENSURE DIRECTORIES EXIST ---
// Create the uploads directory if it doesn't exist on the persistent disk
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// --- DATABASE SETUP (lowdb) ---
const adapter = new JSONFile(DB_PATH);
const defaultData = { groups: [] };
const db = new Low(adapter, defaultData);
// Read data from disk, setting db.data if the file doesn't exist
db.read().then(() => {
    if (!db.data) {
        db.data = defaultData;
        db.write();
    }
    console.log('✅ Database initialized successfully.');
});


// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend files from the 'public' directory
app.use(express.static('public'));
// **Crucially, serve the uploaded images from the persistent disk**
app.use('/uploads', express.static(UPLOADS_DIR));

// --- MULTER SETUP (for file uploads) ---
const storage = multer.diskStorage({
  // Save files directly to our persistent uploads directory
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  // Create a unique filename to avoid overwrites
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// --- API ROUTES ---

// GET /api/groups - Fetch all groups, with search functionality
app.get('/api/groups', async (req, res) => {
  await db.read(); // Make sure we have the latest data
  const searchQuery = (req.query.q || '').toLowerCase();
  
  let groups = db.data.groups || [];

  if (searchQuery) {
    groups = groups.filter(g => 
        g.groupName.toLowerCase().includes(searchQuery) || 
        g.username.toLowerCase().includes(searchQuery)
    );
  }

  // Sort by newest first
  const sortedGroups = groups.sort((a, b) => b.createdAt - a.createdAt);
  res.status(200).json(sortedGroups);
});

// POST /api/groups - Add a new group
app.post('/api/groups', upload.single('groupImage'), async (req, res) => {
    try {
        await db.read();
        const { username, groupName, groupLink } = req.body;

        if (!username || !groupName || !groupLink) {
        return res.status(400).json({ error: 'Username, Group Name, and Link are required.' });
        }

        const newGroup = {
            id: Date.now(),
            username,
            groupName,
            groupLink,
            // The public path to the image, which we serve via express.static
            imagePath: req.file ? `/uploads/${req.file.filename}` : null,
            createdAt: Date.now(),
        };

        db.data.groups.push(newGroup);
        await db.write();

        res.status(201).json(newGroup);
    } catch (error) {
        console.error('Error adding group:', error);
        res.status(500).json({ error: 'Server error while adding group.' });
    }
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});

