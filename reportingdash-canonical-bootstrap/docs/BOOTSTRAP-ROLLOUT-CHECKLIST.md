# Bootstrap Rollout Checklist

## Phase 1. Local bootstrap

- create separate repo from this skeleton
- copy collector root files into matching folders
- reconcile imports
- reconcile requirements
- add real README
- add deploy helper scripts

## Phase 2. Local verification

- `python -m py_compile` passes for moved collectors
- one ads collector runs locally
- one analytics collector runs locally
- one ops script runs locally

## Phase 3. Server shadow path

- deploy to shadow path, not replacing current runtime
- create venv
- install requirements
- render env
- confirm manual runs work

## Phase 4. Existing Yandex Direct shadow continuity

- preserve `yandex_direct_api_shadow`
- preserve existing shadow cron semantics
- preserve cutover dashboard monitoring
- verify no duplicate writes beyond intended shadow path

## Phase 5. Source-by-source migration

Recommended order:

1. linkedin
2. reddit
3. vk_ads_v2
4. getintent
5. hybrid
6. yandex_promopages
7. yandex_direct
8. yandex_metrika

## Phase 6. Acceptance

- all source crons run from versioned repo path
- old unversioned runtime path remains rollback-ready
- collector facts stay fresh
- no duplicate source rows
- dashboards remain healthy
