// Verify and download server-signed character exports. GPL-3.0-or-later.
export const DATA_VERSION = 2;
function bytes(value) {
  if (typeof value !== 'string' || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) throw new Error('Invalid signature encoding.');
  return Uint8Array.from(value.match(/../g), b => parseInt(b, 16));
}
export async function verifyExport(envelope, trustedPublicKey, subtle = crypto.subtle) {
  if (envelope?.format !== 'sloperberpunk-character-export' || envelope.version !== DATA_VERSION || envelope.algorithm !== 'Ed25519' || envelope.encoding !== 'hex' || envelope.publicKey !== trustedPublicKey || typeof envelope.payload !== 'string') throw new Error('Unsupported export or untrusted signing key.');
  const key = await subtle.importKey('raw', bytes(trustedPublicKey), 'Ed25519', false, ['verify']);
  if (!await subtle.verify('Ed25519', key, bytes(envelope.signature), new TextEncoder().encode(envelope.payload))) throw new Error('The character signature is invalid.');
  const payload = JSON.parse(envelope.payload);
  if (payload.format !== 'sloperberpunk-character' || payload.version !== DATA_VERSION || payload.authority !== 'server') throw new Error('Unsupported character payload.');
  return payload;
}
export function downloadCharacter(envelope, id) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sloperberpunk-${id}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
