import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('configuration', () => {
  it('treats settings passed empty (docker-compose `${X:-}`) as not set', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://ovl:ovl@localhost:5432/ovl',
      JWT_SECRET: 'x'.repeat(32),
      OIDC_ISSUER: '',
      S3_ENDPOINT: '',
      METRICS_TOKEN: '',
      PORT: '',
    });
    expect(config.OIDC_ISSUER).toBeUndefined();
    expect(config.S3_ENDPOINT).toBeUndefined();
    expect(config.METRICS_TOKEN).toBeUndefined();
    expect(config.PORT).toBe(4000);
  });
});
