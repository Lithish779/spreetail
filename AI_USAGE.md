# AI_USAGE.md

## Tool used

Claude (Anthropic), via the Claude.ai interface with code-execution and file-creation tools, used
as the primary development collaborator for the full backend, frontend, and documentation.

## Approach / key prompts

1. Initial prompt: provided the assignment PDF and `expenses_export.csv`, asked Claude to build
   the full app (Node/Express + React per the target job's stack, instead of the suggested
   Django).
2. Asked Claude to inspect the CSV directly before writing any import code, and to produce a
   written catalog of every anomaly found, with row numbers, before designing the schema.
3. Asked for the database schema and split-calculation logic to be written and unit-tested (via a
   standalone script run against the real CSV) before wiring up routes, so the core business
   logic could be verified independently of the web layer.
4. Iteratively requested the CSV importer be re-run against the real file after each fix, with
   the full anomaly report printed, until every known issue was correctly detected and a count
   was confirmed (23 anomalies across 20 distinct types).
5. Asked for the frontend to be built tab by tab (Members, Expenses, Balances, Settlements,
   Import), each wired directly to the corresponding API endpoints.
6. Asked for SCOPE.md and DECISIONS.md to be written after the import logic was finalized and
   tested, so the documentation reflects what the code actually does rather than a plan.

## Three concrete cases where the AI got something wrong

### 1. Ambiguous-date detection was over-triggering

What happened: Claude's first pass at date parsing flagged every DD-MM-YYYY date where both the
day and month were 12 or less as "ambiguous" (e.g. 03-02-2026, 05-02-2026, 08-02-2026 all got
flagged), because mechanically any such date could be read either way.

How I caught it: ran the importer against the real CSV and printed the anomaly counts. The
ambiguous_date count was 6+ instead of the expected 1 (only the "is this April 5 or May 4?" row,
which is the only one the spreadsheet itself flags as a problem).

What changed: rewrote the check to only flag a date as ambiguous when the row's notes column
explicitly calls out the ambiguity. Every other DD-MM-YYYY date is parsed silently using the
sheet-wide convention, since flagging six false-positive ambiguities would have buried the one
real one and made the report useless to a human reviewer.

### 2. Exact-duplicate detection missed a real duplicate due to wording differences

What happened: the first duplicate-detection fingerprint normalized descriptions by lowercasing
and stripping punctuation only. "Dinner at Marina Bites" became "dinner at marina bites", while
"dinner - marina bites" became "dinner marina bites" — different strings, so the exact duplicate
(same date, same payer, same amount, same event) was not flagged at all.

How I caught it: manually inspected the parsed output for those two rows after noticing the
report didn't contain a duplicate_exact entry, even though the assignment PDF explicitly mentions
a duplicate dinner entry exists.

What changed: added a second fingerprint helper that strips common stopwords ("at", "the", etc.)
and sorts the remaining significant words alphabetically before comparing, so word order and
minor phrasing differences don't prevent a match on otherwise-identical rows. Re-ran the
importer; the duplicate was correctly detected and skipped.

### 3. sqlite3 native module wouldn't install in the sandbox, and the first fixes were wrong

What happened: npm install for sqlite3 (and better-sqlite3) repeatedly failed because the native
build step tried to download Node.js headers from nodejs.org, which isn't reachable from this
sandbox's network allowlist. The first few attempts (switching to better-sqlite3, trying
prebuild-install with different runtime flags) all failed for the same underlying reason — they
all needed to fetch something from a blocked host.

How I caught it: each attempt was tested directly with a node require check rather than assumed
to work, so failures were visible immediately rather than discovered later when the server
wouldn't start.

What changed: found that Node headers were already present locally at /usr/include/node (shipped
with the sandbox's Node install), and pointed node-gyp at them directly via
npm_config_nodedir=/usr inside node_modules/sqlite3. This is a sandbox-specific workaround,
documented in README.md as a fallback, since most standard hosts (Render, Railway, etc.) fetch
prebuilt sqlite3 binaries for common platforms without any of this.

## Where I directed rather than accepted

- Rejected Claude's first instinct to handle the USD conversion by leaving multi-currency
  balances (technically "more correct") — pushed back because it violates Aisha's explicit "one
  number per person" requirement, and asked for a single documented fixed-rate conversion
  instead.
- Asked for the import flow to be a two-step preview/apply (not a single-step "import and show
  results") specifically because of Meera's approval requirement — Claude's first draft of the
  import route wrote directly to the database during analysis.
- Asked Claude to flag (in DECISIONS.md) rather than silently "fix" the cross-period settlement
  simplification oddity (Meera/Sam never overlapping) once I noticed it in the balances output,
  rather than have Claude guess at a more complex algorithm under remaining time pressure.
