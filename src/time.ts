/** Current epoch milliseconds. Wrapped so timestamps are easy to stub in tests. */
export function nowMs(): number {
  return Date.now();
}
