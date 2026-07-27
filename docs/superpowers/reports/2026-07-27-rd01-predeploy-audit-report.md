# RD-01 pre-deploy audit report

**Branch:** `codex/zaruku-product-readiness`

**Status:** Code corrections and verification complete; deployment not performed.

**Scope respected:** No API, collector, cron, database migration, deployment, Abbott/RD-05, layout editor/RD-04, or RD-03 implementation change.

## 1. Section collapse

The Content detail group now has a section-level state boundary. When all Popular, Best engagement, Bounce risk, Returning, and All pages panels are empty, hidden, unavailable, or have no rows, the group renders exactly one quiet message: “Нет данных за выбранный период.” A mixed section keeps its normal panels.

Automated coverage: `ZarukuSectionState.test.ts` and the Content integration assertion.

## 2. Copy audit

Verdict meanings:

- **client** — normal client-facing wording; implementation vocabulary is forbidden;
- **technical** — content shown only inside an explicitly named technical-details disclosure.

| Surface | Current text or format | Verdict |
|---|---|---|
| Panel and section empty state | Нет данных за выбранный период. | client |
| Disabled global calendar | На этой вкладке период выбирается по неделям. | client |
| Completeness footer | Данные полные по DD.MM.YYYY. | client |
| Content-map info button | Информация по карте разделов | client |
| Content-map tooltip title | Карта разделов сайта | client |
| Content-map tooltip details | Шаблонов разделов: N; Просмотров вне карты: N · доля: N%; Обновлено: DD.MM.YYYY | client |
| Main-indicator info | Показатели помогают отслеживать направление изменений, но сами по себе не доказывают причину. | client |
| Noise tooltip title | Что такое шум | client |
| Noise tooltip explanation | Доля показов по чужим брендам лабораторий и организаций, где портал виден не за счёт собственных медицинских тем. | client |
| Noise tooltip importance | Почему важно: если шум высокий, основная видимость уходит в нерелевантную конкуренцию, а показы хуже превращаются в целевой спрос. | client |
| Medical-intent tooltip title | Что такое медицинский интент | client |
| Medical-intent tooltip explanation | Доля показов по запросам, где пользователь ищет медицинскую информацию, маршрутизацию или помощь по онкологическим темам. | client |
| Medical-intent tooltip importance | Почему важно: рост этой доли показывает, что SEO приводит целевой органический трафик, а не просто увеличивает общий объём показов. | client |
| Alice AI tooltip title | Что такое Алиса AI | client |
| Alice AI tooltip explanation | Доля проверенных AI-сценариев, где портал «За руку» присутствует в ответе Алисы или связанном источнике. | client |
| Alice AI tooltip importance | Почему важно: присутствие в ИИ-ответах становится отдельным каналом видимости до клика и влияет на то, какие источники пользователь увидит первыми. | client |
| Acceptance tooltip title | Что такое доля принятия | client |
| Acceptance tooltip explanation | Доля SEO-возможностей, которые прошли отбор и были приняты в работу среди принятых и отклонённых решений недели. | client |
| Acceptance tooltip importance | Почему важно: это скорость превращения выводов SEO OS в реальные задачи без перегруза команды нерелевантными рекомендациями. | client |
| Детали тултипа основных показателей | Период, контрольное значение и служебное имя источника, сформированные из текущих данных | technical |
| Technical-tail info button | Что входит в технический хвост | client |
| Technical-tail title | Технический хвост | client |
| Technical-tail explanation | Служебные и нераспознанные источники не считаются отдельным каналом привлечения. | client |
| Technical-tail importance | Они показаны отдельно, чтобы можно было проверить полноту данных. | client |
| Technical-tail details | Source label: visit count | client |
| AI empty state | Данные об AI-видимости пока не готовы. | client |
| Semantic-groups empty state | Данные по тематическим группам пока не готовы. | client |
| Search diagnostics empty state | Нет данных для выбранной недели. | client |
| Map-city empty state | Нет данных по городам для /map за выбранный период. | client |
| Page comparison empty state | Нет страниц для выбранных периодов. | client |
| Query comparison empty state | По выбранному фильтру запросов нет. | client |
| Work unavailable state | Данные по работам и задачам временно недоступны. Повторите попытку позже. | client |
| Visibility unavailable state | SEO-видимость временно недоступна. Повторите попытку позже. | client |
| Google detailed-data note | За выбранную неделю … подробных данных Google Search Console пока нет; показываем последнюю доступную неделю …. | client |
| Google source note | Источник: Google Search Console · данные поисковых запросов. | client |
| Webmaster detailed-data note | За выбранную неделю … детальных данных Яндекс Вебмастера пока нет; показываем последнюю доступную неделю …. | client |
| Webmaster source note | Источник: Яндекс Вебмастер · данные поисковых запросов и страниц. | client |
| Quality verdict explanation | Вердикт учитывает доступность основных данных о трафике, полноту показателей и своевременность обновления. | client |
| Quality limitations explanation | Что можно интерпретировать сейчас и где выводы ограничены источником или уровнем детализации. | client |
| Quality freshness explanation | Здесь видно, когда данные обновлялись и были ли задержки. Служебные сведения доступны в деталях. | client |
| Quality disclosure label | Технические детали | client |
| Содержимое раскрываемых деталей качества | Служебное имя процесса, ожидаемый ритм, число прочитанных и записанных строк, примечание источника и последняя ошибка | technical |

