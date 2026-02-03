function toBase64Url(str: string) {
  return Buffer.from(str).toString('base64url');

  // return Buffer.from(str)
  //   .toString('base64')
  //   .replace(/\+/g, '-')
  //   .replace(/\//g, '_')
  //   .replace(/=+$/, '');
}

function fromBase64Url(b64url: string) {
  return Buffer.from(b64url, 'base64url').toString();

  // b64url = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // while (b64url.length % 4) b64url += '=';
  // return Buffer.from(b64url, 'base64').toString();
}

export function packObject(obj: object) {
  return toBase64Url(JSON.stringify(obj))
}

export function unpackObject<T = unknown>(state: string): Record<string, T> | null {
  try {
    return JSON.parse(fromBase64Url(state))
  } catch(e) {
    return null
  }
}
