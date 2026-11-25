/**
 * Creates a collision-resistant identifier for in-page bookkeeping and Worker
 * message correlation. It is NOT a security token and must never be used for
 * authentication, authorization, secrets, or cryptographic nonces.
 *
 * randomUUID is available only in secure contexts in some browsers. The
 * fallback keeps non-security-sensitive UI operations usable in local HTTP
 * development environments and older embedded browsers.
 */
let fallbackCounter = 0;

export function createId(scope = 'ff'): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // A restricted browser context may expose crypto but reject access to it.
  }

  fallbackCounter += 1;
  const time = Date.now().toString(36);
  const counter = fallbackCounter.toString(36);
  const random = Math.random().toString(36).slice(2, 12) || '0';
  const safeScope = scope.replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 'ff';
  return `${safeScope}-${time}-${counter}-${random}`;
}
