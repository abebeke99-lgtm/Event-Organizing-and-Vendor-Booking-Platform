export const AI_SECRET_DISCLOSURE_RESPONSE = "I can't provide passwords, API keys, authentication tokens, or confidential system information. Please use the authorized account recovery or credential management process.";
export const AI_BLOCKED_REQUEST_MARKER = '[Sensitive information request blocked.]';

const passwordPhrasePattern = /(\b(?:password|passphrase|secret|token)\s+(?:is|equals)\s+["']?)([^\s,;'"`]+)/gi;
const secretValuePatterns = [
  /\b(?:proxy-)?authorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,
  /\b(?:OPENAI_API_KEY|[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?(?:TOKEN|KEY)|REFRESH[_-]?TOKEN|CLIENT[_-]?SECRET|SECRET[_-]?KEY|PRIVATE[_-]?KEY|SESSION[_-]?COOKIE|AUTHORIZATION|JWT[_-]?SECRET|TOKEN|PASSWORD|DB_PASSWORD|SMTP_PASSWORD))\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  passwordPhrasePattern,
  /\b[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi,
];

const incompleteSecretPatterns = [
  /\b(?:OPENAI_API_KEY|[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?(?:TOKEN|KEY)|REFRESH[_-]?TOKEN|CLIENT[_-]?SECRET|SECRET[_-]?KEY|PRIVATE[_-]?KEY|SESSION[_-]?COOKIE|AUTHORIZATION|JWT[_-]?SECRET|TOKEN|PASSWORD|DB_PASSWORD|SMTP_PASSWORD))\s*[:=]\s*(?:"[^"\r\n]*|'[^'\r\n]*|[^\s,;]*)$/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]*$/gi,
  /\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]*$/gi,
  /\b(password|passphrase|secret|token)\s+(?:is|equals)\s+["']?[^\s,;'"`]*$/gi,
  /\b[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:[^/\s@]*$/gi,
  /\beyJ[A-Za-z0-9_-]*(?:\.eyJ[A-Za-z0-9_-]*){0,2}\.?[A-Za-z0-9_-]*$/g,
];

const instructionOverridePattern = /\b(?:ignore|disregard|forget|override|bypass|disable)\b[\s\S]{0,100}\b(?:previous|prior|above|system|developer|security|safety|hidden|all)\b[\s\S]{0,100}\b(?:instructions?|rules?|prompts?|polic(?:y|ies)|authorization|access control)\b/i;
const authBypassPattern = /\b(?:bypass|circumvent|evade|disable|skip)\b[\s\S]{0,60}\b(?:authentication|authorization|access control|ownership checks?|login)\b/i;
const otherUserAccessPattern = /\b(?:other users?|another user|someone else'?s|all users?|a different user)\b[\s\S]{0,100}\b(?:private|personal|password|credentials?|email|phone|conversation|account|token|records?)\b/i;
const disclosureIntentPattern = /\b(?:show|reveal|tell|give|print|display|repeat|expose|extract|dump|read|retrieve|return|provide|list|send|leak|exfiltrate|find|get|obtain|access|know|what(?:\s+is|'s)|who\s+is|where\s+is|i\s+need|i\s+want)\b/i;
const protectedInformationPattern = /\b(?:OPENAI_API_KEY|[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?(?:TOKEN|KEY)|REFRESH[_-]?TOKEN|CLIENT[_-]?SECRET|SECRET[_-]?KEY|PRIVATE[_-]?KEY|SESSION[_-]?COOKIE|AUTHORIZATION|JWT[_-]?SECRET|TOKEN|PASSWORD|DB_PASSWORD|SMTP_PASSWORD)|passwords?|passphrases?|credentials?|api keys?|access tokens?|refresh tokens?|auth(?:entication)? tokens?|session cookies?|jwt(?:s)?|secrets?|environment variables?|process\.env|\.env files?|system prompts?|system instructions?|hidden (?:instructions?|prompts?)|developer instructions?|private backend (?:config(?:uration)?|files?)|database (?:passwords?|credentials?)|smtp (?:passwords?|credentials?)|administrator passwords?|admin passwords?|other users?['’]? private (?:data|information|details|records)|private (?:user )?(?:data|information|details|conversations?))\b/i;
const environmentFilePattern = /(?:^|[^A-Za-z0-9_])\.env(?:\s+files?)?\b/i;
const ownPasswordRecoveryPattern = /\b(?:reset|recover|change|forgot|forgotten)\b[\s\S]{0,35}\bmy password\b/i;
const explicitOwnPasswordDisclosurePattern = /\b(?:show|reveal|tell|give|print|display|repeat|read|what(?:\s+is|'s))\b[\s\S]{0,35}\bmy password\b/i;

export function redactSensitiveContent(value) {
  if (typeof value !== 'string') return value;
  return secretValuePatterns.reduce(
    (content, pattern) => content.replace(pattern, (...matches) => {
      if (pattern === passwordPhrasePattern) {
        return `${matches[1]}[REDACTED]`;
      }
      return '[REDACTED]';
    }),
    value,
  );
}

export function createSensitiveContentStreamFilter() {
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      let boundary = Math.max(0, pending.length - 32);
      for (const pattern of [...secretValuePatterns, ...incompleteSecretPatterns]) {
        pattern.lastIndex = 0;
        let match = pattern.exec(pending);
        while (match) {
          if (match.index < boundary && match.index + match[0].length > boundary) {
            boundary = match.index;
          }
          match = pattern.exec(pending);
        }
      }
      const safe = redactSensitiveContent(pending.slice(0, boundary));
      pending = pending.slice(boundary);
      return safe;
    },
    flush() {
      const safe = redactSensitiveContent(pending);
      pending = '';
      return safe;
    },
  };
}

export function isSensitiveDisclosureRequest(value) {
  if (typeof value !== 'string') return false;
  if (instructionOverridePattern.test(value) || authBypassPattern.test(value) || otherUserAccessPattern.test(value)) {
    return true;
  }
  if (ownPasswordRecoveryPattern.test(value) && !explicitOwnPasswordDisclosurePattern.test(value)) {
    return false;
  }
  return disclosureIntentPattern.test(value)
    && (protectedInformationPattern.test(value) || environmentFilePattern.test(value));
}
