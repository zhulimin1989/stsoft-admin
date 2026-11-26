export function warnNonCritical(scope: string, error: unknown): void {
  console.warn(`[${scope}] non-critical operation failed`, error);
}
