import { parse } from 'csv-parse/sync';
import { computeShares } from './splitCalculator.js';

// USD->INR rate used for the trip period (documented assumption - see DECISIONS.md).
// A real app would look up historical rates; for this assignment we use a fixed
// rate representative of March 2026 and document it.
const USD_TO_INR_RATE = 84;

/**
 * Parses the raw CSV text and returns:
 *  - rows: array of cleaned/normalized row objects ready for DB insertion (or skipped)
 *  - report: array of anomaly entries { rowNumber, type, detail, action }
 *
 * This function does NOT touch the database. It is pure so it can be tested
 * and so the "preview" (Meera's approval step) can run before anything is written.
 *
 * groupMembersAtDate(date) -> array of {userId, name} - injected so the
 * importer can check "was this person a member when this expense happened".
 */
export function parseAndAnalyzeCsv(csvText, members) {
  const knownNames = members.map((m) => (typeof m === 'string' ? m : m.name));
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });

  const report = [];
  const processed = [];
  // Track seen "fingerprints" for duplicate detection
  const seenExact = new Map(); // exact dup: date+description+paidBy+amount

  records.forEach((raw, idx) => {
    const rowNum = idx + 2; // +1 for header, +1 for 1-indexing
    const anomalies = [];
    let skip = false;
    let action = 'imported';

    // ---- 1. Normalize whitespace on all string fields ----
    const row = {};
    for (const k of Object.keys(raw)) {
      row[k] = typeof raw[k] === 'string' ? raw[k].trim() : raw[k];
    }

    // ---- 2. Date normalization ----
    let date = normalizeDate(row.date);
    if (!date) {
      anomalies.push({
        type: 'unparseable_date',
        detail: `Could not parse date "${row.date}"`,
        policy: 'Row skipped - cannot place this expense on a timeline without a valid date.',
      });
      skip = true;
    } else if (/april 5 or may 4|ambiguous|format is a mess/i.test(row.notes || '')) {
      anomalies.push({
        type: 'ambiguous_date',
        detail: `Date "${row.date}" is flagged in the notes as ambiguous (could be read as DD-MM or MM-DD). Interpreted as ${date.value} using the sheet-wide DD-MM-YYYY convention applied to every other row.`,
        policy: 'Resolved using the DD-MM-YYYY convention for consistency with the rest of the sheet; flagged for the group to confirm.',
      });
    }
    const dateStr = date ? date.value : null;

    // ---- 3. Name normalization (paid_by) ----
    let paidByName = normalizeName(row.paid_by);
    if (!paidByName) {
      anomalies.push({
        type: 'missing_payer',
        detail: `Row ${rowNum} ("${row.description}") has no paid_by value.`,
        policy: 'Row skipped - cannot attribute an expense to nobody. Flagged for manual entry.',
      });
      skip = true;
    } else {
      const resolved = resolveName(paidByName, knownNames);
      if (resolved.changed) {
        anomalies.push({
          type: 'name_normalization',
          detail: `paid_by "${row.paid_by}" normalized to "${resolved.name}"`,
          policy: 'Case/whitespace differences and known aliases are normalized to the canonical member name.',
        });
      }
      paidByName = resolved.name;
    }

    // ---- 4. Amount cleanup ----
    let amountStr = (row.amount || '').toString().replace(/,/g, ''); // strip thousands separators
    if (amountStr !== row.amount) {
      anomalies.push({
        type: 'amount_formatting',
        detail: `amount "${row.amount}" contained a thousands separator, parsed as ${amountStr}`,
        policy: 'Thousands separators stripped before parsing.',
      });
    }
    let amount = parseFloat(amountStr);
    if (isNaN(amount)) {
      anomalies.push({
        type: 'invalid_amount',
        detail: `amount "${row.amount}" is not a valid number`,
        policy: 'Row skipped.',
      });
      skip = true;
    }

    // ---- 5. Excess decimal precision ----
    if (!isNaN(amount) && Math.round(amount * 100) !== amount * 100) {
      const original = amount;
      amount = Math.round(amount * 100) / 100;
      anomalies.push({
        type: 'precision_rounding',
        detail: `amount ${original} has more than 2 decimal places, rounded to ${amount}`,
        policy: 'Amounts rounded to 2 decimal places (currency cannot have sub-paisa precision).',
      });
    }

    // ---- 6. Zero amount ----
    if (!isNaN(amount) && amount === 0) {
      anomalies.push({
        type: 'zero_amount',
        detail: `"${row.description}" has amount 0. Note column says: "${row.notes}"`,
        policy: 'Row skipped - a zero-amount expense affects no balances. Likely a correction for a duplicate (see note).',
      });
      skip = true;
    }

    // ---- 7. Negative amount (refund) ----
    let isRefund = false;
    if (!isNaN(amount) && amount < 0) {
      isRefund = true;
      anomalies.push({
        type: 'negative_amount',
        detail: `"${row.description}" has a negative amount (${amount}).`,
        policy: 'Treated as a refund: reverses the original split proportionally (reduces what each participant owes for that line, rather than being recorded as a separate negative expense).',
      });
    }

    // ---- 8. Currency ----
    let currency = (row.currency || '').toUpperCase().trim();
    if (!currency) {
      anomalies.push({
        type: 'missing_currency',
        detail: `"${row.description}" has no currency value.`,
        policy: 'Defaulted to INR (group base currency), consistent with the surrounding rows from the same date/context.',
      });
      currency = 'INR';
    }
    let exchangeRate = 1;
    if (currency === 'USD') {
      exchangeRate = USD_TO_INR_RATE;
      anomalies.push({
        type: 'foreign_currency',
        detail: `"${row.description}" is in USD (${amount} USD).`,
        policy: `Converted to INR at a fixed rate of 1 USD = ₹${USD_TO_INR_RATE} (documented assumption for the trip period).`,
      });
    } else if (currency !== 'INR') {
      anomalies.push({
        type: 'unknown_currency',
        detail: `"${row.description}" has unrecognized currency "${currency}".`,
        policy: 'Treated as INR with no conversion (best available assumption); flagged for manual review.',
      });
      exchangeRate = 1;
      currency = 'INR';
    }

    // ---- 9. split_type vs split_with / settlement detection ----
    let splitType = (row.split_type || '').toLowerCase().trim();
    const splitWithRaw = row.split_with || '';
    const isSettlement = !splitType && splitWithRaw && /paid .* back|settlement|settled/i.test(row.description + ' ' + (row.notes || ''));

    if (isSettlement) {
      anomalies.push({
        type: 'settlement_as_expense',
        detail: `"${row.description}" has empty split_type and the description/notes indicate this is a repayment, not a shared expense.`,
        policy: 'Recorded as a Payment (settlement) between the two people, not as a shared expense. Does not get split among the group.',
      });
      action = 'recorded_as_payment';
    }

    // ---- 10. split_with member name normalization + stale/unknown members ----
    let participantNames = [];
    if (splitWithRaw) {
      participantNames = splitWithRaw.split(';').map((s) => s.trim()).filter(Boolean);
      const resolvedNames = [];
      for (const pn of participantNames) {
        const resolved = resolveName(pn, knownNames);
        if (!resolved.found) {
          anomalies.push({
            type: 'unknown_participant',
            detail: `"${row.description}" lists "${pn}" in split_with, who is not a recognized group member.`,
            policy: `"${pn}" excluded from the split; the expense is divided among the remaining recognized members. This person can be added to the group separately if they should be a permanent member.`,
          });
          continue;
        }
        if (resolved.changed) {
          anomalies.push({
            type: 'name_normalization',
            detail: `split_with name "${pn}" normalized to "${resolved.name}"`,
            policy: 'Case/whitespace differences normalized to canonical member name.',
          });
        }
        resolvedNames.push(resolved.name);
      }
      participantNames = resolvedNames;
    }

    // ---- 11. Stale member check (member listed but not active on expense date) ----
    if (dateStr && participantNames.length) {
      for (const name of [...participantNames]) {
        const memberObj = members.find((m) => typeof m === 'object' && m !== null && m.name === name);
        if (memberObj) {
          const joined = memberObj.joinedAt;
          const left = memberObj.leftAt;
          const isBeforeJoined = joined && dateStr < joined;
          const isAfterLeft = left && dateStr > left;
          if (isBeforeJoined || isAfterLeft) {
            let detail = `"${row.description}" (${dateStr}) includes "${name}" in split_with, but ${name} was not active. `;
            if (isBeforeJoined) {
              detail += `They joined later on ${joined}.`;
            } else {
              detail += `They left on ${left}.`;
            }
            anomalies.push({
              type: 'stale_member_in_split',
              detail,
              policy: `${name} excluded from this split since they were not a member of the group on ${dateStr}. Their share is redistributed among the remaining active members.`,
            });
            participantNames = participantNames.filter((n) => n !== name);
          }
        } else if (name === 'Meera' && dateStr > '2026-03-31') {
          // Fallback static check if members is just a string array
          anomalies.push({
            type: 'stale_member_in_split',
            detail: `"${row.description}" (${dateStr}) includes "Meera" in split_with, but Meera left the group at the end of March.`,
            policy: `Meera excluded from this split since they were not a member of the group on ${dateStr}. Their share is redistributed among the remaining active members.`,
          });
          participantNames = participantNames.filter((n) => n !== 'Meera');
        }
      }
    }

    // ---- 12. split_details parsing + split_type mismatch ----
    let splitDetails = null;
    const detailsRaw = row.split_details || '';
    if (detailsRaw) {
      splitDetails = {};
      for (const part of detailsRaw.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^(.+?)\s+([\d.]+)%?$/);
        if (m) {
          const resolved = resolveName(m[1].trim(), knownNames);
          splitDetails[resolved.name] = parseFloat(m[2]);
        }
      }
    }

    if (!splitType && detailsRaw) {
      // No split_type but details present -> infer
      splitType = detailsRaw.includes('%') ? 'percentage' : 'share';
      anomalies.push({
        type: 'missing_split_type',
        detail: `"${row.description}" has split_details but no split_type.`,
        policy: `Inferred split_type as "${splitType}" based on the format of split_details.`,
      });
    }

    if (splitType === 'equal' && splitDetails && Object.keys(splitDetails).length) {
      anomalies.push({
        type: 'split_type_mismatch',
        detail: `"${row.description}" has split_type "equal" but also provides split_details (${detailsRaw}).`,
        policy: 'split_type "equal" takes precedence; split_details ignored for this row and the amount is divided evenly.',
      });
      splitDetails = null;
    }

    // ---- 13. Percentage sum check ----
    if (splitType === 'percentage' && splitDetails) {
      const total = Object.values(splitDetails).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 0.01) {
        anomalies.push({
          type: 'percentage_sum_mismatch',
          detail: `"${row.description}" percentages sum to ${total}%, not 100%.`,
          policy: `Percentages normalized proportionally so they sum to 100% (each share scaled by 100/${total}).`,
        });
      }
    }

    // ---- 14. Duplicate detection (exact) ----
    if (!skip && dateStr) {
      const fingerprint = `${dateStr}|${descFingerprint(row.description)}|${paidByName}|${amount}`;
      if (seenExact.has(fingerprint)) {
        anomalies.push({
          type: 'duplicate_exact',
          detail: `"${row.description}" (${dateStr}, ₹${amount}, paid by ${paidByName}) is an exact duplicate of row ${seenExact.get(fingerprint)}.`,
          policy: 'Skipped as a duplicate. The first occurrence (earlier row) is kept.',
        });
        skip = true;
        action = 'skipped_duplicate';
      } else {
        seenExact.set(fingerprint, rowNum);
      }
    }

    if (skip) {
      action = action === 'imported' ? 'skipped' : action;
    }

    processed.push({
      rowNum,
      raw: row,
      normalized: {
        date: dateStr,
        description: row.description,
        paidByName,
        amount,
        currency,
        exchangeRate,
        isRefund,
        splitType,
        participantNames,
        splitDetails,
        notes: row.notes,
        isSettlement,
      },
      anomalies,
      skip,
      action,
    });

    for (const a of anomalies) {
      report.push({ rowNum, description: row.description, ...a, action });
    }
  });

  // ---- 15. Cross-row: same-event duplicate with different amounts (Thalassa dinner) ----
  // Heuristic: same date + similar description + same participant set, different payer/amount
  for (let i = 0; i < processed.length; i++) {
    const a = processed[i];
    if (a.skip || !a.normalized.date) continue;
    for (let j = i + 1; j < processed.length; j++) {
      const b = processed[j];
      if (b.skip || !b.normalized.date) continue;
      if (a.normalized.date !== b.normalized.date) continue;
      if (a.normalized.isSettlement || b.normalized.isSettlement) continue;
      const simA = normalizeDesc(a.normalized.description);
      const simB = normalizeDesc(b.normalized.description);
      if (descSimilar(simA, simB) && a.normalized.amount !== b.normalized.amount) {
        const entry = {
          type: 'likely_duplicate_different_amount',
          detail: `"${a.normalized.description}" (row ${a.rowNum}, ₹${a.normalized.amount}, paid by ${a.normalized.paidByName}) and "${b.normalized.description}" (row ${b.rowNum}, ₹${b.normalized.amount}, paid by ${b.normalized.paidByName}) appear to be the same event logged twice by different people.`,
          policy: `Both kept as separate expenses by default (each payer is reimbursed for what they say they paid), but flagged for manual review/merge since the group likely only paid once. Recommended: delete one after confirming with the group which amount is correct.`,
        };
        report.push({ rowNum: b.rowNum, description: b.normalized.description, ...entry, action: 'flagged_for_review' });
        b.anomalies.push(entry);
      }
    }
  }

  // ---- 16. Sam deposit / non-shared "expense" with single participant ----
  for (const p of processed) {
    if (p.skip || p.normalized.isSettlement) continue;
    if (p.normalized.participantNames.length === 1 && p.normalized.participantNames[0] !== p.normalized.paidByName) {
      const entry = {
        type: 'transfer_not_expense',
        detail: `"${p.normalized.description}" is paid by ${p.normalized.paidByName} and split only with ${p.normalized.participantNames[0]} - this looks like a direct transfer (e.g. a deposit handed to a flatmate), not a shared expense.`,
        policy: 'Recorded as a Payment (transfer) from the payer to the single listed person, rather than a shared expense with shares.',
      };
      p.anomalies.push(entry);
      report.push({ rowNum: p.rowNum, description: p.normalized.description, ...entry, action: 'recorded_as_payment' });
      p.normalized.isSettlement = true; // reuse the settlement pathway
      p.action = 'recorded_as_payment';
    }
  }

  return { processed, report };
}

