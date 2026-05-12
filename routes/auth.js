const express = require('express');
const axios = require('axios');
const { getDb, run, get } = require('../db');
const router = express.Router();

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/linkedin/callback';

// Étape 1 : Redirection vers LinkedIn
router.get('/linkedin', (req, res) => {
  const state = Math.random().toString(36).substring(2);
  req.session.oauthState = state;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: 'openid profile email'
  });

  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

// Étape 2 : Callback OAuth
router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect('/?error=oauth_denied');
  }

  if (state !== req.session.oauthState) {
    return res.redirect('/?error=invalid_state');
  }

  try {
    // Échange du code contre un access token
    const tokenResponse = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    // Récupération du profil LinkedIn (API OpenID)
    const profileResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const profile = profileResponse.data;
    const linkedinId = profile.sub;
    const name = profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim();
    const email = profile.email || null;

    // Initialiser DB et upsert utilisateur
    await getDb();
    const existing = get('SELECT * FROM users WHERE linkedin_id = ?', [linkedinId]);

    if (existing) {
      run('UPDATE users SET name = ?, email = ?, access_token = ? WHERE linkedin_id = ?',
        [name, email, accessToken, linkedinId]);
    } else {
      run('INSERT INTO users (linkedin_id, name, email, access_token) VALUES (?, ?, ?, ?)',
        [linkedinId, name, email, accessToken]);
    }

    const user = get('SELECT * FROM users WHERE linkedin_id = ?', [linkedinId]);
    req.session.userId = user.id;
    req.session.linkedinId = linkedinId;

    res.redirect('/dashboard');
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/?error=oauth_failed');
  }
});

// Déconnexion
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;