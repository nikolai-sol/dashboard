# Leads Binding Spec

## Goal
Build a dedicated leads intake and binding flow for dashboards without overloading `custom_table`.

The goal is:
- accept leads uploads or sheet URLs in a dedicated leads step
- bind leads only to already recognized dashboard platforms/channels
- allow unresolved rows to stay unresolved until reviewed
- keep `custom_table` strictly display-only

This is dashboard presentation/admin logic. It must not write into canonical fact tables.

## Hard Rules

- `custom_table` is never used for KPI, platform totals, plan/fact, or channel performance
- leads must not create new dashboard platforms on their own
- leads may attach only to already selected and recognized dashboard entities
- unresolved leads rows must not silently affect dashboard metrics

## Scope Boundary

In scope:
- dedicated `leads` intake in admin
- parse/validate uploaded leads files
- bind leads to selected dashboard platforms
- optionally bind leads to media-plan channels when channel names match or are confirmed
- expose leads-derived conversions in dashboard runtime only after explicit confirmation

Out of scope for first wave:
- writing leads into canonical database
- CRM synchronization
- attribution modeling
- automatic cross-dashboard reuse of leads mappings

## Why Separate It From `custom_table`

`custom_table` exists for free-form tables:
- display as-is
- no filtering
- no binding
- no metric injection

Leads are different:
- they affect conversions
- they need mapping semantics
- they can easily distort KPI and platform sections if injected too early

Because of that, leads need their own operational flow.

## Input Contract

Accepted first-pass leads row shape:
- `date`
- `platform`
- `channel`
- `source`
- `leads`
- `qualified_leads`
- `revenue`
- `notes`

Example:
- `2026-03-01 | linkedin | LinkedIn Lead Gen | tilda_form | 4 | 2 | 15000 | comment`

## Normalization Rules

### Platform
- normalize uploaded platform to dashboard platform ids
- examples:
  - `linkedin -> linkedin`
  - `reddit -> reddit`
  - `vk / вк / vkontakte -> vk`
  - `yandex / yandex_direct / яндекс -> yandex`
  - `google_ads / google -> google`

### Channel
- trim whitespace
- preserve original label
- also build a normalized comparison key for matching/binding

### Metrics
- `leads` is required for conversion injection
- `qualified_leads` and `revenue` are optional in MVP
- rows with invalid `leads` are validation errors

## Binding Model

Each normalized leads row gets one of three statuses:

- `canonical_bound`
  - row is bound to an existing selected dashboard platform
  - optional channel binding is also confirmed
- `platform_only`
  - row is bound to a selected dashboard platform
  - channel binding is missing or unresolved
- `unresolved`
  - no safe platform binding yet

### Binding Constraints

Platform binding is allowed only if:
- platform normalizes to one of the selected dashboard platforms
- or admin explicitly maps it to one of the selected dashboard platforms

Channel binding is allowed only if:
- channel matches an existing media-plan/manual/canonical dashboard channel
- or admin explicitly resolves it

If neither condition is met:
- row stays `unresolved`
- row does not affect dashboard metrics

## Runtime Semantics

Only confirmed leads rows can affect runtime metrics.

### Platform layer
If a leads row is `canonical_bound` or `platform_only`:
- add `leads` to conversions of the already existing bound platform

Never:
- create a brand new platform only from leads upload

### Channel / Plan-vs-Fact layer
Only `canonical_bound` rows with confirmed channel binding may affect:
- `plan_vs_fact[].conversions_fact`
- channel performance conversions / CPA

`platform_only` rows:
- may contribute to platform conversions
- must not affect channel plan/fact until channel is confirmed

`unresolved` rows:
- affect nothing

## Admin Flow

### Step 1. Upload / Connect
Accept:
- CSV URL
- uploaded CSV
- uploaded XLSX

### Step 2. Validate
Show:
- rows parsed
- invalid rows
- distinct normalized platforms
- distinct channels
- issues list

### Step 3. Platform Binding
For each normalized platform:
- auto-match against selected dashboard platforms
- if ambiguous or missing, ask admin to resolve

### Step 4. Channel Binding
For each row or grouped channel:
- show candidate dashboard channels
- allow:
  - bind
  - platform-only
  - unresolved

### Step 5. Confirm
Persist reviewed binding config into dashboard source config.

No DB fact writes.

## Persistence

Reviewed leads config can live in dashboard source config as:
- `type = leads_binding`
- `inline_rows`
- `review`
- `binding_summary`
- `row_bindings`
- `platform_alias_memory`
- `channel_alias_memory`

This mirrors the media-plan review pattern and avoids schema changes in MVP.

## MVP

Deliverables:
- dedicated leads source in admin, separate from `custom_table`
- upload/url intake for CSV/XLSX
- validation report
- platform binding step
- optional channel binding step
- reviewed config persistence
- runtime injection only for confirmed rows

Success criteria:
- leads no longer enter dashboard through `custom_table`
- unresolved rows never distort KPI
- only selected dashboard platforms receive leads conversions

## V2

- better token scoring for channel matching
- alias memory editing screen
- grouped row review by platform/channel/source
- qualified leads and revenue cards

## V3

- optional CRM connector
- attribution windows
- shared binding presets across dashboards
- persistent normalized leads cache table
