export function redactUrls(message: string): string {
  return message.replace(/https:\/\/[^\s)]+/g, '[RPC]');
}

export function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/indexed requests require a personal token/i.test(message)) return 'This RPC allows account reads but blocks indexed pool discovery. Use a page-bound pool address or an RPC with getProgramAccounts access.';
  if (/^Jupiter\b|^Phantom\b/.test(message)) return redactUrls(message);
  if (/\b403\s*:|\bHTTP(?: Error)?\s+403\b|access forbidden|\bforbidden\b/i.test(message)) {
    return 'RPC access denied (403). Open Settings to choose another Mainnet RPC. Check API credentials and endpoint access restrictions.';
  }
  if (/\b401\s*:|\bHTTP(?: Error)?\s+401\b|\bunauthorized\b/i.test(message)) {
    return 'RPC authentication failed (401). Check the endpoint API key.';
  }
  if (/\b429\s*:|\bHTTP(?: Error)?\s+429\b|too many requests/i.test(message)) {
    return 'RPC rate limit exceeded (429). Wait before retrying or choose another Mainnet RPC.';
  }
  // RPC errors can include API keys in URLs. Never display the endpoint on the page.
  return redactUrls(message);
}
