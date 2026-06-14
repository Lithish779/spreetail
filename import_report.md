# Flat 4B — CSV Ingestion Import Report

This report was generated automatically by the Flat 4B Shared Expenses CSV Importer after analyzing the raw `Expenses Export.csv` spreadsheet.

## Summary of Ingestion
- **Total Rows Scanned**: 42 data rows (excluding header)
- **Imported as Expenses**: 37 rows
- **Recorded as Payments / Settlements**: 2 rows
  - Row 14: "Rohan paid Aisha back" (₹5000.00 repayment)
  - Row 38: "Sam deposit share" (₹15000.00 transfer to Aisha)
- **Skipped Rows**: 3 rows
  - Row 6: "dinner - marina bites" (exact duplicate of Row 5)
  - Row 13: "House cleaning supplies" (missing payer `paid_by` field)
  - Row 31: "Dinner order Swiggy" (zero-amount correction row)
- **Flagged for Manual Review**: 1 row
  - Row 25: "Thalassa dinner" (likely duplicate of Row 24 with different amount)

---

## Detailed Anomalies Log

| Row | Expense / Description | Anomaly Type | Details | Action Taken & Policy Applied |
|:---|:---|:---|:---|:---|
| **5** | Dinner at Marina Bites | `stale_member_in_split` | Dev in `split_with` but joined on 08-03-2026 (expense is 08-02-2026). | Dev excluded from split; share redistributed among active members. |
| **6** | dinner - marina bites | `stale_member_in_split` | Dev in `split_with` but joined on 08-03-2026 (expense is 08-02-2026). | Dev excluded from split; share redistributed among active members. |
| **6** | dinner - marina bites | `duplicate_exact` | Exact duplicate of Row 5 (same date, description, payer, amount). | **Row skipped**. |
| **7** | Electricity Feb | `amount_formatting` | Amount `"1,200"` contained a thousands separator. | Separator stripped, parsed as numeric `1200`. |
| **9** | Movie night snacks | `name_normalization` | Payer `"priya"` was entered in lowercase. | Normalized to canonical name `"Priya"`. |
| **10** | Cylinder refill | `precision_rounding` | Amount `899.995` has 3 decimal places. | Rounded to 2 decimal places: `900.00`. |
| **11** | Groceries DMart | `name_normalization` | Payer `"Priya S"` is an alias for Priya. | Normalized to canonical name `"Priya"`. |
| **13** | House cleaning supplies | `missing_payer` | Payer field (`paid_by`) is completely blank. | **Row skipped**; cannot record expense without a payer. |
| **14** | Rohan paid Aisha back | `settlement_as_expense` | Empty `split_type` and description indicates a repayment. | **Recorded as Payment** (Rohan → Aisha) rather than an Expense. |
| **15** | Pizza Friday | `percentage_sum_mismatch` | Percentages sum to 110% (30% + 30% + 30% + 20%). | Normalized proportionally to sum to 100%. |
| **20** | Goa villa booking | `foreign_currency` | Currency is in `USD` (540 USD). | Converted to base currency at fixed rate 1 USD = ₹84. |
| **21** | Beach shack lunch | `foreign_currency` | Currency is in `USD` (84 USD). | Converted to base currency at fixed rate 1 USD = ₹84. |
| **23** | Parasailing | `foreign_currency` | Currency is in `USD` (150 USD). | Converted to base currency at fixed rate 1 USD = ₹84. |
| **23** | Parasailing | `unknown_participant` | Lists `"Dev's friend Kabir"` who is not a group member. | Kabir excluded; share split among active members. |
| **24 / 25** | Dinner at Thalassa / Thalassa dinner | `likely_duplicate_different_amount` | Same date, similar description, different payers/amounts. | **Both kept**, but flagged for manual review/merge by group. |
| **26** | Parasailing refund | `negative_amount` | Amount is negative (-30 USD). | Treated as a **Refund**: splits reversed to reduce balances. |
| **26** | Parasailing refund | `foreign_currency` | Currency is in `USD` (-30 USD). | Converted to base currency at fixed rate 1 USD = ₹84. |
| **27** | Airport cab | `name_normalization` | Payer `"rohan "` contains trailing whitespace. | Normalized to canonical name `"Rohan"`. |
| **27** | Airport cab | `stale_member_in_split` | Dev in `split_with` on 14-03-2026 but left on 12-03-2026. | Dev excluded from split; share redistributed among active members. |
| **28** | Groceries DMart | `missing_currency` | Currency column is blank. | Defaulted to INR (group base currency). |
| **31** | Dinner order Swiggy | `zero_amount` | Amount is `0`. Note: "counted twice earlier". | **Row skipped**; zero amounts do not affect balances. |
| **32** | Weekend brunch | `percentage_sum_mismatch` | Percentages sum to 110% (30% + 30% + 30% + 20%). | Normalized proportionally to sum to 100%. |
| **34** | Deep cleaning service | `ambiguous_date` | Date `"04-05-2026"` note asks "is this April 5 or May 4?". | Resolved as 2026-05-04 using sheet-wide DD-MM-YYYY; flagged. |
| **36** | Groceries BigBasket | `stale_member_in_split` | Meera in `split_with` on 02-04-2026 but left on 31-03-2026. | Meera excluded from split; share redistributed among active members. |
| **38** | Sam deposit share | `transfer_not_expense` | Split only with Aisha (1:1 transfer). | **Recorded as Payment** (Sam → Aisha) rather than an Expense. |
| **42** | Furniture for common room | `split_type_mismatch` | Split type is "equal" but details are provided. | Split type `equal` takes precedence; split details ignored. |
