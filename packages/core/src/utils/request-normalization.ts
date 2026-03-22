export function normalizeMessagesRequestBody(body: Record<string, any>) {
  const normalized = { ...body };

  if (normalized.stream === undefined) {
    delete normalized.stream;
  }

  return normalized;
}
