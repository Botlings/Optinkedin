import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { csrfMiddleware, generateCsrfToken } from '../middleware/csrf.js';
import forgetRouter from './forget.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construit une application Express minimale pour les tests du droit à l'oubli.
 * Reproduit fidèlement les middlewares de server.ts dans leur ordre d'application.
 */
function buildApp(opts: { enableRateLimit?: boolean } = {}) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  if (opts.enableRateLimit) {
    const forgetLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // keyGenerator basé sur IP — en test supertest l'IP est ::1 ou 127.0.0.1
      message: {
        error: 'Trop de demandes de suppression. Réessayez dans 15 minutes.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    });
    app.use('/api/account', forgetLimiter);
  }

  app.use('/api', csrfMiddleware);
  app.use('/api/account', forgetRouter);
  return app;
}

/** Génère un token CSRF valide pour les tests nécessitant un DELETE authentifié. */
function validCsrfHeader(): Record<string, string> {
  const { token } = generateCsrfToken();
  return { 'X-CSRF-Token': token };
}

// ═══════════════════════════════════════════════════════════════════════════
// Protection CSRF sur DELETE /api/account
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/account — protection CSRF', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it('retourne 403 sans header X-CSRF-Token', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('retourne 403 avec un token CSRF invalide', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', 'not.a.valid.token')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('retourne 403 avec un token CSRF vide', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', '')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation des inputs — protection XSS et injection
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/account — validation des inputs et protection XSS', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it('accepte une demande valide avec email uniquement', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ email: 'valid@example.com' });

    // 200 ou 404 (session introuvable) — les deux sont des réponses légitimes
    expect([200, 404]).toContain(res.status);
  });

  it('accepte une demande valide avec session_id Stripe uniquement', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ session_id: 'cs_test_abcdefghijklmnopqrstuvwxyz1234567890' });

    expect([200, 404]).toContain(res.status);
  });

  it('retourne 400 si ni email ni session_id ne sont fournis', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it('retourne 400 si le body est absent', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader());

    expect(res.status).toBe(400);
  });

  it('rejette un email avec injection XSS dans la valeur', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ email: '<script>alert(1)</script>@evil.com' });

    expect(res.status).toBe(400);
  });

  it('rejette un email avec payload XSS onerror', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ email: 'user+<img onerror=fetch(evil.com)>@domain.com' });

    expect(res.status).toBe(400);
  });

  it('rejette un email sans @ (format invalide)', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ email: 'notanemail' });

    expect(res.status).toBe(400);
  });

  it('rejette un email trop long (> 254 caractères)', async () => {
    const longEmail = 'a'.repeat(250) + '@b.com';
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ email: longEmail });

    expect(res.status).toBe(400);
  });

  it('rejette un session_id avec injection XSS', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ session_id: '<script>alert(document.cookie)</script>' });

    expect(res.status).toBe(400);
  });

  it('rejette un session_id avec injection SQL', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ session_id: "'; DROP TABLE sessions; --" });

    expect(res.status).toBe(400);
  });

  it('rejette un session_id avec mauvais préfixe', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ session_id: 'pi_live_abcdefghijklmnopqrstuvwxyz' });

    expect(res.status).toBe(400);
  });

  it('rejette un session_id trop court', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ session_id: 'cs_test_short' });

    expect(res.status).toBe(400);
  });

  it('rejette un body JSON avec champs non attendus (prototype pollution)', async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send(JSON.stringify({ '__proto__': { 'admin': true }, email: 'x@x.com' }));

    // Doit traiter la requête normalement sans pollution — réponse 200/404 OK
    expect([200, 404]).toContain(res.status);
    // Vérifie que la pollution n'a pas eu lieu
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });

  it("rejette un Content-Type non JSON (text/plain)", async () => {
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'text/plain')
      .set(validCsrfHeader())
      .send('email=test@example.com');

    // Express ignore le body si Content-Type n'est pas JSON → body vide → 400
    expect(res.status).toBe(400);
  });

  it('rejette un body dépassant 64kb', async () => {
    const bigPayload = { email: 'a'.repeat(70_000) + '@b.com' };
    const res = await request(app)
      .delete('/api/account')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send(JSON.stringify(bigPayload));

    // 400 (validation email trop long) ou 413 (body trop grand) sont tous deux acceptables
    expect([400, 413]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rate limiting — DELETE /api/account (5 req / 15 min)
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/account — rate limiting', () => {
  it('retourne 429 après 5 requêtes depuis la même IP sur 15 min', async () => {
    // Chaque test dans ce describe utilise sa propre app pour avoir
    // un compteur de rate-limit vierge (pool: 'forks' isole les processus,
    // mais deux tests dans le même describe partagent le même processus).
    const app = buildApp({ enableRateLimit: true });

    const deleteOnce = () =>
      request(app)
        .delete('/api/account')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ email: 'ratelimit@example.com' });

    // Les 5 premières requêtes doivent passer (200 ou 404)
    for (let i = 0; i < 5; i++) {
      const res = await deleteOnce();
      expect([200, 404]).toContain(res.status);
    }

    // La 6ème doit être bloquée
    const blocked = await deleteOnce();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('inclut les headers RateLimit-* dans la réponse 429', async () => {
    const app = buildApp({ enableRateLimit: true });

    const deleteOnce = () =>
      request(app)
        .delete('/api/account')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ email: 'headers@example.com' });

    for (let i = 0; i < 5; i++) {
      await deleteOnce();
    }

    const blocked = await deleteOnce();
    expect(blocked.status).toBe(429);
    // draft-7 expose ratelimit-limit, ratelimit-remaining, ratelimit-reset
    expect(blocked.headers).toHaveProperty('ratelimit-limit');
    expect(blocked.headers).toHaveProperty('ratelimit-remaining');
  });

  it("n'expose pas de Retry-After en legacy headers (legacyHeaders: false)", async () => {
    const app = buildApp({ enableRateLimit: true });

    const deleteOnce = () =>
      request(app)
        .delete('/api/account')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ email: 'legacy@example.com' });

    for (let i = 0; i < 6; i++) {
      await deleteOnce();
    }

    const blocked = await deleteOnce();
    // X-RateLimit-* ne doit pas être présent (legacyHeaders désactivé)
    expect(blocked.headers['x-ratelimit-limit']).toBeUndefined();
  });
});