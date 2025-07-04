const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb');

// --- DEFINE CRUCIAL PATHS ---
// Render's persistent disk is ALWAYS mounted at the path defined in render.yaml
const DATA_DIR = '/var/data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// --- ENSURE DIRECTORIES EXIST ON STARTUP ---
// This is critical because the disk is empty on the very first boot.
if (!fs.existsSync(UPLOADS_DIR)) {
  console.log(`Persistent directory not found. Creating: ${UPLOADS_DIR}`);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// --- ASYNCHRONOUS SERVER START FUNCTION ---
// By wrapping our setup in an async function, we can safely `await` the database
// initialization before accepting any traffic, preventing race conditions.
async function startServer() {
    // --- DATABASE SETUP (lowdb) ---
    console.log(`Initializing database from persistent storage: ${DB_PATH}`);
    const adapter = new JSONFile(DB_PATH);
    const defaultData = { groups: [] };
    const db = new Low(adapter, defaultData);

    // CRITICAL FIX: Await for the database to be fully read from the disk.
    // This is the most common point of failure.
    await db.read();
    
    // If the db file didn't exist, db.data will be null. We must initialize it.
    if (!db.data) {
        db.data = defaultData;
        await db.write(); // This creates the db.json file if it's the first boot.
        console.log('New database file created with default data.');
    }
    console.log('✅ Database initialized and ready.');

    // --- INITIALIZE EXPRESS APP ---
    const app = express();
    const PORT = process.env.PORT || 5000;

    // --- MIDDLEWARE ---
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use(express.static('public'));
    // Serve uploaded images from our persistent disk's 'uploads' folder
    app.use('/uploads', express.static(UPLOADS_DIR));

    // --- MULTER SETUP ---
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOADS_DIR),
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
      }
    });
    const upload = multer({ storage: storage });

    // --- API ROUTES ---

    // Health Check Route: Render pings this to verify the service is running.
    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'ok' });
    });

    // GET all groups
    app.get('/api/groups', async (req, res) => {
      await db.read(); // Always get latest data
      const searchQuery = (req.query.q || '').toLowerCase();
      let groups = db.data.groups || [];
      if (searchQuery) {
        groups = groups.filter(g => 
            g.groupName.toLowerCase().includes(searchQuery) || 
            g.username.toLowerCase().includes(searchQuery)
        );
      }
      res.status(200).json(groups.sort((a, b) => b.createdAt - a.createdAt));
    });

    // POST a new group
    app.post('/api/groups', upload.single('groupImage'), async (req, res) => {
        await db.read();
        const { username, groupName, groupLink } = req.body;
        // Basic validation
        if (!username || !groupName || !groupLink) {
            return res.status(400).json({ error: 'All fields are required.' });
        }
        const newGroup = {
            id: Date.now(),
            username,
            groupName,
            groupLink,
            imagePath: req.file ? `/uploads/${req.file.filename}` : null,
            createdAt: Date.now(),
        };
        db.data.groups.push(newGroup);
        await db.write();
        res.status(201).json(newGroup);
    });

    // --- START LISTENING FOR REQUESTS ---
    // This code only runs after the database is confirmed to be ready.
    app.listen(PORT, () => {
      console.log(`🚀 Server is listening on port ${PORT}.`);
    });
}

// --- EXECUTE THE SERVER STARTUP ---
startServer().catch(err => {
    console.error('❌ FATAL: Failed to start server:', err);
    process.exit(1);
});
