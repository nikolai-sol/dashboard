import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Kpi,
  KpiStrip,
  Panel,
  StatusBadge,
  TableFrame,
} from "../src/components/DashboardPrimitives";
import { SiteSeoShell } from "../src/components/SiteSeoShell";
import { readFileSync } from "node:fs";

test("neutral primitives expose a panel header and an accessible table frame", () => {
  const panel = renderToStaticMarkup(
    createElement(Panel, { title: "Трафик" }, "body"),
  );
  const tableFrame = renderToStaticMarkup(
    createElement(TableFrame, { label: "Страницы" }, "rows"),
  );

  assert.match(panel, /site-seo-panel/);
  assert.match(panel, /<h2[^>]*>Трафик<\/h2>/);
  assert.match(tableFrame, /role="region"/);
  assert.match(tableFrame, /aria-label="Страницы"/);
  assert.match(tableFrame, /tabindex="0"/);
});

test("neutral KPI and status primitives render supplied presentation values", () => {
  const html = renderToStaticMarkup(
    createElement(
      KpiStrip,
      null,
      createElement(Kpi, {
        label: "Клики",
        value: createElement("strong", null, "120"),
        detail: "за период",
      }),
      createElement(StatusBadge, { state: "success" }),
    ),
  );

  assert.match(html, /site-seo-kpi-strip/);
  assert.match(html, /site-seo-kpi/);
  assert.match(html, /<strong>120<\/strong>/);
  assert.match(html, /за период/);
  assert.match(html, /site-seo-status-badge/);
  assert.match(html, /data-state="success"/);
  assert.match(html, />success<\/span>/);
});

test("neutral primitives retain numeric zero copy", () => {
  const panel = renderToStaticMarkup(createElement(Panel, { title: "Трафик", subtitle: 0 }, "body"));
  const kpi = renderToStaticMarkup(createElement(Kpi, { label: "Изменение", value: 0, detail: 0 }));
  assert.match(panel, />0<\/p>/);
  assert.match(kpi, /site-seo-kpi-detail[^>]*>0</);
});

test("site shell uses the same single-frame composition as the reference dashboard", () => {
  const html = renderToStaticMarkup(createElement(SiteSeoShell, {
    title: "Клиника",
    domain: "clinic.example",
    logoAsset: "/logo.svg",
    tabs: [{ id: "overview", label: "Обзор" }, { id: "search", label: "Поиск" }],
    activeTab: "search",
    tabHref: (id: string) => `?scope=fixture&tab=${id}`,
    toolbar: createElement("form", { "aria-label": "toolbar" }),
    exports: createElement("a", { href: "/export" }, "Экспорт"),
  }, createElement("section", { id: "search" }, "Содержимое")));

  assert.match(html, /<main class="site-seo-page"[^>]*><div class="site-seo-dashboard"><aside class="site-seo-rail">/);
  assert.match(html, /site-seo-identity[\s\S]*aria-label="Разделы"/);
  assert.match(html, /site-seo-content[\s\S]*site-seo-header[\s\S]*<h1>Поиск<\/h1>/);
  assert.match(html, /site-seo-mobile-tabs/);
  assert.match(html, /Клиника/);
  assert.match(html, /clinic\.example/);
  assert.match(html, /src="\/logo\.svg"/);
  assert.match(html, /href="\?scope=fixture&amp;tab=search" aria-current="page"/);
  assert.match(html, /aria-label="toolbar"/);
  assert.match(html, /href="\/export"/);
  assert.match(html, /id="search"/);
});

test("login and unavailable responses use the local centred state-card wrapper", () => {
  const page = readFileSync(new URL("../src/app/dashboard/[siteSlug]/page.tsx", import.meta.url), "utf8");

  assert.match(page, /site-seo-state-page/);
  assert.equal(page.match(/site-seo-state-card/g)?.length, 2);
  assert.match(page, /<LoginForm dashboardId=\{runtime\.registration\.profile\.dashboardId\} siteSlug=\{siteSlug\} \/>/);
  assert.match(page, /Данные пока недоступны: не установлен canonical read model\./);
});
