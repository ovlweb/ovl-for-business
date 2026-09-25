import { getCurrency } from '@ovl/shared';
import type { Db } from '../db/client';
import { exchangeRates, platformSettings } from '../db/schema';
import { eq } from 'drizzle-orm';

/** Rates are kept with 12 decimals as integers so conversions stay exact. */
const SCALE = 12;
const ONE = 10n ** BigInt(SCALE);

export function toScaled(decimal: string): bigint {
  const [whole, fraction = ''] = decimal.split('.');
  return BigInt(whole! + fraction.padEnd(SCALE, '0').slice(0, SCALE));
}

export function fromScaled(value: bigint, decimals = 6): string {
  const s = value.toString().padStart(SCALE + 1, '0');
  const whole = s.slice(0, -SCALE);
  const fraction = s.slice(-SCALE, -SCALE + decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export interface RateTable {
  base: string;
  /** Fee in basis points (0.5% = 50). */
  feeBasisPoints: bigint;
  feePercent: string;
  rates: Map<string, { rate: bigint; updatedAt: Date }>;
}

export const DEFAULT_EXCHANGE = { base: 'USD', feePercent: '0.5' };

export async function loadRateTable(db: Db): Promise<RateTable> {
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'exchange'));
  const { base, feePercent } = {
    ...DEFAULT_EXCHANGE,
    ...(settings?.value as Partial<typeof DEFAULT_EXCHANGE>),
  };
  const rows = await db.select().from(exchangeRates);
  return {
    base,
    feePercent,
    feeBasisPoints: toScaled(feePercent) / 10n ** BigInt(SCALE - 2),
    rates: new Map(rows.map((r) => [r.currency, { rate: toScaled(r.rate), updatedAt: r.updatedAt }])),
  };
}

export function rateOf(table: RateTable, currency: string): bigint | null {
  if (currency === table.base) return ONE;
  return table.rates.get(currency)?.rate ?? null;
}

/** Convert minor units from one currency to another (rounded down), or null without rates. */
export function convert(amount: bigint, from: string, to: string, table: RateTable): bigint | null {
  const rFrom = rateOf(table, from);
  const rTo = rateOf(table, to);
  if (!rFrom || !rTo) return null;
  const dFrom = BigInt(getCurrency(from).decimals);
  const dTo = BigInt(getCurrency(to).decimals);
  return (amount * rFrom * 10n ** dTo) / (rTo * 10n ** dFrom);
}

/** Target units per source unit, for display. */
export function crossRate(from: string, to: string, table: RateTable): string | null {
  const rFrom = rateOf(table, from);
  const rTo = rateOf(table, to);
  if (!rFrom || !rTo) return null;
  return fromScaled((rFrom * ONE) / rTo, 6);
}
