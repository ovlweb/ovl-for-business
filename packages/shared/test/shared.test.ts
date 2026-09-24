import { describe, expect, it } from 'vitest';
import {
  canAssignRole,
  describeUserAgent,
  can,
  createApplicationSchema,
  formatAmount,
  getCurrency,
  parseAmount,
  percentOf,
  resolveQuorum,
  WORKFLOWS,
} from '../src';

describe('money', () => {
  it('parses and formats using the currency exponent', () => {
    expect(parseAmount('12.5', 'USD')).toBe(1250n);
    expect(parseAmount('100', 'JPY')).toBe(100n);
    expect(parseAmount('1.234', 'KWD')).toBe(1234n);
    expect(formatAmount(1250n, 'USD')).toBe('12.50');
    expect(formatAmount(-5n, 'EUR')).toBe('-0.05');
    expect(formatAmount(100n, 'JPY')).toBe('100');
  });

  it('rejects too many decimals and garbage', () => {
    expect(() => parseAmount('1.5', 'JPY')).toThrow(/decimal places/);
    expect(() => parseAmount('-1', 'USD')).toThrow();
    expect(() => parseAmount('1e5', 'USD')).toThrow();
  });

  it('knows world currencies', () => {
    expect(getCurrency('BHD').decimals).toBe(3);
    expect(() => getCurrency('XXX')).toThrow();
  });

  it('takes a percentage in basis points rounding down', () => {
    expect(percentOf(1001n, 3000)).toBe(300n);
  });
});

describe('roles', () => {
  it('keeps council out of tech support', () => {
    expect(can('council', 'support.answer')).toBe(false);
    expect(can('moderator', 'support.answer')).toBe(true);
    expect(can('owner', 'support.answer')).toBe(true);
  });

  it('limits role assignment', () => {
    expect(canAssignRole('admin', 'user', 'moderator')).toBe(true);
    expect(canAssignRole('admin', 'user', 'council')).toBe(false);
    expect(canAssignRole('admin', 'admin', 'user')).toBe(false);
    expect(canAssignRole('owner', 'user', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'user', 'owner')).toBe(false);
  });
});

describe('workflows', () => {
  it('license needs moderation, council and owner', () => {
    expect(WORKFLOWS.license.stages.map((s) => s.key)).toEqual(['moderation', 'council', 'owner']);
  });

  it('caps the council quorum by the council size', () => {
    const group = { roles: ['council' as const], quorum: 'council' as const };
    expect(resolveQuorum(group, 3, 10)).toBe(3);
    expect(resolveQuorum(group, 3, 2)).toBe(2);
    expect(resolveQuorum(group, 3, 0)).toBe(1);
  });

  it('validates application payloads', () => {
    const ok = createApplicationSchema.safeParse({
      type: 'license',
      payload: {
        licenseType: 'tv_channel',
        title: 'OVL TV',
        description: 'Virtual TV channel about business',
      },
    });
    expect(ok.success).toBe(true);
    const bad = createApplicationSchema.safeParse({
      type: 'license',
      payload: { licenseType: 'business', title: 'x', description: 'short' },
    });
    expect(bad.success).toBe(false);
  });
});

describe('describeUserAgent', () => {
  it('names browsers, apps and API clients', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toMatchObject({ name: 'Chrome on Windows', kind: 'desktop' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toMatchObject({ name: 'Safari on iOS', kind: 'mobile' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      ).name,
    ).toBe('Edge on macOS');
    expect(describeUserAgent('OVLBusiness/0.1.0 (android 15)')).toMatchObject({
      name: 'OVL Business app on Android',
      kind: 'app',
    });
    expect(describeUserAgent('node')).toMatchObject({ name: 'API client', kind: 'api' });
    expect(describeUserAgent(null).name).toBe('Unknown device');
  });
});
