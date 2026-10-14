export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export type DiagnosticValue = null | boolean | number | string | DiagnosticValue[] | { [key: string]: DiagnosticValue };
export type DiagnosticEvent = {
  type: string; at: number; level: DiagnosticLevel; component: string;
  requestId?: string; orderId?: string; attemptId?: string; signature?: string;
  duration?: number; code?: string; details?: DiagnosticValue; version: string;
  count?: number; firstAt?: number;
};
export type DiagnosticInput = Omit<DiagnosticEvent, 'at' | 'version' | 'count' | 'firstAt' | 'details'> & {
  at?: number; version?: string; details?: unknown;
};
export type DiagnosticFilter = Partial<Pick<DiagnosticEvent, 'level' | 'component' | 'type' | 'requestId' | 'orderId' | 'attemptId' | 'signature'>> & { since?: number; until?: number; limit?: number };
export const DIAGNOSTIC_TEXT_LIMIT = 1024;
const SECRET_KEY = /(?:password|passwd|secret|private.?key|api.?key|access.?token|refresh.?token|authorization|cookie|mnemonic|seed|keypair|passphrase|credential|signed.?transaction|raw.?transaction|^key$|^token$|^auth$|^headers$)/i;
export function cleanDiagnosticText(text: string): string {
  return text.replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g, '[REDACTED]')
    .replace(/(?:https?|wss?):\/\/[^\s<>"'`]+/gi, '[RPC]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+/gi, '[REDACTED]')
    .replace(/\b(["']?(?:password|passwd|secret(?:[ _-]?key)?|private[ _-]?key|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|cookie|mnemonic|seed|passphrase|credential|keypair|key|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\[[^\]]*\]|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, DIAGNOSTIC_TEXT_LIMIT);
}

/** Sanitizes before persistence. Does not stringify arbitrary objects or invoke their getters. */
export function sanitizeDiagnostic(value: unknown): DiagnosticValue {
  const seen = new WeakSet<object>();
  let budget = 128;
  function visit(input: unknown, depth: number): DiagnosticValue {
    if (--budget < 0 || depth > 4) return '[TRUNCATED]';
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input === 'string') return cleanDiagnosticText(input);
    if (typeof input !== 'object') return '[UNSUPPORTED]';
    if (seen.has(input)) return '[CIRCULAR]';
    seen.add(input);
    if (input instanceof Error) return { name: cleanDiagnosticText(input.name), message: cleanDiagnosticText(input.message) };
    if (Array.isArray(input)) return input.slice(0, 20).map(item => visit(item, depth + 1));
    const output: Record<string, DiagnosticValue> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input)).slice(0, 32)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      output[cleanDiagnosticText(key).slice(0, 80)] = SECRET_KEY.test(key) ? '[REDACTED]' : 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[ACCESSOR]';
    }
    return output;
  }
  try { return visit(value, 0); } catch { return '[UNAVAILABLE]'; }
}

