let fallbackCounter = 0;

export function createClientId(prefix = 'id'): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') {
      return randomUUID.call(globalThis.crypto);
    }

    const getRandomValues = globalThis.crypto?.getRandomValues;
    if (typeof getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      getRandomValues.call(globalThis.crypto, bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // Fall through to non-cryptographic ID for non-secure HTTP origins.
  }

  fallbackCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
