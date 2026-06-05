import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { csrfMiddleware, generateCsrfToken } from '../middleware/csrf.js';
import type { Request, Response } from 'express';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construit une application Express de test avec le stub /api/analyze.
 *
 * Contexte : POST /api/analyze retourne 501 dans server.ts (non implémenté).
 * On monte ici un handler de test qui valide les inputs et retourne des
 * réponses métier réalistes pour permettre des tests de surface d'attaque
 * complets — XSS sur les inputs, CSRF, rate-limiting.
 *
 * Ce handler reproduit la logique de validation qui DEVRA être présente
 * dans la future implémentation de analyze.ts.
 */
function buildApp(opts: { enableRateLimit?: boolean; rateLimitMax?: number } = {}) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  if (opts.enableRateLimit) {
    const analyzeLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: opts.rateLimitMax ?? 10,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: 'Trop de requêtes depuis cette adresse IP. Réessayez dans une heure.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    });
    app.use('/api/analyze', analyzeLimiter);
  }

  app.use('/api', csrfMiddleware);

  // Handler de validation reproduisant les règles attendues pour /api/analyze
  app.post('/api/analyze', (req: Request, res: Response): void => {
    const { url } = req.body as Record<string, unknown>;

    if (typeof url !== 'string' || url.trim().length === 0) {
      res.status(400).json({ error: 'Paramètre url manquant ou invalide.', code: 'INVALID_INPUT' });
      return;
    }

    const trimmed = url.trim();

    // Longueur maximale défensive
    if (trimmed.length > 512) {
      res.status(400).json({ error: 'URL trop longue.', code: 'INVALID_INPUT' });
      return;
    }

    // Validation stricte du format LinkedIn
    const linkedinPattern = /^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?$/;
    if (!linkedinPattern.test(trimmed)) {
      res.status(400).json({ error: 'URL LinkedIn invalide.', code: 'INVALID_LINKEDIN_URL' });
      return;
    }

    // Réponse simulée conforme au schéma AnalysisResult
    res.status(200).json({
      score: 74,
      tier: 'free',
      criteria: [],
      locked_count: 13,
      preview_message: 'Test response',
    });
  });

  return app;
}

/** Génère un token CSRF valide. */
function validCsrfHeader(): Record<string, string> {
  const { token } = generateCsrfToken();
  return { 'X-CSRF-Token': token };
}

