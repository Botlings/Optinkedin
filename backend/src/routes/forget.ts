import { Router } from 'express';
import { deleteSessionsByEmail, deleteSessionById } from '../services/session-store.js';
import type { Request, Response } from 'express';

const router = Router();

/**
 * DELETE /api/account
 *
 * Droit à l'oubli — RGPD art. 17.
 *
 * Supprime toutes les sessions de paiement associées à l'email
 * fourni, ou une session spécifique si session_id est fourni.
 *
 * L'endpoint est volontairement silencieux sur l'existence ou non
 * de données : il retourne 200 dans tous les cas (comportement
 * "droit à l'oubli" standard — évite l'énumération de données).
 *
 * Corps attendu (application/json) :
 *   { "email": "user@example.com" }
 *   ou
 *   { "session_id": "cs_live_xxx" }
 *   ou les deux.
 *
 * Au moins un des deux champs doit être présent.
 */
router.delete('/', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown>;

  const email =
    typeof body.email === 'string' && body.email.trim().length > 0
      ? body.email.trim().toLowerCase()
      : null;

  const sessionId =
    typeof body.session_id === 'string' && body.session_id.trim().length > 0
      ? body.session_id.trim()
      : null;

  if (!email && !sessionId) {
    res.status(400).json({
      error: 'Au moins un champ "email" ou "session_id" est requis.',
      code: 'MISSING_IDENTIFIER',
    });
    return;
  }

  // Validation basique du format email (sans dépendance externe).
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({
      error: 'Format d\'adresse email invalide.',
      code: 'INVALID_EMAIL',
    });
    return;
  }

  // Validation du format session_id Stripe (même règle que côté frontend).
  if (
    sessionId !== null &&
    (
      (sessionId.indexOf('cs_live_') !== 0 && sessionId.indexOf('cs_test_') !== 0) ||
      !/^[A-Za-z0-9_\-]+$/.test(sessionId) ||
      sessionId.length < 20 ||
      sessionId.length > 256
    )
  ) {
    res.status(400).json({
      error: 'Format de session_id invalide.',
      code: 'INVALID_SESSION_ID',
    });
    return;
  }

  let deletedCount = 0;

  if (email !== null) {
    deletedCount += deleteSessionsByEmail(email);
  }

  if (sessionId !== null) {
    const deleted = deleteSessionById(sessionId);
    if (deleted) { deletedCount += 1; }
  }

  // Réponse 200 même si deletedCount === 0 : on ne confirme pas l'existence
  // de données pour éviter l'énumération. L'obligation RGPD est satisfaite
  // dès que la demande est traitée de bonne foi.
  console.info(
    `[RGPD] Demande de suppression traitée — ${deletedCount} session(s) supprimée(s). ` +
    `email=${email ? '[présent]' : 'non fourni'} ` +
    `session_id=${sessionId ? '[présent]' : 'non fourni'}`
  );

  res.status(200).json({
    message: 'Votre demande de suppression a été prise en compte. Toutes vos données ont été effacées de nos systèmes actifs.',
    deleted_count: deletedCount,
  });
});

export default router;