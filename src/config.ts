import { FAMILY_PASSCODE_HASH } from './access/family-passcode';
import { localTransport, peerTransport, type TransportFactory } from './net/transport';

/** True only in the separate build used by automated browser tests. */
export const E2E = import.meta.env.VITE_E2E === '1';

/** The e2e build uses the passcode "test passcode"; the real build uses the family one. */
export const PASSCODE_HASH = E2E ? 'bf195186b5514785f42f9c7c5115f564b868306b7b00bde8ae08b09cacd45679' : FAMILY_PASSCODE_HASH;

export const transport: TransportFactory = E2E ? localTransport : peerTransport;
