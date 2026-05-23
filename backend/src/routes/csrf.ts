import { Router } from 'express';
import { generateCsrfToken } from '../middleware/csrf.js';
import type { CsrfTokenResponse } from '../types/index.js';

const router = Router();

/**
 * GET /api/csrf-token
 *
 * Délivre un token CSRF signé avec expiration (15 minutes).
 * Le frontend doit appeler cet endpoint avant chaque soumission de formulaire
 * et transmettre le token reçu dans le header X-CSRF-Token des requêtes POST.
 *
 * Réponse 200 :
 *   { token: string, expiresAt: number }
 *
 * Pas de rate-limiting spécifique ici : le rate-limit global du serveur
 * (express-rate-limit sur /api/*) couvre cette route. Le token n'est
 * utilisable qu'une fois dans la fenêtre de 15 minutes — émettre
 * plusieurs tokens est accepté (ex. multi-onglets) car chaque token
 * est indépendant et signé avec le même secret.
 */
router.get('/', (_req, res) => {
  const { token, expiresAt } = generateCsrfToken();

  const response: CsrfTokenResponse = { token, expiresAt };
  res.status(200).json(response);
});

export default router;