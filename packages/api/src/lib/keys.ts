import { createHash } from 'node:crypto';

// Hash sha256 de la API key. Guardamos el hash, nunca la key en claro.
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
