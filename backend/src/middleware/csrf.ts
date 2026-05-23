import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { CsrfTokenPayload } from '../types/index.js';

/**
 * Durée de validité d'un token CSRF : 15 minutes en secondes.
 */
const CSRF_TTL_SECONDS = 15 * 60;

/**
 * Nom de l'en-tête HTTP attendu pour recevoir le token CSRF sur les requêtes POST.
 */
const CSRF_HEADER = 'x-csrf-token';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Retourne le secret CSRF depuis les variables d'environnement.
 * Lance une erreur au démarrage si la variable est absente ou trop courte.
 */
function getCsrfSecret(): string {
  const secret = process.env.CSRF_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "Variable d'environnement CSRF_SECRET manquante ou trop courte (min 32 caractères)."
    );
  }
  return secret;
}

/**
 * Calcule la signature HMAC-SHA256 du payload sérialisé.
 */
function signPayload(payload: CsrfTokenPayload, secret: string): string {
  const data = JSON.stringify(payload);
  return createHmac('sha256', secret).update(data).digest('hex');
}

// ─── API publique du module ───────────────────────────────────────────────────

/**
 * Génère un token CSRF signé avec expiration.
 *
 * Format : <base64url(payload_json)>.<signature_hex>
 *
 * Payload : { jti, iat, exp }
 */
export function generateCsrfToken(): { token: string; expiresAt: number } {
  const secret = getCsrfSecret();

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + CSRF_TTL_SECONDS;

  // randomBytes importé directement depuis 'crypto' — compatible ESM.
  const jti = randomBytes(16).toString('hex');

  const payload: CsrfTokenPayload = { jti, iat, exp };
  const signature = signPayload(payload, secret);

  const payloadB64 = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { token: `${payloadB64}.${signature}`, expiresAt: exp };
}

/**
 * Valide un token CSRF reçu en header.
 *
 * Contrôles :
 *   1. Format : deux segments séparés par un point.
 *   2. Décodage et parsing JSON du payload.
 *   3. Structure du payload (jti string, iat/exp number).
 *   4. iat non dans le futur (protection contre tokens forgés).
 *   5. Expiration : exp > timestamp courant.
 *   6. Signature HMAC en temps constant (timingSafeEqual).
 */
export function validateCsrfToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }

  const [payloadB64, receivedSignature] = parts as [string, string];

  let payload: unknown;
  try {
    const jsonStr = Buffer.from(
      payloadB64.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch {
    return false;
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).jti !== 'string' ||
    typeof (payload as Record<string, unknown>).iat !== 'number' ||
    typeof (payload as Record<string, unknown>).exp !== 'number'
  ) {
    return false;
  }

  const typedPayload = payload as CsrfTokenPayload;
  const nowSeconds = Math.floor(Date.now() / 1000);

  // iat ne doit pas être dans le futur (tolérance de 5 s pour décalage d'horloge).
  if (typedPayload.iat > nowSeconds + 5) {
    return false;
  }

  // Token expiré.
  if (typedPayload.exp <= nowSeconds) {
    return false;
  }

  // Vérification HMAC en temps constant.
  let secret: string;
  try {
    secret = getCsrfSecret();
  } catch {
    return false;
  }

  const expectedSignature = signPayload(typedPayload, secret);

  try {
    const receivedBuf = Buffer.from(receivedSignature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (receivedBuf.length !== expectedBuf.length) {
      return false;
    }

    return timingSafeEqual(receivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Middleware Express de validation CSRF.
 *
 * Ignoré pour GET, HEAD, OPTIONS (méthodes idempotentes).
 * Répond 403 en cas de token absent, malformé ou expiré.
 * Le message d'erreur est identique dans tous les cas d'échec
 * pour ne pas aider un attaquant à calibrer ses tokens.
 */
export function csrfMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    next();
    return;
  }

  const headerToken = req.headers[CSRF_HEADER];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!validateCsrfToken(token ?? '')) {
    res.status(403).json({
      error: 'Token CSRF invalide ou expiré. Rafraîchissez la page et réessayez.',
      code: 'CSRF_INVALID',
    });
    return;
  }

  next();
}