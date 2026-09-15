type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

function getRootCause(error: unknown): unknown {
  let current = error;
  const seen = new Set<unknown>();

  while (isErrorLike(current) && current.cause && !seen.has(current.cause)) {
    seen.add(current);
    current = current.cause;
  }

  return current;
}

function redactConnectionDetails(message: string) {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[redacted database URL]")
    .replace(/(password\s*=\s*)\S+/gi, "$1[redacted]");
}

export function getDatabaseErrorDetails(error: unknown) {
  const rootCause = getRootCause(error);
  const details = isErrorLike(rootCause) ? rootCause : {};
  const message = typeof details.message === "string"
    ? details.message
    : error instanceof Error
      ? error.message
      : String(error);

  return {
    code: typeof details.code === "string" ? details.code : undefined,
    message: redactConnectionDetails(message).slice(0, 1_000),
  };
}
