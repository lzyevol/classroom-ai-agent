const SECRET_ASSIGNMENT = /(api[_-]?key|token|password)\s*[:=]\s*["']?([^\s,;"']+)/gi;
const BEARER_TOKEN = /bearer\s+[^\s,;]+/gi;
const PROVIDER_KEY = /\bsk-[a-z0-9_-]{8,}\b/gi;

export function redactSensitiveText(value: string, maximumLength = 500): string {
  const redacted = value
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(PROVIDER_KEY, "[REDACTED_KEY]")
    .replace(SECRET_ASSIGNMENT, (_, label: string) => `${label}=[REDACTED]`);

  return redacted.length > maximumLength
    ? `${redacted.slice(0, maximumLength)}…`
    : redacted;
}
