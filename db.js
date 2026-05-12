const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'optinkedin.db');

let _db = null;

async function getDb() {
  if (_db) return _db;

  const SQL = await initSqlJs();

  // Charger le fichier existant ou créer une nouvelle base
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    // Créer le dossier data si absent
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new SQL.Database();
  }

  // Initialisation du schéma
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      linkedin_id TEXT UNIQUE NOT NULL,
      name TEXT,
      email TEXT,
      access_token TEXT,
      score INTEGER,
      paid INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  persist();
  return _db;
}

/** Persiste la base en mémoire sur disque */
function persist() {
  if (!_db) return;
  const data = _db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Wrapper exec (DDL/DML sans résultat) */
function run(sql, params = []) {
  _db.run(sql, params);
  persist();
}

/** Retourne la première ligne ou undefined */
function get(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

/** Retourne toutes les lignes */
function all(sql, params = []) {
  const results = [];
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

module.exports = { getDb, run, get, all, persist };