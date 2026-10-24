// A field read off a decrypted row or intent is `unknown` until checked.
// String(field ?? '') turned an object into the text "[object Object]";
// this reads strings, numbers and booleans as written and anything else
// (absent, null, an object) as the empty string.
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
