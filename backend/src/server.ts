import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import csrfRouter from './routes/csrf.js';
import webhookRouter from './routes/webhook.js';
import forgetRouter from './routes/forget.js';
import { csrfMiddleware } from './middleware/csrf.js';
import type { Request, Response, NextFunction } from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ─── Validation de la configuration critique au démarrage ─────────────────────
const csrfSecret = process.env.CSRF_SECRET;
if (!csrfSecret || csrfSecret.length < 32) {
  console.error(
    '[FATAL] Variable d\'environnement CSRF_SECRET manquante ou trop courte (min 32 caractères). ' +
    'Générez-en une avec : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
  process.exit(1);
}

const allowedOrigin = process.env.ALLOWED_ORIGIN ?? 'https://botlings.github.io';

// ─── Middlewares globaux ──────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  })
);

// ─── Route Stripe webhook — AVANT express.json() ──────────────────────────────
//
// Stripe exige le raw body (Buffer non parsé) pour vérifier la signature
// HMAC-SHA256 via stripe.webhooks.constructEvent().
// express.raw() est monté UNIQUEMENT sur /api/stripe/webhook, avant que
// le express.json() global ne puisse altérer le body.
//
// ⚠ L'ordre de déclaration est critique : cette route DOIT précéder
// app.use(express.json(...)) ci-dessous.
app.use(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  webhookRouter
);

// ─── Parsing JSON global (exclu de la route webhook ci-dessus) ────────────────
app.use(express.json({ limit: '64kb' }));

// ─── Rate limiting global sur /api ────────────────────────────────────────────

const globalApiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GLOBAL ?? 100),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes depuis cette adresse IP. Réessayez dans une heure.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

app.use('/api', globalApiLimiter);

// ─── Rate limiting spécifique sur /api/account (droit à l'oubli) ─────────────
//
// Fenêtre plus restrictive : 5 demandes par IP toutes les 15 minutes.
// Prévient le scraping de confirmations de suppression pour énumérer
// les comptes existants (même si la réponse est volontairement ambiguë).
const forgetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Trop de demandes de suppression. Réessayez dans 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

app.use('/api/account', forgetLimiter);

// ─── Middleware CSRF (routes POST + DELETE /api — hors webhook Stripe) ─────────
//
// Le webhook Stripe est exempté du CSRF : l'authenticité est garantie
// par la vérification de signature HMAC dans webhookRouter lui-même.
// Le middleware csrfMiddleware est appliqué après /api/stripe/webhook
// dans l'arbre de routage, mais Express évalue les routes dans l'ordre
// de déclaration — la route webhook est montée avant app.use('/api', csrfMiddleware)
// et Express ne la re-passe pas par les middlewares /api suivants.
app.use('/api', csrfMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/csrf-token', csrfRouter);

// RGPD art. 17 — Droit à l'oubli
app.use('/api/account', forgetRouter);

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/analyze', (_req, res) => {
  res.status(501).json({
    error: 'Endpoint /api/analyze non encore implémenté.',
    code: 'NOT_IMPLEMENTED',
  });
});

app.post('/api/recommendations', (_req, res) => {
  res.status(501).json({
    error: 'Endpoint /api/recommendations non encore implémenté.',
    code: 'NOT_IMPLEMENTED',
  });
});

// ─── Gestionnaire d'erreurs global ────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction
    ? 'Une erreur interne est survenue.'
    : err instanceof Error
    ? err.message
    : String(err);

  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.info(`[OptinkedIn API] Serveur démarré sur le port ${PORT} (${process.env.NODE_ENV ?? 'development'})`);
});

export default app;