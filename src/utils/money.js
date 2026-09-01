/* Money helpers.

   Money in this schema is stored across three incompatible types — Float
   (payments, profit, prices), Decimal(10,2) (deposit_amount) and even VARCHAR
   (total_cost_for_equipment, vat_value, event_amount_without_vat). That mix is
   the root cause of several reconciliation bugs, so all money arithmetic and
   comparison should go through these helpers rather than raw Number()/===.

   Not a substitute for fixing the column types, but it makes the running system
   correct today without a risky schema migration on go-live day. */

/**
 * Parse any money-ish value to a finite Number of pounds.
 * Handles Prisma Decimal objects, numbers, and dirty strings ("£4,650",
 * "4650.00", and the literal "NaN" that exists in the events table). Returns 0
 * for anything unparseable — never NaN, which would silently poison sums and
 * the fully-paid comparison.
 */
export function toMoney(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  try {
    // Prisma Decimal and other objects expose toString(); guarded because old/
    // corrupt data must never throw and take a request down with it.
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'nan') return 0;
    const cleaned = s.replace(/[^0-9.-]/g, ''); // strip £, commas, spaces
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  }
}

/** Round to 2 decimal places, killing binary-float artifacts (117.499999… → 117.5). */
export function round2(v) {
  const n = toMoney(v);
  // +Number.EPSILON nudges exact .5 cases the expected way before rounding.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sum a list of money-ish values with per-step rounding to avoid drift. */
export function sumMoney(values = []) {
  return round2(values.reduce((acc, v) => acc + toMoney(v), 0));
}

/**
 * Is an event fully paid? Mirrors Laravel's `($totalPayment == $totalCost) ?
 * 1 : 0` (used identically in EventNotesController.php and EventService.php)
 * rather than a "more correct" >= check, because parity with the legacy app's
 * behaviour is the point here, not independently redefining what "paid" means.
 *
 * PHP's loose `==` means a null/"0"/0 cost compares equal to a 0 payment, so
 * an unpriced event with nothing paid reads as "fully paid" by default — kept
 * here via the cost<=0 special case. It also means overpayment is NOT "fully
 * paid" (an exact match is required), unlike a >= comparison. round2() is
 * still used on both sides so float drift can't produce a false negative on
 * an otherwise-exact match.
 */
export function isFullyPaid(paid, cost) {
  const c = round2(cost);
  const p = round2(paid);
  if (c <= 0) return p <= 0;
  return p === c;
}

export default { toMoney, round2, sumMoney, isFullyPaid };
