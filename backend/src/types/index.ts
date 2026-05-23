/**
 * Types partagés pour l'ensemble du backend OptinkedIn.
 */

// ─── Token CSRF ─────────────────────────────────────────────────────────────

/** Payload encodé dans le token CSRF signé. */
export interface CsrfTokenPayload {
  /** Identifiant unique du token (jti — JWT ID convention). */
  jti: string;
  /** Timestamp d'émission (secondes Unix). */
  iat: number;
  /** Timestamp d'expiration (secondes Unix). */
  exp: number;
}

/** Réponse de l'endpoint GET /api/csrf-token. */
export interface CsrfTokenResponse {
  token: string;
  /** Timestamp d'expiration Unix (secondes) — permet au frontend de planifier un rafraîchissement. */
  expiresAt: number;
}

// ─── Score / Analyse ─────────────────────────────────────────────────────────

export type CriterionStatus = 'good' | 'improve' | 'missing';

export interface Criterion {
  id: string;
  label: string;
  score: number;
  max: number;
  status: CriterionStatus;
  visible: boolean;
}

export type AnalysisTier = 'free' | 'premium';

export interface AnalysisResult {
  score: number;
  tier: AnalysisTier;
  criteria: Criterion[];
  locked_count?: number;
  preview_message?: string;
}

// ─── Recommandations IA ──────────────────────────────────────────────────────

export type RecommendationPriority = 'high' | 'medium' | 'low';

export interface Recommendation {
  section: string;
  priority: RecommendationPriority;
  issue: string;
  suggestion: string;
  example: string;
}

export interface KeywordAnalysis {
  missing: string[];
  present: string[];
  suggestion: string;
}

export interface RecommendationsResult extends AnalysisResult {
  recommendations: Recommendation[];
  keywords: KeywordAnalysis;
}

// ─── Sessions de paiement ────────────────────────────────────────────────────

export interface PaymentSession {
  sessionId: string;
  email: string;
  linkedinUrl: string;
  paidAt: number;
  expiresAt: number;
  used: boolean;
}

// ─── Erreurs API ─────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code?: string;
}