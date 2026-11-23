import { createHash, timingSafeEqual } from 'node:crypto';

// Hash sha256 de la API key. Guardamos el hash, nunca la key en claro.
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// Comparación constant-time: ambos hashes sha256 tienen siempre 32 bytes.
export function keysEqual(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(
    Buffer.from(hashKey(provided), 'hex'),
    Buffer.from(hashKey(expected), 'hex')
  );
}
