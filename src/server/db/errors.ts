export interface DatabaseError extends Error {
  code?: string;
  constraint_name?: string;
}

export function isDatabaseError(error: unknown, code: string): error is DatabaseError {
  return error instanceof Error && (error as DatabaseError).code === code;
}
