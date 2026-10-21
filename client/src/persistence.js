// Versioned local saves and portable envelopes. Server exports use the server's key.
export const DATA_VERSION = 2;
export function migrateCharacter(character) {
  if (!character || ![1, DATA_VERSION].includes(character.version ?? 1)) throw new Error('Unsupported character data version.');
  return { ...character, version: DATA_VERSION, revision: character.revision ?? 0 };
}
export function decodeLocal(raw) {
  const value = JSON.parse(raw || '[]');
  if (Array.isArray(value)) return value.map(migrateCharacter);
  if (value?.format !== 'sloperberpunk-local-characters' || value.version !== DATA_VERSION || !Array.isArray(value.characters)) throw new Error('Unsupported local save version. Export or restore your original save before continuing.');
  return value.characters.map(migrateCharacter);
}
export function encodeLocal(characters) {
  return JSON.stringify({ format: 'sloperberpunk-local-characters', version: DATA_VERSION, characters: characters.map(migrateCharacter) });
}
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
function bytes(value) {
  if (typeof value !== 'string' || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) throw new Error('Invalid signature encoding.');
  return Uint8Array.from(value.match(/../g), b => parseInt(b, 16));
}
export async function localSigningIdentity(storage, subtle = crypto.subtle) {
  const storageKey = 'sloperberpunk.signing-key.v2';
  const existing = storage.getItem(storageKey);
  if (existing) {
    const record = JSON.parse(existing);
    if (record.version !== DATA_VERSION || record.algorithm !== 'Ed25519') throw new Error('Unsupported local signing key.');
    const privateKey = await subtle.importKey('pkcs8', bytes(record.privateKey), 'Ed25519', false, ['sign']);
    const publicKey = await subtle.importKey('raw', bytes(record.publicKey), 'Ed25519', true, ['verify']);
    const challenge = new TextEncoder().encode('sloperberpunk-key-check-v2');
    if (!await subtle.verify('Ed25519', publicKey, await subtle.sign('Ed25519', privateKey, challenge), challenge)) throw new Error('Local signing key does not match its public key.');
    return { privateKey, publicKey: record.publicKey };
  }
  const keys = await subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKey = hex(await subtle.exportKey('raw', keys.publicKey));
  storage.setItem(storageKey, JSON.stringify({ version: DATA_VERSION, algorithm: 'Ed25519', publicKey, privateKey: hex(await subtle.exportKey('pkcs8', keys.privateKey)) }));
  return { privateKey: keys.privateKey, publicKey };
}
export async function signLocalExport(simulation, identity, subtle = crypto.subtle) {
  const absolute = ready => Date.now() / 1000 + Math.max(0, ready - simulation.time);
  const payload = JSON.stringify({ format: 'sloperberpunk-character', version: DATA_VERSION, authority: 'local', exportedAt: Math.floor(Date.now() / 1000),
    character: migrateCharacter(simulation.character), cooldowns: Object.fromEntries(Object.entries(simulation.cooldowns).map(([id, ready]) => [id, absolute(ready)])),
    globalReady: absolute(simulation.globalReady), dashReady: absolute(simulation.dashReady), social: null });
  const signature = hex(await subtle.sign('Ed25519', identity.privateKey, new TextEncoder().encode(payload)));
  return { format: 'sloperberpunk-character-export', version: DATA_VERSION, algorithm: 'Ed25519', encoding: 'hex', publicKey: identity.publicKey, signature, payload };
}
export async function verifyExport(envelope, trustedPublicKey, subtle = crypto.subtle) {
  if (envelope?.format !== 'sloperberpunk-character-export' || envelope.version !== DATA_VERSION || envelope.algorithm !== 'Ed25519' || envelope.encoding !== 'hex' || envelope.publicKey !== trustedPublicKey || typeof envelope.payload !== 'string') throw new Error('Unsupported export or untrusted signing key.');
  const key = await subtle.importKey('raw', bytes(trustedPublicKey), 'Ed25519', false, ['verify']);
  if (!await subtle.verify('Ed25519', key, bytes(envelope.signature), new TextEncoder().encode(envelope.payload))) throw new Error('The character signature is invalid.');
  const payload = JSON.parse(envelope.payload);
  if (payload.format !== 'sloperberpunk-character' || payload.version !== DATA_VERSION || !['server', 'local'].includes(payload.authority)) throw new Error('Unsupported character payload.');
  return payload;
}
export function downloadCharacter(envelope, id) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sloperberpunk-${id}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