Client-copy enforcement lives in `zaruku-client-copy.ts`; `zaruku-client-copy.test.ts` rejects the six prohibited implementation terms in every item marked `client`. Partial-state metadata text is not rendered directly.

## 3. Typography decision

The specification is implemented, not treated as an exception:

- headings: serif Georgia/Cambria stack;
- primary numeric KPI: serif + `tabular-nums` through `.zaruku-kpi-value`;
- table column labels: Inter/sans 13 px / 1.4, uppercase, `--muted`;
- all rules scoped under `.zaruku-dashboard`.

## 4. Explicit A/B types

`zaruku-seo-week-selection.ts` now exports explicit `WeekSelectionSlot`, `WeekSelectionField`, `WeekComparisonMode`, `WeekSelectionSlots`, and `WEEK_SELECTION_FIELD_BY_SLOT`. Dashboard state stores `single` or `comparison`, and toolbar callbacks use the A/B field map.

## 5. Literal-color boundary and exclusions

RD-01 now guarantees no raw hex or `rgb/rgba` literals in Zaruku runtime components. `zaruku-color-contract.test.ts` enforces that boundary.

The following runtime files still contain literals and are explicitly outside RD-01:

| File | Reason retained |
|---|---|
| `AbbottBiDashboard.tsx` | Abbott-specific product palettes and charts; Abbott overflow work is RD-05. |
| `CampaignPerformanceTable.tsx` | Shared non-Zaruku reporting-card shadow. |
| `ChannelMix.tsx` | Shared platform-brand and Nivo chart palette. |
| `ComparisonSection.tsx` | Shared comparison-chart theme. |
| `ConversionFunnel.tsx` | Shared non-Zaruku reporting-card shadow. |
| `KPICard.tsx` | Shared Recharts tooltip border. |
| `MultibrandExecutivePage.tsx` | Separate multibrand dark surface. |
| `PlatformPlanVsFact.tsx` | Platform-brand fallback swatches. |
| `PlatformTable.tsx` | Shared platform tooltip styling. |
| `RagDemoDashboard.tsx` | Standalone demo and brand palette. |
| `SpendByPlatform.tsx` | Shared platform-brand/Nivo palette and tooltip shadow. |
| `SpendConversionsScatter.tsx` | Shared non-Zaruku scatter palette and card shadow. |
| `TrendChart.tsx` | Shared platform-brand and Nivo chart theme. |
| `admin/WizardStep3.tsx` | Admin chart-preview swatches. |
| `admin/WizardStepBinding.tsx` | Admin source-binding preview swatches. |
| `admin/WizardStepFrequency.tsx` | Admin schedule/source preview swatches. |

This is an intentional scope correction, not a claim that all `src/components` literals were removed.

## Dependencies kept intact

`hidden` remains a frontend-only presentation state until RD-02 supplies it through the API. RD-03 has not started because an unavailable-data reason cannot yet be shown reliably. RD-04 and RD-05 remain separate work.

## Verification evidence

- `npm test`: 226/226 tests passed.
- `npm run typecheck`: passed.
- `npx eslint . --ignore-pattern '.worktrees/**'`: 0 errors; 4 pre-existing warnings outside the RD-01 correction set.
- `npm run build`: production build passed.
- Production browser check: `document.documentElement.scrollWidth === window.innerWidth` at 430, 768, 1024, 1279, 1280, and 1440 px.
- At 430 px, Content tables remain inside 320 px client frames and scroll internally; their table canvases remain 741–920 px wide without expanding the document.
- Computed typography: headings use the Georgia/Cambria serif stack; KPI numbers use the same stack with `tabular-nums`; table headers use Inter at 13 px, line-height 1.4, uppercase, and `--muted`.
- The disabled-calendar explanation is present on weekly tabs.
- Browser console: 0 errors, 1 non-blocking warning.

The repository-wide `npm run lint` command was not used as final evidence because it recursively traverses generated `.next` files inside unrelated `.worktrees`. The equivalent source lint with that generated directory excluded passed with zero errors.
