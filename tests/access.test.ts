import { describe, expect, it } from 'vitest';
import { hashPasscode, checkPasscode } from '../src/access/passcode';
import { newRoomCode, roomFromHash, roomLink, ROOM_ALPHABET } from '../src/access/room';

describe('family passcode', () => {
  it('hashes the same passcode the same way', async () => {
    expect(await hashPasscode('Sunny Rings')).toBe(await hashPasscode('Sunny Rings'));
  });

  it('ignores case and surrounding spaces so it is easy to type on a phone', async () => {
    expect(await hashPasscode('  sunny rings ')).toBe(await hashPasscode('Sunny Rings'));
  });

  it('accepts the right passcode and rejects a wrong one', async () => {
    const stored = await hashPasscode('sunny rings');
    expect(await checkPasscode('Sunny rings', stored)).toBe(true);
    expect(await checkPasscode('sunny ring', stored)).toBe(false);
  });
});

describe('room links', () => {
  it('makes long, unguessable codes from an unambiguous alphabet', () => {
    const code = newRoomCode();
    expect(code).toHaveLength(10);
    expect([...code].every((c) => ROOM_ALPHABET.includes(c))).toBe(true);
    expect(newRoomCode()).not.toBe(code);
  });

  it('puts the room in the # part of the link, which is never sent to any server', () => {
    expect(roomLink('https://x.github.io/game/?a=1#old', 'ABCDEFGHJK')).toBe('https://x.github.io/game/#room=ABCDEFGHJK');
  });

  it('reads a room back from the link', () => {
    expect(roomFromHash('#room=ABCDEFGHJK')).toBe('ABCDEFGHJK');
    expect(roomFromHash('#room=abcdefghjk')).toBe('ABCDEFGHJK');
    expect(roomFromHash('#room=bad!')).toBeNull();
    expect(roomFromHash('')).toBeNull();
  });
});
