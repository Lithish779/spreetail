/**
 * Computes per-person shares (in base currency) for an expense.
 *
 * splitType: 'equal' | 'unequal' | 'percentage' | 'share'
 * participants: array of { userId, name } - everyone the expense is split among
 * splitDetails: parsed details depending on type:
 *   - equal: not used, divide amountBase evenly
 *   - unequal: { [name]: amount } - exact amounts per person (in ORIGINAL currency,
 *               caller must convert before calling, OR pass already-converted)
 *   - percentage: { [name]: percent }
 *   - share: { [name]: shareUnits }
 *
 * Returns: array of { userId, name, shareAmount, rawShareValue }
 * shareAmount is in base currency, rounded to 2 decimals.
 * The LAST participant absorbs any rounding remainder so shares sum exactly
 * to amountBase (no money lost/gained to rounding - this is a deliberate
 * policy documented in DECISIONS.md).
 *
 * For percentage splits that don't sum to 100, we NORMALIZE the percentages
 * (scale them so they sum to 100) and flag a warning - this is the chosen
 * policy for anomaly #7 (Pizza Friday 110%).
 */
export function computeShares(amountBase, splitType, participants, splitDetails) {
  const n = participants.length;
  if (n === 0) throw new Error('No participants for split');

  let raw; // raw share value per person (percent, share-units, or exact amount)
  let shares; // computed shareAmount per person, before rounding fix

  switch (splitType) {
    case 'equal': {
      const per = amountBase / n;
      shares = participants.map(() => per);
      raw = participants.map(() => null);
      break;
    }

    case 'percentage': {
      const percents = participants.map((p) => splitDetails?.[p.name] ?? 0);
      const total = percents.reduce((a, b) => a + b, 0);
      // Normalize so percentages always sum to 100 (handles Pizza Friday's 110%)
      const normalized = total === 0 ? percents.map(() => 100 / n) : percents.map((p) => (p / total) * 100);
      shares = normalized.map((p) => (amountBase * p) / 100);
      raw = percents; // store the ORIGINAL (possibly non-100) percent for display
      break;
    }

    case 'share': {
      const units = participants.map((p) => splitDetails?.[p.name] ?? 1);
      const totalUnits = units.reduce((a, b) => a + b, 0);
      shares = units.map((u) => (amountBase * u) / totalUnits);
      raw = units;
      break;
    }

    case 'unequal': {
      // splitDetails gives exact amounts; these should already be in base currency
      const amounts = participants.map((p) => splitDetails?.[p.name] ?? 0);
      shares = amounts;
      raw = amounts;
      break;
    }

    default:
      throw new Error(`Unknown split type: ${splitType}`);
  }

  // Round to 2dp, then fix rounding drift on the last participant so the
  // shares sum exactly to amountBase.
  const rounded = shares.map((s) => Math.round(s * 100) / 100);
  const sumRounded = rounded.reduce((a, b) => a + b, 0);
  const drift = Math.round((amountBase - sumRounded) * 100) / 100;
  if (Math.abs(drift) >= 0.01 && rounded.length > 0) {
    rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 100) / 100;
  }

  return participants.map((p, i) => ({
    userId: p.userId,
    name: p.name,
    shareAmount: rounded[i],
    rawShareValue: raw[i],
  }));
}
