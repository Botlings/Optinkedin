import { Router } from 'express';
import Stripe from 'stripe';
import { createSession } from '../services/session-store.js';
import type { Request, Response } from 'express';

const router = Router();

/**
 * Initialisation du client Stripe avec validation fail-fast.
 * La clé est lue une seule fois au chargement du module.
 * Si STRIPE_SECRET_KEY est absente, le processus s'arrête au démarrage
 * (via la validation dans server.ts) avant que ce module ne soit utilisé.
 */
function buildStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith('sk_')) {
    throw new Error(
      '[FATAL] STRIPE_SECRET_KEY manquante ou invalide (doit commencer par sk_live_ ou sk_test_).'
    );
  }
  return new Stripe(key, {
    // Version d'API Stripe stable — à mettre à jour manuellement après
    // validation des changelogs Stripe. Ne jamais utiliser 'latest'.
    apiVersion: '2024-06-20',
    maxNetworkRetries: 0,
  });
}

const stripe = buildStripeClient();

/**
 * Extrait l'URL LinkedIn depuis les metadata Stripe ou client_reference_id.
 * Retourne une chaîne vide si absent — l'utilisateur la fournit à nouveau
 * lors de l'appel à POST /api/recommendations.
 */
function extractLinkedinUrl(session: Stripe.Checkout.Session): string {
  const metaUrl = session.metadata?.linkedin_url;
  if (typeof metaUrl === 'string' && metaUrl.length > 0) {
    return metaUrl;
  }
  const refId = session.client_reference_id;
  if (typeof refId === 'string' && refId.startsWith('https://www.linkedin.com/in/')) {
    return refId;
  }
  return '';
}

/**
 * POST /api/stripe/webhook
 *
 * Vérifie la signature HMAC-SHA256 Stripe via stripe.webhooks.constructEvent(),
 * puis traite l'événement checkout.session.completed.
 *
 * ⚠ Reçoit le raw body (Buffer) — express.raw() est monté dans server.ts
 * sur cette route, avant express.json() global.
 */
router.post('/', (req: Request, res: Response): void => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Webhook] STRIPE_WEBHOOK_SECRET non configuré.');
    res.status(500).json({ error: 'Configuration serveur incomplète.', code: 'CONFIG_ERROR' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    res.status(400).json({ error: 'En-tête stripe-signature manquant.', code: 'MISSING_SIGNATURE' });
    return;
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    res.status(400).json({ error: 'Corps de la requête invalide ou vide.', code: 'INVALID_BODY' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Webhook] Signature Stripe invalide : ${message}`);
    res.status(400).json({ error: 'Signature webhook invalide.', code: 'INVALID_SIGNATURE' });
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.id;

      if (!sessionId) {
        console.error('[Webhook] checkout.session.completed sans session.id.');
        res.status(400).json({ error: 'session.id manquant.', code: 'MISSING_SESSION_ID' });
        return;
      }

      const email =
        session.customer_details?.email ??
        (typeof session.customer_email === 'string' ? session.customer_email : '');
      const linkedinUrl = extractLinkedinUrl(session);

      // Idempotent : createSession écrase si la session existe déjà
      // (retry webhook Stripe après timeout réseau).
      createSession(sessionId, email, linkedinUrl);

      console.info(
        `[Webhook] Session de paiement enregistrée : ${sessionId} (email=${email ? '[présent]' : '[absent]'})`
      );
      break;
    }

    default:
      // Événement non géré — accusé de réception sans traitement.
      break;
  }

  res.status(200).json({ received: true });
});

export default router;