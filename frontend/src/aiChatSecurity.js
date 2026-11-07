const passwordPhrasePattern = /(\b(?:password|passphrase|secret|token)\s+(?:is|equals)\s+["']?)([^\s,;'"`]+)/gi;
const sensitiveValuePatterns = [
  /\b(?:proxy-)?authorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,
  /\b(?:OPENAI_API_KEY|[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?(?:TOKEN|KEY)|REFRESH[_-]?TOKEN|CLIENT[_-]?SECRET|SECRET[_-]?KEY|PRIVATE[_-]?KEY|SESSION[_-]?COOKIE|AUTHORIZATION|JWT[_-]?SECRET|TOKEN|PASSWORD|DB_PASSWORD|SMTP_PASSWORD))\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  passwordPhrasePattern,
  /\b[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi,
];

export function redactAiChatSecrets(value) {
  if (typeof value !== 'string') return value;
  return sensitiveValuePatterns.reduce(
    (content, pattern) => content.replace(pattern, (...matches) => {
      if (pattern === passwordPhrasePattern) {
        return `${matches[1]}[REDACTED]`;
      }
      return '[REDACTED]';
    }),
    value,
  );
}
