/**
 * Safe Financial Math Utilities for Loan Accounting
 *
 * All monetary amounts are stored and calculated strictly as integer paise using BigInt.
 * Floating-point arithmetic is NEVER used for monetary values.
 * Half-up rounding is strictly enforced for division.
 */

/**
 * Divides numerator by denominator using integer arithmetic with half-up rounding.
 * Half-up rounding rounds towards the nearest integer; if the fractional part is
 * exactly 0.5 (or greater), it rounds up (away from zero for positive numbers).
 *
 * Mathematical equivalence:
 * For n >= 0, d > 0:
 *   roundHalfUp(n / d) = floor((2*n + d) / (2*d))
 *
 * @param numerator BigInt numerator
 * @param denominator BigInt denominator (must be non-zero)
 * @returns BigInt quotient rounded half-up
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('Division by zero');
  }
  if (numerator === 0n) {
    return 0n;
  }

  const isNegative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  // (2*n + d) / (2*d) gives exact half-up rounding for all integers
  const quotient = (2n * n + d) / (2n * d);

  return isNegative ? -quotient : quotient;
}

/**
 * Greatest common divisor using Euclidean algorithm for BigInt.
 */
export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Fast exponentiation by squaring for BigInt base and integer exponent.
 * O(log exp) time complexity.
 */
export function bigIntPow(base: bigint, exp: number): bigint {
  if (exp < 0) {
    throw new Error('Negative exponents are not supported for integer powers');
  }
  if (exp === 0) {
    return 1n;
  }
  if (base === 0n) {
    return 0n;
  }
  if (base === 1n) {
    return 1n;
  }

  let result = 1n;
  let currentBase = base;
  let currentExp = exp;

  while (currentExp > 0) {
    if (currentExp % 2 === 1) {
      result *= currentBase;
    }
    currentBase *= currentBase;
    currentExp = Math.floor(currentExp / 2);
  }

  return result;
}

/**
 * Safely converts an integer paise amount to a decimal string representation (INR)
 * without using JavaScript floating-point numbers.
 *
 * Example:
 * 123456n -> "1234.56"
 * 5n -> "0.05"
 * 0n -> "0.00"
 * -100n -> "-1.00"
 */
export function paiseToRupees(paise: bigint): string {
  const isNegative = paise < 0n;
  const abs = isNegative ? -paise : paise;
  const rupees = abs / 100n;
  const remainder = abs % 100n;
  const remainderStr = remainder < 10n ? `0${remainder}` : `${remainder}`;
  return `${isNegative ? '-' : ''}${rupees}.${remainderStr}`;
}

/**
 * Safely converts a decimal currency string (INR) to integer paise
 * without using floating-point arithmetic.
 *
 * Example:
 * "1234.56" -> 123456n
 * "100" -> 10000n
 * "0.5" -> 50n
 */
export function rupeesToPaise(rupees: string | number): bigint {
  const str = String(rupees).trim();
  if (!str) {
    throw new Error('Invalid rupee string: empty input');
  }

  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;

  const parts = cleanStr.split('.');
  if (parts.length > 2) {
    throw new Error(`Invalid currency format: ${str}`);
  }

  const wholePart = parts[0] || '0';
  let fractionPart = parts[1] || '';

  if (!/^\d+$/.test(wholePart) || (fractionPart && !/^\d+$/.test(fractionPart))) {
    throw new Error(`Invalid numeric characters in: ${str}`);
  }

  // Truncate or pad fraction to exactly 2 digits
  if (fractionPart.length === 0) {
    fractionPart = '00';
  } else if (fractionPart.length === 1) {
    fractionPart = `${fractionPart}0`;
  } else if (fractionPart.length > 2) {
    // Round third digit half-up
    const extra = parseInt(fractionPart[2], 10);
    let cents = parseInt(fractionPart.slice(0, 2), 10);
    if (extra >= 5) {
      cents += 1;
    }
    fractionPart = cents < 10 ? `0${cents}` : `${cents}`;
  }

  const result = BigInt(wholePart) * 100n + BigInt(fractionPart);
  return isNegative ? -result : result;
}
