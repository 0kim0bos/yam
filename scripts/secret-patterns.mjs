const repeatedPlaceholder = /^(?:x+|0+|\*+|_+)$/i;
const placeholderWords = /\b(?:example|placeholder|redacted|changeme|replace[_-]?me|your[_-]?(?:token|key|secret)|fake[_-]?(?:token|key|secret)|test[_-]?(?:token|key|secret))\b/i;

function tokenBody(value) {
  const separator = value.lastIndexOf('=');
  if (separator >= 0) return value.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  return value.replace(
    /^(?:npm_|gh[pousr]_|github_pat_|sk-ant-(?:api\d{2}-)?|sk-(?:(?:proj|svcacct)-)?)/i,
    '',
  );
}

function isPlaceholder(value) {
  const normalized = value.trim();
  const body = tokenBody(normalized);
  return (
    placeholderWords.test(normalized)
    || repeatedPlaceholder.test(body)
    || normalized === 'AKIAIOSFODNN7EXAMPLE'
  );
}

export const SECRET_PATTERNS = Object.freeze([
  {
    id: 'private_key',
    regex: /-----BEGIN (?:PRIVATE KEY|(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g,
  },
  {
    id: 'npm_token',
    regex: /\bnpm_[A-Za-z0-9]{36,}\b/g,
    ignore: isPlaceholder,
  },
  {
    id: 'npm_auth_token',
    regex: /(?:\/\/registry\.npmjs\.org\/:)?_authToken\s*=\s*['"]?[A-Za-z0-9._-]{20,}['"]?/gi,
    ignore: isPlaceholder,
  },
  {
    id: 'github_token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    ignore: isPlaceholder,
  },
  {
    id: 'github_fine_grained_token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g,
    ignore: isPlaceholder,
  },
  {
    id: 'openai_api_key',
    regex: /\bsk-(?!ant-)(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}\b/g,
    ignore: isPlaceholder,
  },
  {
    id: 'anthropic_api_key',
    regex: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g,
    ignore: isPlaceholder,
  },
  {
    id: 'aws_access_key_id',
    regex: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
    ignore: isPlaceholder,
  },
  {
    id: 'aws_secret_access_key',
    regex: /\b(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g,
    ignore: isPlaceholder,
  },
]);

export function inspectSecretPatterns(value) {
  const ids = [];
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    redacted = redacted.replace(pattern.regex, (match) => {
      if (pattern.ignore?.(match)) return match;
      ids.push(pattern.id);
      return `[redacted:${pattern.id}]`;
    });
  }
  return { patternIds: [...new Set(ids)], redacted };
}

export function findSecretPatternIds(value) {
  return inspectSecretPatterns(value).patternIds;
}
