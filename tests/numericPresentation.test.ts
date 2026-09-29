import { describe, expect, it } from 'vitest';
import { formatRankingValue } from '../src/analytics/presentation';
import { formatAcs, formatAdr, formatCount, formatCredits, formatPercent, formatRatio, formatScore } from '../src/utils/format';

describe('numeric presentation contract', () => {
  it('rounds only at the display boundary', () => {
    const precise = 331.0416666666667;
    expect(precise).toBe(331.0416666666667);
    expect(formatAcs(precise)).toBe('331.0');
    expect(formatAdr(149.9876)).toBe('150.0');
    expect(formatScore(52.456)).toBe('52.5');
    expect(formatRatio(1.48999)).toBe('1.49');
    expect(formatPercent(0.72345)).toBe('72.3%');
    expect(formatCredits(4399.7)).toBe('4,400');
    expect(formatCount(17.6)).toBe('18');
  });

  it('uses the same rules for sortable ranking metrics', () => {
    expect(formatRankingValue('acs', 331.0416666666667)).toBe('331.0');
    expect(formatRankingValue('adr', 149.9876)).toBe('150.0');
    expect(formatRankingValue('kd', 1.48999)).toBe('1.49');
    expect(formatRankingValue('kast', 0.72345)).toBe('72.3%');
    expect(formatRankingValue('firstKills', 7.4)).toBe('7');
    expect(formatRankingValue('overall', 52.456)).toBe('52.5');
  });

  it('renders non-finite and unavailable numeric output safely', () => {
    expect(formatScore(Number.NaN)).toBe('—');
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatPercent(Number.NEGATIVE_INFINITY)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
  });
});
