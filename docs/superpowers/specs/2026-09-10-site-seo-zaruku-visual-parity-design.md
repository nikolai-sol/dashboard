# Визуальная паритетность типового SEO-дашборда с Zaruku

Дата: 2026-09-10. Статус: утверждено запросом владельца — привести типовой SEO-дашборд, включая MedRoche, к дизайну опубликованного выделенного Zaruku.

## Решение

apps/site-seo получает собственный нейтральный визуальный слой с тем же наблюдаемым языком интерфейса, что опубликованный Zaruku: широкий центрированный canvas, светлый slate-контейнер, desktop rail, mobile tab strip, белые панели, компактные KPI, аккуратные таблицы и семантические статусы. Это не импорт Zaruku-компонентов или CSS: приложение остаётся самостоятельным артефактом и не содержит строк, типов, селекторов, маршрутов или данных Zaruku.

Минимальная интерактивность реализуется server-rendered параметром tab. Навигация меняет только представление; canonical read model, авторизация, периодные параметры, фильтры и экспортный контракт остаются server-side и не передаются в клиентский UI. Это намеренно проще и надёжнее нового client dashboard shell.

## Визуальный контракт

- Canvas: max-width 1600px, адаптивные gutters, нейтральный gradient фон.
- Shell: slate-50, 1px slate-200, radius 12px; desktop rail 240px от md, ниже — горизонтально прокручиваемая tab-навигация.
- Панели: белые, 16–20px padding, тонкая граница и очень лёгкая тень; header/body разделены; wide tables scroll внутри панели, а не весь документ.
- Типографика: Inter/system sans, tabular figures; compact headings. Teal — только accent/active; emerald/amber/red — только смысл статуса.
- Профиль задаёт идентичность (название, домен и существующий logoAsset, если он задан); ни MedRoche, ни Zaruku не захардкожены в generic UI.
- Вкладки по-прежнему происходят только из dashboardTabs(profile): отключённый source отсутствует, включённый с missing, failed, partial или complete_empty виден с честным состоянием.

## Границы

Не меняются apps/site-seo/src/lib, API/export routes, SQL/read model, авторизация, profile registry, source bindings, runtime/deploy identity, data/coverage и Zaruku. Не добавляются Tailwind, Lucide, fetch к API, source OAuth или новые пакеты. PDF/Excel/JSON продолжают использовать их текущий scoped query; tab — только UI-параметр.

## Проверяемая приемка

- Синтетические MedRoche и второй сайт с другим набором source показывают профильную идентичность и разный набор вкладок, но один визуальный shell.
- Query сохраняет week/comparison/GSC/Alice/publication/filter значения при выборе вкладки; disabled GSC не рендерится.
- Широкая таблица остаётся внутри TableFrame; desktop rail и mobile strip подтверждены в CSS-contract test.
- Пять source states не преобразуются в нули или «актуально».
- npm run test:site-seo, npm run typecheck:site-seo, generic artifact-policy и isolated build проходят; Zaruku исходники, process, route и asset-prefix не меняются.

