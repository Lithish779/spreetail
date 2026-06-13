# DECISIONS.md — Decision Log

## 1. Database: SQLite via Sequelize, schema designed to be portable

**Options considered**: SQLite, Postgres, MongoDB (rejected immediately — requirement #5 says
relational only).

**Decision**: SQLite, accessed through Sequelize so the dialect is swappable. SQLite needs no
separate database server, which makes local dev and small deployments trivial, while Sequelize
means moving to Postgres later is a one-line config change (no SQLite-specific column types or
queries are used).

**Trade-off**: SQLite doesn't handle high concurrent write load well. For a 4-6 person flat-share
app this is a non-issue; flagged here in case the live session asks about scaling.

## 2. Membership as a time-bounded join table, not a simple many-to-many

**Options considered**:
- (a) A simple `GroupMembers` many-to-many table (user is either in the group or not).
- (b) `GroupMemberships` with `joinedAt`/`leftAt` columns.

**Decision**: (b). Requirement #2 explicitly says membership changes over time, and Sam's
complaint ("why would March electricity affect my balance?") is exactly the bug that option (a)
would cause — if Sam is just "a member" with no join date, every historical expense's equal-split
would silently include him.

**Consequence**: every balance/import calculation that cares about "who was in the group when"
filters by `joinedAt <= date AND (leftAt IS NULL OR leftAt > date)`. The CSV importer uses this
to detect anomaly #16 (Meera listed in a post-departure expense).

## 3. Expense splits are computed and stored at creation time, not on-the-fly

**Options considered**:
- (a) Store only `splitType` + raw parameters (percentages/shares), recompute each person's
  share whenever balances are requested.
- (b) Compute each person's `shareAmount` once, at creation/import time, and store it in
  `ExpenseShares`.

**Decision**: (b). This directly satisfies Rohan's "no magic numbers" request — the balances
endpoint is a pure SUM over stored, inspectable rows, and the live session can point at any
`ExpenseShares` row and ask "why is this 392.73" with a stable, stored answer.

**Trade-off**: if the splitting algorithm changes later (e.g. a different rounding rule),
existing `ExpenseShares` rows become stale and would need a recompute pass. Documented here so
this isn't a surprise in the live session.

## 4. Currency conversion: fixed rate, stored alongside original amount

**Problem** (Priya's complaint): the sheet has USD amounts but treats 1 USD as 1 INR.

**Options considered**:
- (a) Look up historical exchange rates via an API for each expense's date.
- (b) Use one fixed rate for the whole import, documented as an assumption.
- (c) Leave USD amounts as-is and compute balances per-currency (multi-currency balances).

**Decision**: (b), 1 USD = 84 INR. A historical-rate API adds an external dependency and failure
mode for a 2-day assignment, and the difference between e.g. 83.50 and 84.20 across a handful of
March 2026 transactions doesn't change who owes whom in any meaningful way. (c) was rejected
because the group fundamentally wants "one number per person" (Aisha's request) —
multi-currency balances would violate that directly.

**What's preserved**: `originalAmount` and `originalCurrency` are stored unchanged on every
expense, so the group can always see "this was $30, not ₹30" even though balances are computed in
INR. The rate is a named constant (`USD_TO_INR_RATE` in `csvImporter.js`) so it's a one-line
change if the group wants a different rate.

## 5. Negative amounts = refunds, applied to the same split

**Problem**: "Parasailing refund" is -30 USD with the same `split_with` list as the original
Parasailing expense.

**Options considered**:
- (a) Treat negative amounts as an error / skip them.
- (b) Treat as a refund: create an expense with negative `amountBase`, split using the same
  split type/participants, so each person's share is reduced.
- (c) Treat as a payment from "the refund source" to the group.

**Decision**: (b). The refund is clearly tied to the Parasailing expense (same participants, same
day, explicit "refund" in the description) — reducing everyone's share proportionally is the most
faithful representation of "we got some money back for that thing we all paid for."

**Caveat**: this is a heuristic, not a guaranteed pairing — the importer does not algorithmically
link the refund row to its original expense row; it just re-applies the same split logic to a
negative amount independently. Flagged as a possible future improvement (explicit refund-to-
expense linking).

## 6. Settlements and transfers are NOT expenses

**Problem**: "Rohan paid Aisha back" (anomaly #6) and "Sam deposit" (anomaly #20) are both rows in
the expense sheet but represent money moving between people, not a shared cost.

**Decision**: both go into a separate `Payments` table, detected by:
- empty `split_type` plus description/notes language indicating repayment ("paid ... back",
  "settlement"), or
- `split_with` containing exactly one person who isn't the payer (a 1:1 transfer has no group
  "split" to speak of).

This keeps `Expenses`/`ExpenseShares` — and therefore every balance calculation — free of rows
that would double-count: if "Rohan paid Aisha back 5000" were split equally among 4 people, it
would incorrectly look like the group spent 5000, when really money just moved from one person's
pocket to another's.

## 7. Percentage splits that don't sum to 100%: normalize, don't error

**Problem**: Pizza Friday's percentages sum to 110%.

**Options considered**:
- (a) Reject the row as invalid.
- (b) Normalize proportionally (each percentage divided by the total, times 100).
- (c) Treat the excess as an unsplit remainder (nobody pays it — money disappears).

**Decision**: (b). Rejecting (a) fails the "a crashed import is a failing answer" requirement for
something that's clearly an arithmetic typo, not a fundamentally broken row. (c) would mean the
sum of everyone's shares doesn't equal the expense total, which breaks the "one number per
person" promise. Normalizing preserves each person's relative share while making the totals add
up exactly.

## 8. Rounding: last participant absorbs the remainder

**Problem**: splitting 1199 three ways gives 399.666... per person — shares must be 2dp, but
3 times 399.67 is 1200.01, not 1199.

**Decision**: round every share to 2dp, then adjust the last participant's share by whatever
drift remains so the shares sum exactly to the expense total. This is arbitrary (any participant
could absorb it) but deterministic and documented — and the live session's "change the rounding
rule" prompt can point directly at the single `drift` calculation in `splitCalculator.js`.

## 9. Settlement simplification can route debts between people who never overlapped

**Observed**: the "who owes whom" simplification (greedy debtor/creditor matching) can produce a
suggested payment between two people whose group memberships never overlapped in time (e.g. Meera
left before Sam joined, but the simplified settlement list may still show Meera owing Sam).

**Why this happens**: the simplification only looks at each person's final net balance, not when
the underlying debts arose. Mathematically the suggested payments are still correct (the group as
a whole ends up settled), but it can look strange to an individual ("I never even met this
person").

**Decision (for this submission)**: left as-is, documented here rather than fixed, because (a)
the per-person balance breakdown (with full line-item traceability) is always available and is
the source of truth — the simplified "who pays whom" list is explicitly a convenience layer on
top of it, and (b) a "fairer" simplification (e.g. preferring payments between people who
actually transacted together) is a meaningfully bigger algorithm and a judgment call about what
"fair" means that's better made by the group themselves. Flagged as a known limitation for the
live session.

## 10. CSV import is a two-step preview/approve flow, not a direct write

**Problem** (Meera's request): "I want to approve anything the app deletes or changes."

**Decision**: `POST /import/.../preview` parses and analyzes the CSV, stores the full report on an
`ImportBatch` row with status `pending_review`, and writes nothing else. A separate
`POST /import/batch/:id/apply` (or `/reject`) is required to actually create `Expenses`/`Payments`
rows. The frontend shows the full anomaly report between these two steps and won't call apply
without an explicit click.
