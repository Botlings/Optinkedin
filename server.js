require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'optinkedin-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Initialiser la DB au démarrage
getDb().then(() => {
  console.log('✅ Base de données initialisée');
}).catch(err => {
  console.error('❌ Erreur DB:', err);
  process.exit(1);
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Optinkedin démarré sur http://localhost:${PORT}`);
});