declare module 'http_ece' {
  import type { ECDH } from 'node:crypto';

  const ece: {
    decrypt(buffer: Buffer, params: { version: 'aes128gcm'; privateKey: ECDH; authSecret: Buffer }): Buffer;
  };
  export default ece;
}
