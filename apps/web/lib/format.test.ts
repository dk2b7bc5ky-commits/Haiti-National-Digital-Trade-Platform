import { formatMoney, formatMoneyList, countdown } from './format';

describe('formatMoney', () => {
  it('renders integer minor units as major-unit currency', () => {
    expect(formatMoney(156000, 'USD')).toBe('$1,560.00');
    expect(formatMoney(500, 'USD')).toBe('$5.00');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
  });

  it('falls back gracefully for a malformed currency code', () => {
    // A malformed code (not 3 letters) makes Intl throw; we degrade to
    // "<amount> <code>" rather than crashing the render.
    expect(formatMoney(12345, 'US')).toBe('123.45 US');
  });
});

describe('formatMoneyList', () => {
  it('renders an em dash for an empty list', () => {
    expect(formatMoneyList([])).toBe('—');
  });

  it('joins multiple currencies with a plus', () => {
    expect(
      formatMoneyList([
        { amount: 156000, currency: 'USD' },
        { amount: 1000, currency: 'USD' },
      ]),
    ).toBe('$1,560.00 + $10.00');
  });
});

describe('countdown', () => {
  const now = new Date('2026-07-22T00:00:00.000Z');

  it('returns null when there is no last-free-day', () => {
    expect(countdown(null, now)).toBeNull();
  });

  it('flags an overdue deadline', () => {
    const c = countdown('2026-07-20T00:00:00.000Z', now)!;
    expect(c.tone).toBe('overdue');
    expect(c.days).toBeLessThan(0);
    expect(c.label).toContain('overdue');
  });

  it('flags due-today as overdue', () => {
    const c = countdown('2026-07-22T00:00:00.000Z', now)!;
    expect(c.tone).toBe('overdue');
    expect(c.label).toBe('due today');
  });

  it('marks a deadline within 3 days as soon', () => {
    const c = countdown('2026-07-24T00:00:00.000Z', now)!;
    expect(c.tone).toBe('soon');
    expect(c.days).toBe(2);
  });

  it('marks a distant deadline as ok', () => {
    const c = countdown('2026-08-05T00:00:00.000Z', now)!;
    expect(c.tone).toBe('ok');
  });
});
