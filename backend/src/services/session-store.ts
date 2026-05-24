import type { PaymentSession } from '../types/index.js';

/**
 * SessionStore — stockage en mémoire des sessions de paiement Stripe.
 *
 * Chaque session est indexée par son Stripe Checkout Session ID (cs_xxx).
 * Durée de vie configurable via SESSION_TTL_MS (défaut : 1 heure).
 * Un nettoyage automatique (GC) tourne toutes les 5 minutes pour
 * éviter une accumulation mémoire en production.
 *
 * Limite acceptée (ADR-004) : si Railway redémarre dans le TTL,
 * la session est perdue. Migration PostgreSQL prévue en Sprint 2.
 */

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 3_600_000); // 1h
const GC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const store = new Map<string, PaymentSession>();

/**
 * Enregistre une nouvelle session de paiement.
 * Écrase silencieusement une session existante avec le même ID
 * (cas de retry webhook Stripe — idempotent par design).
 */
export function createSession(
  sessionId: string,
  email: string,
  linkedinUrl: string
): PaymentSession {
  const now = Math.floor(Date.now() / 1000);
  const session: PaymentSession = {
    sessionId,
    email,
    linkedinUrl,
    paidAt: now,
    expiresAt: now + Math.floor(SESSION_TTL_MS / 1000),
    used: false,
  };
  store.set(sessionId, session);
  return session;
}

/**
 * Récupère une session valide (non expirée, non utilisée).
 * Retourne null si introuvable, expirée ou déjà consommée.
 */
export function getValidSession(sessionId: string): PaymentSession | null {
  const session = store.get(sessionId);
  if (!session) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (session.expiresAt <= now) {
    store.delete(sessionId);
    return null;
  }

  if (session.used) {
    return null;
  }

  return session;
}

/**
 * Marque une session comme utilisée (anti-replay).
 * Retourne false si la session est introuvable ou déjà utilisée.
 */
export function consumeSession(sessionId: string): boolean {
  const session = store.get(sessionId);
  if (!session || session.used) {
    return false;
  }
  session.used = true;
  store.set(sessionId, session);
  return true;
}

/**
 * Supprime toutes les sessions expirées.
 * Appelé périodiquement par le GC interne.
 */
function collectExpiredSessions(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, session] of store.entries()) {
    if (session.expiresAt <= now) {
      store.delete(id);
    }
  }
}

// GC automatique — sans .unref() le process Node resterait actif
// même si c'est le seul handle restant.
const gcTimer = setInterval(collectExpiredSessions, GC_INTERVAL_MS);
gcTimer.unref();