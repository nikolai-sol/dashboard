import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");
const toolbarSource = readFileSync(new URL("./ZarukuSeoWeekToolbar.tsx", import.meta.url), "utf8");

test("dashboard distinguishes the traffic period from SEO week selection", () => {
  assert.match(source, /Период трафика:\s*<\/span>\s*<span>\{data\.period\.from\} — \{data\.period\.to\}<\/span>/);
});

test("SEO week toolbar names its reporting period", () => {
  assert.match(toolbarSource, /Отчётная SEO-неделя/);
});

test("navigation uses the full geography label", () => {
  assert.match(source, /\{ id: "geo", label: "География", icon: MapPin \}/);
});

test("DataTable keeps behavior metric headers readable with spacing and wrapping", () => {
  assert.match(source, /min-w-\[1080px\]/);
  assert.match(source, /table-fixed/);
  assert.match(source, /px-3 pb-2 text-right font-medium leading-tight/);
  assert.match(source, /whitespace-normal/);
});

test("SEO tab renders one AI visibility panel and keeps long tables bounded", () => {
  const aiPanelMatches = source.match(/<AiAggregateVisibilityPanel/g) ?? [];

  assert.equal(aiPanelMatches.length, 1);
  assert.match(source, /data\.organic_landing_pages\.slice\(0, 10\)/);
  assert.match(source, /max-h-\[29rem\]/);
  assert.match(source, /max-h-\[30rem\]/);
});

test("SEO tab explains Metrika search phrases and hides empty Yandex landing page facts", () => {
  assert.match(source, /Поисковые фразы из Метрики/);
  assert.match(source, /Фразы, которые Метрика смогла определить после клика/);
  assert.match(source, /webmasterPages\.length > 0/);
});

test("SEO tab labels Yandex query table from its own week selection", () => {
  assert.match(source, /const webmasterQueryMeta = buildWebmasterSelectionMeta\(webmasterQuerySelection, webmasterWeek\)/);
  assert.match(source, /webmasterQueryMeta\.fallbackNote/);
});
