import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm'
const EXPIRY_DURATION_SEC = 20

// secret key must be exactly 32 bytes (256 bits)
// `openssl rand -hex 32`
export function sealState(obj: object, secretKeyHex32Bytes: string) {
  if (!obj || !secretKeyHex32Bytes) {
    const message = `[sealState] Invalid call! obj: ${!!obj}, secretKeyHex32Bytes: ${!!secretKeyHex32Bytes}`
    throw new Error(message)
  }

  const secret = Buffer.from(secretKeyHex32Bytes, 'hex');
  if (secret.length !== 32) {
    throw new Error(`[sealState] Invalid secret key length: ${secret.length}`)
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, secret, iv);

  const expiry = Date.now() + EXPIRY_DURATION_SEC * 1000;
  const encryptedData = Buffer.concat([
    cipher.update(JSON.stringify({ ...obj, expiry })),
    cipher.final()
  ]);

  const sealed = Buffer.concat([
    iv,
    cipher.getAuthTag(),
    encryptedData
  ]);

  return sealed.toString('base64url');
}

// secret key must be exactly 32 bytes (256 bits)
// `openssl rand -hex 32`
export function openState(sealed: string, secretKeyHex32Bytes: string) {
  if (!sealed || !secretKeyHex32Bytes) {
    const message = `[openState] Invalid call! sealed: ${!!sealed}, secretKeyHex32Bytes: ${!!secretKeyHex32Bytes}`
    throw new Error(message)
  }

  const secret = Buffer.from(secretKeyHex32Bytes, 'hex');
  if (secret.length !== 32) {
    throw new Error(`[openState] Invalid secret key length: ${secret.length}`)
  }

  const buf = Buffer.from(sealed, 'base64url');

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encryptedData = buf.subarray(28);

  const decipher = crypto.createDecipheriv(ALGO, secret, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final()
  ]);
  const plaintext = decrypted.toString();

  const obj = JSON.parse(plaintext);
  const expiry = obj.expiry;
  delete obj.expiry;

  const expiresIn = expiry - Date.now()
  if (expiresIn > 0) {
    return obj;
  }
  return null;
}
