/**
 * Initialisation de la base de données SQLite via better-sqlite3.
 * Ce module crée les tables si elles n'existent pas (migrations simples).
 *
 * Tables :
 *  - users       : données LinkedIn + token + statut paiement
 *  - scores      : historique des scores générés par l'IA
 */

const Database = require('better-sqlite3');
const path = require('path');

// HYPOTHÈSE: Le fichier DB est stocké à la racine du projet.
// En production, pointer vers un volume persistant.
const DB_PATH = path.join(__dirname, 'optinkedin.db');

const db = new Database(DB_PATH);

// Activer le mode WAL pour de meilleures performances en lecture concurrente
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Migrations / création des tables ────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_id     TEXT    NOT NULL UNIQUE,
    access_token    TEXT    NOT NULL,
    display_name    TEXT,
    email           TEXT,
    photo_url       TEXT,
    headline        TEXT,
    vanity_name     TEXT,
    -- Indique si l'utilisateur a acheté l'accès aux recommandations complètes
    has_paid        INTEGER NOT NULL DEFAULT 0,
    -- Date du paiement (NULL si pas encore payé)
    paid_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Score sur 100 calculé par l'IA
    score           INTEGER NOT NULL,
    -- Résumé court renvoyé à tous les utilisateurs (gratuit)
    summary         TEXT,
    -- Recommandations détaillées (réservées aux utilisateurs ayant payé)
    recommendations TEXT,
    -- Données brutes du profil LinkedIn au moment du calcul (JSON)
    profile_snapshot TEXT,
    created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;