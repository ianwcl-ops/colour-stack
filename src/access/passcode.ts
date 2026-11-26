/**
 * Family passcode gate. The game files are public on GitHub Pages, so this only
 * keeps the casual visitor out. A slow key-derivation makes guessing a long
 * passphrase impractical, so pick three or more words.
 */
const SALT = 'colour-stack/family-gate/v1';
const ITERATIONS = 150_000;

export function normalise(passcode: string): string {
  return passcode.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function hashPasscode(passcode: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(normalise(passcode)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ITERATIONS },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkPasscode(attempt: string, storedHash: string): Promise<boolean> {
  return (await hashPasscode(attempt)) === storedHash;
}
