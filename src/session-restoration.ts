export function shouldClearStoredSession(error: unknown) {
  return error instanceof Error && (error as Error & { status?: number }).status === 401;
}
