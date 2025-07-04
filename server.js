const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb');

// --- DEFINE CRUCIAL PATHS ---
// Render's persistent disk is mounted at the path defined in render.yaml
const DATA_DIR = '/var/data';
// We'll store uploaded images in a sub-folder on the persistent disk
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
// The path to our JSON database file on the persistent disk
const DB_PATH = path.join(DATA_DIR, 'db.json');

// --- ENSURE DIRECTORIES EXIST ON STARTUP ---
// This is important because the disk might be empty on first boot.
if (!fs.existsSync(UPLOADS_DIR)) {
  console.log(`Creating persistent uploads directory at: ${UPLOADS_DIR}`);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// --- ASYNCHRONOUS SERVER START FUNCTION ---
// We wrap our entire setup in an async function to safely `await` the database.
async function startServer() {
    // --- DATABASE SETUP (lowdb) ---
    console.log(`Initializing database from: ${DB_PATH}`);
    const adapter = new JSONFile(DB_PATH);
    const defaultData = { groups: [] };
    const db = new Low(adapter, defaultData);

    // CRITICAL: Await for the database to be read from the disk before proceeding.
    // This prevents race conditions where the app tries to access db.data before it's loaded.
    await db.read();
    // If the db file doesn't exist, db.data will be null. We must initialize it.
    db.data = db.data || defaultData;
    await db.write(); // This ensures the file is created if it was missing.
    console.log('✅ Database initialized successfully.');

    // --- INITIALIZE EXPRESS APP ---
    const app = express();
    const PORT = process.env.PORT || 5000;

    // --- MIDDLEWARE ---
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Serve the static frontend files (index.html, etc.) from the 'public' folder.
    app.use(express.static('public'));
    // Serve the uploaded images directly from our persistent disk's 'uploads' folder.
    app.use('/uploads', express.static(UPLOADS_DIR));

    // --- MULTER SETUP (for file uploads) ---
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR); // Save files directly to our persistent uploads directory
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
      }
    });
    const upload = multer({ storage: storage });

    // --- API ROUTES ---

    // Health Check Route: Render uses this to verify the service is running.
    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'ok', message: 'Server is healthy' });
    });

    // GET all groups, with search
    app.get('/api/groups', async (req, res) => {
      await db.read(); // Always get the latest data
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
        try {
            await db.read();
            const { username, groupName, groupLink } = req.body;

            if (!username || !groupName || !groupLink) {
                return res.status(400).json({ error: 'All fields are required.' });
            }
            if (!groupLink.startsWith('https://chat.whatsapp.com/')) {
                return res.status(400).json({ error: 'Please enter a valid WhatsApp group link.' });
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
        } catch (error) {
            console.error('❌ Error adding group:', error);
            res.status(500).json({ error: 'Server error while adding group.' });
        }
    });

    // --- START LISTENING FOR REQUESTS ---
    // This only runs after the database is confirmed to be ready.
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT} and listening for requests.`);
    });
}

// --- EXECUTE THE SERVER STARTUP ---
startServer().catch(err => {
    console.error('❌ Failed to start server:', err);
});