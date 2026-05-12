/**
 * Passport.js configuration for LinkedIn OAuth 2.0
 * Uses passport-linkedin-oauth2 strategy.
 *
 * HYPOTHÈSE: On demande les scopes "openid", "profile" et "email"
 * disponibles sur l'API LinkedIn v2 (Marketing Developer Platform).
 * Si l'app n'a pas accès à "email", retirer ce scope et adapter.
 */

const passport = require('passport');
const { Strategy: LinkedInStrategy } = require('passport-linkedin-oauth2');
const db = require('../db');

passport.use(
  new LinkedInStrategy(
    {
      clientID: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      callbackURL: process.env.LINKEDIN_CALLBACK_URL,
      scope: ['openid', 'profile', 'email'],
    },
    function verify(accessToken, refreshToken, profile, done) {
      try {
        // Extraire les données essentielles du profil LinkedIn
        const linkedinId = profile.id;
        const displayName = profile.displayName || '';
        const email =
          (profile.emails && profile.emails[0] && profile.emails[0].value) ||
          null;
        const photoUrl =
          (profile.photos && profile.photos[0] && profile.photos[0].value) ||
          null;
        const headline = profile._json?.headline || null;
        const vanityName = profile._json?.vanityName || null;

        // Upsert utilisateur en base SQLite
        const existing = db
          .prepare('SELECT * FROM users WHERE linkedin_id = ?')
          .get(linkedinId);

        if (existing) {
          // Mettre à jour le token et les infos de profil
          db.prepare(
            `UPDATE users
             SET access_token = ?, display_name = ?, email = ?,
                 photo_url = ?, headline = ?, vanity_name = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE linkedin_id = ?`
          ).run(
            accessToken,
            displayName,
            email,
            photoUrl,
            headline,
            vanityName,
            linkedinId
          );

          const updated = db
            .prepare('SELECT * FROM users WHERE linkedin_id = ?')
            .get(linkedinId);
          return done(null, updated);
        } else {
          // Créer un nouvel utilisateur
          db.prepare(
            `INSERT INTO users
             (linkedin_id, access_token, display_name, email,
              photo_url, headline, vanity_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            linkedinId,
            accessToken,
            displayName,
            email,
            photoUrl,
            headline,
            vanityName
          );

          const created = db
            .prepare('SELECT * FROM users WHERE linkedin_id = ?')
            .get(linkedinId);
          return done(null, created);
        }
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Sérialiser uniquement l'id interne en session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Désérialiser depuis la base à chaque requête authentifiée
passport.deserializeUser((id, done) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;