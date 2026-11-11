const sensitiveAuditKey = /password|passwd|token|secret|cookie|authorization|credential|api.?key|private.?key|provider.?reference|session.?id|email|phone|address|card.?(?:number|pan)|\bpan\b|cvv|cvc|bank.?account|iban/i;

function sanitizeAuditValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    if (typeof value.key === 'string' && sensitiveAuditKey.test(value.key)) {
      return { key: value.key, redacted: true };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !sensitiveAuditKey.test(key))
        .map(([key, nestedValue]) => [key, sanitizeAuditValue(nestedValue)]),
    );
  }
  return value;
}

export function sanitizeAuditDetails(details = {}) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return sanitizeAuditValue(details);
}