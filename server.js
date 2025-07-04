const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // We still need fs for other potential uses, but not mkdir.
const multer = require('multer');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb');

// --- DEFINE CRUCIAL PATHS ---
const DATA_DIR = '/var/data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// --- ASYNCHRONOUS SERVER START FUNCTION ---
async function startServer() {
    // --- DATABASE SETUP (lowdb) ---
    console.log(`Initializing database from: ${DB_PATH}`);
    const adapter = new JSONFile(DB_PATH);
    const defaultData = { groups: [] };
    const db = new Low(adapter, defaultData);
    
    await db.read();
    db.data = db.data || defaultData;
    await db.write();
    console.log('✅ Database initialized successfully.');

    // --- INITIALIZE EXPRESS APP ---
    const app = express();
    const PORT = process.env.PORT || 5000;

    // --- MIDDLEWARE ---
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static('public'));
    app.use('/uploads', express.static(UPLOADS_DIR));

    // --- MULTER SETUP (for file uploads) ---
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR); // This will now always succeed because the folder exists.
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
      }
    });
    const upload = multer({ storage: storage });

    // --- API ROUTES ---
    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'ok', message: 'Server is healthy' });
    });

    app.get('/api/groups', async (req, res) => {
      await db.read();
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
                username, groupName, groupLink,
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
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT} and listening for requests.`);
    });
}

// --- EXECUTE THE SERVER STARTUP ---
startServer().catch(err => {
    console.error('❌ Failed to start server:', err);
});
