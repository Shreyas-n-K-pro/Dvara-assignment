import {
  divRoundHalfUp,
  gcd,
  bigIntPow,
  paiseToRupees,
  rupeesToPaise,
} from '../../src/utils/math';

describe('Financial Math Utilities', () => {
  describe('divRoundHalfUp', () => {
    it('should calculate exact integer divisions correctly', () => {
      expect(divRoundHalfUp(4n, 2n)).toBe(2n);
      expect(divRoundHalfUp(6n, 3n)).toBe(2n);
      expect(divRoundHalfUp(100n, 10n)).toBe(10n);
      expect(divRoundHalfUp(0n, 5n)).toBe(0n);
    });

    it('should round exactly 0.5 upwards (half-up) for positive values', () => {
      // 1/2 = 0.5 -> 1
      expect(divRoundHalfUp(1n, 2n)).toBe(1n);
      // 3/2 = 1.5 -> 2
      expect(divRoundHalfUp(3n, 2n)).toBe(2n);
      // 5/2 = 2.5 -> 3
      expect(divRoundHalfUp(5n, 2n)).toBe(3n);
      // 2/4 = 0.5 -> 1
      expect(divRoundHalfUp(2n, 4n)).toBe(1n);
      // 6/4 = 1.5 -> 2
      expect(divRoundHalfUp(6n, 4n)).toBe(2n);
    });

    it('should round values strictly less than 0.5 downwards', () => {
      // 1/3 = 0.333... -> 0
      expect(divRoundHalfUp(1n, 3n)).toBe(0n);
      // 1/4 = 0.25 -> 0
      expect(divRoundHalfUp(1n, 4n)).toBe(0n);
      // 3/8 = 0.375 -> 0
      expect(divRoundHalfUp(3n, 8n)).toBe(0n);
      // 4/10 = 0.4 -> 0
      expect(divRoundHalfUp(4n, 10n)).toBe(0n);
      // 14/10 = 1.4 -> 1
      expect(divRoundHalfUp(14n, 10n)).toBe(1n);
    });

    it('should round values strictly greater than 0.5 upwards', () => {
      // 2/3 = 0.666... -> 1
      expect(divRoundHalfUp(2n, 3n)).toBe(1n);
      // 3/4 = 0.75 -> 1
      expect(divRoundHalfUp(3n, 4n)).toBe(1n);
      // 5/8 = 0.625 -> 1
      expect(divRoundHalfUp(5n, 8n)).toBe(1n);
      // 6/10 = 0.6 -> 1
      expect(divRoundHalfUp(6n, 10n)).toBe(1n);
      // 16/10 = 1.6 -> 2
      expect(divRoundHalfUp(16n, 10n)).toBe(2n);
    });

    it('should throw an error on division by zero', () => {
      expect(() => divRoundHalfUp(10n, 0n)).toThrow('Division by zero');
    });

    it('should handle negative numbers consistently', () => {
      expect(divRoundHalfUp(-1n, 2n)).toBe(-1n);
      expect(divRoundHalfUp(-3n, 2n)).toBe(-2n);
      expect(divRoundHalfUp(1n, -2n)).toBe(-1n);
      expect(divRoundHalfUp(-1n, -2n)).toBe(1n);
    });

    it('should handle large BigInt values without precision degradation', () => {
      const largeNum = 1000000000000000000000000000001n;
      const largeDen = 2n;
      expect(divRoundHalfUp(largeNum, largeDen)).toBe(500000000000000000000000000001n);
    });
  });

  describe('gcd', () => {
    it('should calculate the greatest common divisor', () => {
      expect(gcd(12n, 8n)).toBe(4n);
      expect(gcd(17n, 19n)).toBe(1n);
      expect(gcd(1200n, 120000n)).toBe(1200n);
      expect(gcd(520000n, 1500n)).toBe(500n);
      expect(gcd(0n, 5n)).toBe(5n);
      expect(gcd(5n, 0n)).toBe(5n);
    });
  });

  describe('bigIntPow', () => {
    it('should compute powers correctly', () => {
      expect(bigIntPow(2n, 0)).toBe(1n);
      expect(bigIntPow(2n, 1)).toBe(2n);
      expect(bigIntPow(2n, 10)).toBe(1024n);
      expect(bigIntPow(10n, 5)).toBe(100000n);
      expect(bigIntPow(0n, 5)).toBe(0n);
      expect(bigIntPow(1n, 1000)).toBe(1n);
    });

    it('should throw on negative exponents', () => {
      expect(() => bigIntPow(2n, -1)).toThrow('Negative exponents are not supported');
    });

    it('should compute large compound powers safely', () => {
      const result = bigIntPow(101n, 12);
      expect(result).toBe(1126825030131969720661201n);
    });
  });

  describe('paiseToRupees and rupeesToPaise', () => {
    it('should convert paise to rupee formatted string', () => {
      expect(paiseToRupees(123456n)).toBe('1234.56');
      expect(paiseToRupees(100n)).toBe('1.00');
      expect(paiseToRupees(5n)).toBe('0.05');
      expect(paiseToRupees(0n)).toBe('0.00');
      expect(paiseToRupees(-50n)).toBe('-0.50');
    });

    it('should convert rupee string to paise without floating point issues', () => {
      expect(rupeesToPaise('1234.56')).toBe(123456n);
      expect(rupeesToPaise('100')).toBe(10000n);
      expect(rupeesToPaise('0.5')).toBe(50n);
      expect(rupeesToPaise('0.05')).toBe(5n);
      expect(rupeesToPaise('-10.25')).toBe(-1025n);
      // Half-up rounding on third decimal
      expect(rupeesToPaise('10.255')).toBe(1026n);
      expect(rupeesToPaise('10.254')).toBe(1025n);
    });

    it('should throw on invalid currency string', () => {
      expect(() => rupeesToPaise('')).toThrow('Invalid rupee string');
      expect(() => rupeesToPaise('abc')).toThrow('Invalid numeric characters');
      expect(() => rupeesToPaise('12.34.56')).toThrow('Invalid currency format');
    });
  });
});
