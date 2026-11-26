import { Prisma } from '@prisma/client';

export type DecimalLike = Prisma.Decimal | number | string;

export const USD_SCALE = 12;

export function usd(value: DecimalLike | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function centsToUsd(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100).toDecimalPlaces(USD_SCALE);
}

export function usdToCents(value: DecimalLike | null | undefined): number {
  return usd(value).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export function usdNumber(value: DecimalLike | null | undefined): number {
  return usd(value).toNumber();
}

export function usdString(value: DecimalLike | null | undefined): string {
  return usd(value).toFixed(USD_SCALE);
}
