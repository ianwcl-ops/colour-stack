/** No 0/O, 1/I/L, so codes are easy to read aloud or retype. */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 10;

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

export function roomLink(currentUrl: string, code: string): string {
  const url = new URL(currentUrl);
  url.search = '';
  url.hash = `room=${code}`;
  return url.toString();
}

export function roomFromHash(hash: string): string | null {
  const match = /room=([A-Za-z0-9]+)/.exec(hash);
  if (!match) return null;
  const code = match[1]!.toUpperCase();
  if (code.length !== LENGTH || ![...code].every((c) => ROOM_ALPHABET.includes(c))) return null;
  return code;
}