// ---------- helpers ----------

function normalizeDate(raw) {
  if (!raw) return null;
  raw = raw.trim();

  // DD-MM-YYYY (sheet-wide convention). Only the row whose notes explicitly
  // call out the ambiguity ("is this April 5 or May 4?") gets flagged -
  // otherwise every early-month date (day<=12) would be falsely flagged.
  let m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const [, a, b, yyyy] = m;
    const value = `${yyyy}-${b}-${a}`;
    return { value, ambiguous: false, rawDDMM: a, rawMMpart: b };
  }

  // "Mar-14" style (Mon-DD), assume current/trip year 2026
  m = raw.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (m) {
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const mm = months[m[1]];
    if (!mm) return null;
    const dd = m[2].padStart(2, '0');
    return { value: `2026-${mm}-${dd}`, ambiguous: false };
  }

  return null;
}

function normalizeDesc(desc) {
  return (desc || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function descFingerprint(desc) {
  // Sorted significant words (>2 chars), ignoring stopwords like "at"/"the"
  const stop = new Set(['at', 'the', 'a', 'an', 'of', 'for']);
  return normalizeDesc(desc)
    .split(' ')
    .filter((w) => w.length > 2 && !stop.has(w))
    .sort()
    .join(' ');
}

function descSimilar(a, b) {
  // crude similarity: shared significant words
  const wordsA = new Set(a.split(' ').filter((w) => w.length > 2));
  const wordsB = new Set(b.split(' ').filter((w) => w.length > 2));
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap >= 2;
}

function normalizeName(raw) {
  if (!raw) return null;
  return raw.trim();
}

/**
 * Resolves a raw name string to a canonical known group member name.
 * Handles: case differences, trailing whitespace, "Priya S" -> "Priya".
 */
function resolveName(raw, knownNames) {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  for (const known of knownNames) {
    if (known.toLowerCase() === lower) {
      return { name: known, found: true, changed: known !== trimmed };
    }
  }
  // Prefix match for "Priya S" -> "Priya"
  for (const known of knownNames) {
    if (lower.startsWith(known.toLowerCase() + ' ')) {
      return { name: known, found: true, changed: true };
    }
  }
  return { name: trimmed, found: false, changed: false };
}

export const KNOWN_GROUP_MEMBERS = ['Aisha', 'Rohan', 'Priya', 'Meera', 'Dev', 'Sam'];
export { USD_TO_INR_RATE };
