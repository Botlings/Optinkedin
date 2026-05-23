import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import csrfRouter from './routes/csrf.js';
import { csrfMiddleware } from './middleware/csrf.js';
import type { Request, Response, NextFunction } from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ─── Validation de la configuration critique au démarrage ─────────────────────
// Fail-fast : si CSRF_SECRET est absent ou trop court, le serveur refuse
// de démarrer plutôt que de fonctionner sans protection.
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
    // Le Content-Security-Policy est géré côté GitHub Pages dans index.html.
    // Côté API, on active uniquement les headers HTTP pertinents.
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600, // Cache preflight 10 minutes.
  })
);

// Parse le corps JSON uniquement pour les routes qui en ont besoin.
// Limite à 64 KB pour éviter les attaques par payload géant.
app.use(express.json({ limit: '64kb' }));

// ─── Rate limiting global sur /api ────────────────────────────────────────────

const globalApiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: Number(process.env.RATE_LIMIT_GLOBAL ?? 100),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes depuis cette adresse IP. Réessayez dans une heure.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

app.use('/api', globalApiLimiter);

// ─── Middleware CSRF (appliqué sur toutes les routes POST /api) ───────────────
// Le middleware csrfMiddleware ignore les méthodes GET/HEAD/OPTIONS,
// donc le placer globalement sur /api est sans effet sur les GET.
app.use('/api', csrfMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Délivre un token CSRF au frontend (GET — non bloqué par csrfMiddleware).
app.use('/api/csrf-token', csrfRouter);

// Health check sans CSRF ni rate-limit individuel (couvert par le global).
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Placeholder routes (à remplacer en Sprint 2) ─────────────────────────────
// Ces routes retournent 501 pour signaler qu'elles ne sont pas encore
// implémentées, tout en validant correctement le CSRF via le middleware global.

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
  // Ne jamais exposer le détail de l'erreur en production.
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