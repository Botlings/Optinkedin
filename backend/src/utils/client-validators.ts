/**
 * Fonctions de validation et d'échappement partagées entre le frontend
 * (inline dans index.html) et le backend (tests unitaires).
 *
 * Ces fonctions sont délibérément sans dépendances pour rester
 * copiables telles quelles dans du JS navigateur vanilla.
 */

/**
 * Échappe les caractères HTML spéciaux pour prévenir les injections XSS
 * dans les contextes innerHTML. À utiliser systématiquement avant toute
 * insertion de données non maîtrisées dans le DOM.
 *
 * Couvre les 6 vecteurs XSS HTML classiques :
 *   & → &amp;   (doit être échappé en premier pour ne pas double-échapper)
 *   < → &lt;
 *   > → &gt;
 *   " → &quot;
 *   ' → &#x27;
 *   / → &#x2F;  (fermeture de balise prématurée)
 */
export function escapeHtml(raw: unknown): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Valide un session_id Stripe avant toute réutilisation.
 *
 * Règles strictes (miroir exact de la validation dans index.html) :
 *   - Doit être une string
 *   - Longueur 20–256 caractères
 *   - Préfixe obligatoire : "cs_live_" ou "cs_test_"
 *   - Caractères : alphanumérique, underscore, tiret uniquement
 *
 * Cette fonction est la porte d'entrée canonique pour toute lecture
 * ou réutilisation d'un session_id, quelle que soit sa provenance.
 */
export function isValidSessionId(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 20 || value.length > 256) return false;
  if (!value.startsWith('cs_live_') && !value.startsWith('cs_test_')) return false;
  return /^[A-Za-z0-9_\-]+$/.test(value);
}

/**
 * Tronque un session_id pour l'affichage public (bandeau, logs UI).
 * Précondition : la valeur doit avoir été validée par isValidSessionId.
 */
export function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 16) return sessionId;
  return sessionId.slice(0, 12) + '\u2026' + sessionId.slice(-4);
}

/**
 * Valide une URL de profil LinkedIn.
 *
 * Format attendu : https://www.linkedin.com/in/<slug>
 * Le slug peut contenir : lettres, chiffres, tirets, underscores, tirets-bas encodés.
 *
 * Réplique le pattern HTML du formulaire côté frontend pour que la
 * validation serveur soit strictement identique à la validation client.
 */
export function isValidLinkedInUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  if (url.length > 512) return false;
  return /^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?$/.test(url);
}