// ═══════════════════════════════════════════════════════════════════════════
// Protection CSRF sur POST /api/analyze
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/analyze — protection CSRF', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it('retourne 403 sans header X-CSRF-Token', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .send({ url: 'https://www.linkedin.com/in/john-doe' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('retourne 403 avec un token CSRF forgé', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', 'forged.tokenwithfakehmac1234567890abcdef1234567890abcdef12345678')
      .send({ url: 'https://www.linkedin.com/in/john-doe' });

    expect(res.status).toBe(403);
  });

  it('retourne 200 avec un token CSRF valide et une URL correcte', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/john-doe' });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation URL LinkedIn — protection XSS et injection
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/analyze — validation URL et protection XSS', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it('accepte une URL LinkedIn valide', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/jean-dupont' });

    expect(res.status).toBe(200);
    expect(res.body.score).toBeDefined();
  });

  it('accepte une URL LinkedIn avec slash final', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/jean-dupont/' });

    expect(res.status).toBe(200);
  });

  it('accepte un profil avec des chiffres dans le slug', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/user123' });

    expect(res.status).toBe(200);
  });

  it('rejette une URL vide', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: '' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('rejette un body sans champ url', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejette une URL http:// (non HTTPS)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'http://www.linkedin.com/in/john-doe' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_LINKEDIN_URL');
  });

  it('rejette un domaine non LinkedIn', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.evil.com/in/john-doe' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_LINKEDIN_URL');
  });

  it('rejette une URL LinkedIn sans /in/ (path invalide)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/company/acme' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_LINKEDIN_URL');
  });

  it('rejette une injection XSS classique <script> dans le champ url', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: '<script>alert(document.cookie)</script>' });

    expect(res.status).toBe(400);
    // Vérifie que le contenu XSS n'est pas reflété dans la réponse
    expect(JSON.stringify(res.body)).not.toContain('<script>');
  });

  it('rejette une payload XSS déguisée en URL LinkedIn', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/<img src=x onerror=fetch(evil.com)>' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('onerror');
  });

  it('rejette un javascript: protocol dans le champ url', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'javascript:alert(1)' });

    expect(res.status).toBe(400);
  });

  it('rejette une URL avec caractères null byte', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/john\u0000doe' });

    expect(res.status).toBe(400);
  });

  it('rejette une URL avec path traversal', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/../../etc/passwd' });

    expect(res.status).toBe(400);
  });

  it('rejette une URL dépassant 512 caractères', async () => {
    const longSlug = 'a'.repeat(500);
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: `https://www.linkedin.com/in/${longSlug}` });

    expect(res.status).toBe(400);
  });

  it('rejette une injection SQL dans le champ url', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: "https://www.linkedin.com/in/'; DROP TABLE users; --" });

    expect(res.status).toBe(400);
    // Le contenu SQL ne doit pas être reflété
    expect(JSON.stringify(res.body)).not.toContain('DROP TABLE');
  });

  it('rejette un url de type number (mauvais type JSON)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 12345 });

    expect(res.status).toBe(400);
  });

  it('rejette un url de type array (mauvais type JSON)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: ['https://www.linkedin.com/in/john-doe'] });

    expect(res.status).toBe(400);
  });

  it('rejette un url de type objet (mauvais type JSON)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: { href: 'https://www.linkedin.com/in/john-doe' } });

    expect(res.status).toBe(400);
  });

  it('ne reflète pas de données utilisateur brutes dans le message d\'erreur', async () => {
    const payload = '<script>alert(1)</script>';
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: payload });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('<script>');
    expect(JSON.stringify(res.body)).not.toContain(payload);
  });

  it('retourne un Content-Type application/json sur les erreurs 400', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'not-a-linkedin-url' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rate limiting — POST /api/analyze (10 req / heure par IP)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/analyze — rate limiting', () => {
  it('retourne 429 après le nombre de requêtes autorisées', async () => {
    // On fixe max à 3 pour accélérer le test sans attendre 10 requêtes.
    const app = buildApp({ enableRateLimit: true, rateLimitMax: 3 });

    const analyzeOnce = () =>
      request(app)
        .post('/api/analyze')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ url: 'https://www.linkedin.com/in/john-doe' });

    // Les 3 premières requêtes doivent passer
    for (let i = 0; i < 3; i++) {
      const res = await analyzeOnce();
      expect(res.status).toBe(200);
    }

    // La 4ème doit être bloquée
    const blocked = await analyzeOnce();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('inclut les headers RateLimit standard (draft-7) dans la réponse 429', async () => {
    const app = buildApp({ enableRateLimit: true, rateLimitMax: 2 });

    const analyzeOnce = () =>
      request(app)
        .post('/api/analyze')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ url: 'https://www.linkedin.com/in/john-doe' });

    for (let i = 0; i < 2; i++) {
      await analyzeOnce();
    }

    const blocked = await analyzeOnce();
    expect(blocked.status).toBe(429);
    expect(blocked.headers).toHaveProperty('ratelimit-limit');
    expect(blocked.headers).toHaveProperty('ratelimit-remaining');
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });

  it('le header ratelimit-limit reflète le max configuré', async () => {
    const app = buildApp({ enableRateLimit: true, rateLimitMax: 5 });

    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/john-doe' });

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('5');
  });

  it('ratelimit-remaining décroît à chaque requête', async () => {
    const app = buildApp({ enableRateLimit: true, rateLimitMax: 5 });

    const analyzeOnce = () =>
      request(app)
        .post('/api/analyze')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ url: 'https://www.linkedin.com/in/john-doe' });

    const first = await analyzeOnce();
    const second = await analyzeOnce();

    const remainingAfterFirst = parseInt(first.headers['ratelimit-remaining'] ?? '99', 10);
    const remainingAfterSecond = parseInt(second.headers['ratelimit-remaining'] ?? '99', 10);

    expect(remainingAfterSecond).toBe(remainingAfterFirst - 1);
  });

  it('ne bloque pas les requêtes en dessous du seuil', async () => {
    const app = buildApp({ enableRateLimit: true, rateLimitMax: 10 });

    // 5 requêtes valides — bien en dessous du seuil de 10
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/analyze')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ url: 'https://www.linkedin.com/in/john-doe' });
      expect(res.status).toBe(200);
    }
  });

  it("n'expose pas les legacy headers X-RateLimit-* (legacyHeaders: false)", async () => {
    const app = buildApp({ enableRateLimit: true, rateLimitMax: 2 });

    const analyzeOnce = () =>
      request(app)
        .post('/api/analyze')
        .set('Content-Type', 'application/json')
        .set(validCsrfHeader())
        .send({ url: 'https://www.linkedin.com/in/john-doe' });

    for (let i = 0; i < 3; i++) {
      await analyzeOnce();
    }

    const blocked = await analyzeOnce();
    expect(blocked.headers['x-ratelimit-limit']).toBeUndefined();
    expect(blocked.headers['x-ratelimit-remaining']).toBeUndefined();
  });

  it('le message d\'erreur 429 ne reflète pas de données utilisateur', async () => {
    const app = buildApp({ enableRateLimit: true, rateLimitMax: 1 });

    // Première requête passe
    await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: 'https://www.linkedin.com/in/john-doe' });

    // Deuxième avec payload XSS — doit être bloquée et ne pas refléter l'input
    const blocked = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .set(validCsrfHeader())
      .send({ url: '<script>alert(1)</script>' });

    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked.body)).not.toContain('<script>');
  });
});