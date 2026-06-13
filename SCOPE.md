# SCOPE.md — Anomaly Log & Database Schema

## Part 1: Anomaly Log

The importer (`backend/src/utils/csvImporter.js`) detects every issue below by re-running it
against `expenses_export.csv`. Each anomaly is surfaced in the import report shown to the user
before anything is written to the database (see `ImportTab.jsx`).

| # | Row(s) | Issue | Type | Policy chosen |
|---|--------|-------|------|---------------|
| 1 | 5, 6 | "Dinner at Marina Bites" and "dinner - marina bites" — same date, payer, amount, just different wording | `duplicate_exact` | Skip the second occurrence; keep the first. |
| 2 | 6 | `amount` = `"1,200"` (thousands separator) | `amount_formatting` | Strip commas before parsing. |
| 3 | various | `paid_by` casing/whitespace differs ("priya" vs "Priya", "rohan " with trailing space) | `name_normalization` | Case-insensitive, trim-based match against known member names; normalized to canonical name. |
| 4 | Groceries DMart (15-03) | `paid_by` = "Priya S" | `name_normalization` | Prefix match: "Priya S" → "Priya". |
| 5 | Cylinder refill | `amount` = `899.995` (3 decimals) | `precision_rounding` | Round to 2dp (₹899.99 / ₹900.00 depending on rounding rule — banker's/standard rounding applied). |
| 6 | "Rohan paid Aisha back" | Empty `split_type`, description indicates a repayment | `settlement_as_expense` | Recorded as a **Payment** (settlement) from Rohan→Aisha, not as a shared Expense. Does not appear in anyone's "share" lines. |
| 7 | Pizza Friday | `split_details` percentages sum to 110% (30+30+30+20) | `percentage_sum_mismatch` | Percentages normalized proportionally so they sum to 100% (each ÷1.1). |
| 8 | House cleaning supplies | `paid_by` is blank | `missing_payer` | Row skipped — an expense cannot be attributed to nobody. Flagged for manual entry by the group. |
| 9 | Goa villa, Beach shack, Parasailing, Parasailing refund | `currency` = USD | `foreign_currency` | Converted to INR at a fixed rate of **1 USD = ₹84** (documented assumption for the trip period — see DECISIONS.md). Original amount/currency preserved on the record. |
| 10 | Parasailing refund (-30 USD) | Negative amount | `negative_amount` | Treated as a **refund**: the amount is recorded as negative and the same split is applied, so each participant's share is *reduced* rather than a new positive charge being added. |
| 11 | "Mar-14" (Airport cab) | Date in `Mon-DD` format instead of `DD-MM-YYYY` | — (handled silently as a recognized alternate format) | Parsed using a `Mon-DD` pattern, year assumed to be the trip year (2026), matching surrounding rows. |
| 12 | Groceries DMart (15-03) | `currency` is blank | `missing_currency` | Defaulted to INR (group base currency), consistent with neighboring rows from the same date. |
| 13 | "Dinner at Thalassa" (Aisha, ₹2400) vs "Thalassa dinner" (Rohan, ₹2450), same date | Likely the same event logged twice by different people with different amounts | `likely_duplicate_different_amount` | **Both kept** (each payer is reimbursed what they say they paid) but flagged for manual review/merge — the importer does not guess which figure is "correct". |
| 14 | "Dinner order Swiggy", amount 0, note "counted twice earlier" | Zero amount | `zero_amount` | Row skipped — a ₹0 expense affects no balances and the note indicates it's a leftover correction marker, not a real expense. |
| 15 | "Deep cleaning service", date "04-05-2026", note explicitly asks "is this April 5 or May 4?" | Ambiguous date | `ambiguous_date` | Resolved as **04 May 2026** using the sheet-wide DD-MM-YYYY convention (consistent with every other row), but flagged in the report for the group to confirm. |
| 16 | Groceries (02-04-2026) includes "Meera" in `split_with` | Meera left the group 31 March, expense is dated after | `stale_member_in_split` | Meera **excluded** from this split; her share is redistributed among the remaining active members (Aisha, Rohan, Priya, Sam, etc. as listed). |
| 17 | "Furniture for common room" | `split_type` = "equal" but `split_details` also provided (share-style values) | `split_type_mismatch` | `split_type` takes precedence — `equal` wins, `split_details` is ignored and the amount is divided evenly. |
| 18 | Parasailing `split_with` includes "Dev's friend Kabir" | Person not a recognized group member | `unknown_participant` | Excluded from the split; the expense is divided among the remaining recognized members. Kabir could be added to the group separately if he should be a permanent/billable member. |
| 19 | Airport cab `paid_by` = "rohan " (trailing space) | Whitespace | `name_normalization` | Trimmed and matched to "Rohan". |
| 20 | "Sam deposit", `paid_by` = Sam, `split_with` = Aisha only | Looks like a direct transfer (deposit handed to a flatmate), not a shared expense | `transfer_not_expense` | Recorded as a **Payment** (Sam → Aisha), not as an Expense with shares. |

**Total: 20 distinct anomaly types/instances across 23 flagged report entries** (some rows trigger
more than one anomaly, e.g. a row can have both a name-normalization issue and a currency issue).

### Import summary (current CSV)

- 42 data rows
- 37 imported as Expenses
- 2 recorded as Payments/settlements (Rohan→Aisha repayment, Sam→Aisha deposit)
- 3 skipped (1 exact duplicate, 1 zero-amount, 1 missing-payer)
- 1 flagged for manual review (Thalassa dinner double-entry)

## Part 2: Database Schema

All tables are plain relational tables (SQLite via Sequelize; portable to Postgres/MySQL with no
SQLite-specific features used).

### `Users`
| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| name | STRING | |
| email | STRING UNIQUE | login identity |
| passwordHash | STRING | bcrypt |

### `Groups`
| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| name | STRING | |
| baseCurrency | STRING | default `INR` — all balances are computed in this currency |

### `GroupMemberships` (join table, time-bounded)
| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| GroupId | FK → Groups | |
| UserId | FK → Users | |
| joinedAt | DATEONLY | |
| leftAt | DATEONLY, nullable | `null` = still a member |

This is the core mechanism for "membership can change over time" (requirement 2). A member who
leaves and later rejoins gets a **second row** rather than mutating the first, so historical
"was X a member on date D?" queries stay correct (used by the import logic for the
stale-member check, anomaly #16).

### `Expenses`
| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| GroupId | FK → Groups | |
| description | STRING | |
| date | DATEONLY | |
| originalAmount | FLOAT | as entered, in `originalCurrency` (negative = refund) |
| originalCurrency | STRING | `INR` / `USD` |
| exchangeRate | FLOAT | multiplier to base currency, applied at import/entry time |
| amountBase | FLOAT | `originalAmount × exchangeRate`, rounded to 2dp — what balances are computed from |
| splitType | ENUM | `equal` / `unequal` / `percentage` / `share` |
| isRefund | BOOLEAN | true if `originalAmount < 0` |
| paidByUserId | FK → Users | |
| notes | STRING, nullable | |
| source | ENUM | `manual` / `import` |
| importBatchId | FK → ImportBatches, nullable | traceability back to the import that created this row |

### `ExpenseShares`
One row per (expense, participant) — this is what makes Rohan's "no magic numbers" requirement
possible: every balance is a SUM over these rows, each traceable to a specific expense.

| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| ExpenseId | FK → Expenses | |
| UserId | FK → Users | |
| shareAmount | FLOAT | this person's portion, in base currency, 2dp |
| rawShareValue | FLOAT, nullable | the raw % or share-unit value, kept for display |

### `Payments` (settlements / transfers)
| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| GroupId | FK → Groups | |
| fromUserId | FK → Users | who paid |
| toUserId | FK → Users | who received |
| amount | FLOAT | in base currency |
| originalAmount, originalCurrency | nullable | preserved if imported from a foreign-currency row |
| date | DATEONLY | |
| notes | STRING, nullable | |
| source | ENUM | `manual` / `import` |
| importBatchId | FK, nullable | |

Settlements (anomaly #6) and transfers (anomaly #20) both land here, **not** in `Expenses` — they
don't get split among the group.

### `ImportBatches`
| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| GroupId | FK → Groups | |
| filename | STRING | |
| status | ENUM | `pending_review` / `applied` / `rejected` |
| reportJson | TEXT | full anomaly report + processed rows, stored so it can be re-displayed |

This table implements Meera's "I want to approve anything the app deletes or changes" requirement:
uploading a CSV creates a `pending_review` batch with **nothing else written**; only `apply`
(approve) creates real `Expenses`/`Payments` rows, and `reject` discards the batch entirely.
