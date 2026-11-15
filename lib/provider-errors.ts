/** Whether a provider failure is unlikely to recover on a later request. */
export function permanentlyUnavailable(status: number, code: string, message: string): boolean {
  if (status === 401 || status === 402 || status === 404) return true;
  const text = `${code} ${message}`.toLowerCase();
  return /budget.{0,24}(?:spent|exhausted)|\bis out\b|insufficient_(?:quota|credits?)|insufficient\s+credits?|resource_exhausted|billing|quota_exceeded|(?:quota|credits?).{0,24}(?:exhausted|depleted|insufficient|exceeded)|(?:exhausted|depleted|insufficient).{0,24}(?:quota|credits?)/.test(text);
}
