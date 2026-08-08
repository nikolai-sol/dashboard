import test from "node:test";
import assert from "node:assert/strict";
import {
  ABBOTT_UNMAPPED_LABEL,
  buildAbbottPageDimensionOptions,
  buildAbbottPageStatsExportRows,
  buildAbbottPageviewsByDirection,
  groupAbbottPageStatsByDimension,
  labelAbbottPageDimension,
  limitAbbottPageDimensionGroups,
  matchesPageStatsSearch,
  matchesSelectedPageDimension,
  matchesSelectedMaterialType,
  summarizeAbbottPageMetadataCoverage,
  summarizeAbbottPageStats,
} from "./abbott-page-stats";
import type { AbbottBiPageStatRow } from "@/lib/types";

const sampleRow: AbbottBiPageStatRow = {
  page_title: "Видеолекция о головокружении",
  url: "https://abbottpro.ru/video/262339",
  direction: "Неврология и психиатрия",
  material_type: "Видео",
  access: "Врачи",
  pageviews: 157,
  users: 122,
  bitrix_pageviews: 150,
  bitrix_sessions: 75,
  bitrix_users: 61,
  bitrix_logged_in_sessions: 44,
  bitrix_anonymous_sessions: 31,
  bitrix_avg_session_duration: 124.5,
};

test("empty material selection keeps all material types", () => {
  assert.equal(matchesSelectedMaterialType("Видео", []), true);
  assert.equal(matchesSelectedMaterialType(null, []), true);
});

test("material selection matches any selected type", () => {
  assert.equal(matchesSelectedMaterialType("Видео", ["Статьи", "Видео"]), true);
  assert.equal(matchesSelectedMaterialType("Калькуляторы", ["Статьи", "Видео"]), false);
  assert.equal(matchesSelectedMaterialType(null, [ABBOTT_UNMAPPED_LABEL]), true);
});

test("page dimension labels normalize null and blank values to the unmapped label", () => {
  assert.equal(labelAbbottPageDimension(null), ABBOTT_UNMAPPED_LABEL);
  assert.equal(labelAbbottPageDimension("  "), ABBOTT_UNMAPPED_LABEL);
  assert.equal(labelAbbottPageDimension("Видео"), "Видео");
  assert.equal(matchesSelectedPageDimension(null, ABBOTT_UNMAPPED_LABEL), true);
});

test("page stats search matches title or URL case-insensitively", () => {
  assert.equal(matchesPageStatsSearch(sampleRow.page_title, sampleRow.url, "головокружении"), true);
  assert.equal(matchesPageStatsSearch(sampleRow.page_title, sampleRow.url, "262339"), true);
  assert.equal(matchesPageStatsSearch(sampleRow.page_title, sampleRow.url, "неизвестная страница"), false);
});

test("page stats summary sums views and page-level visitors across every filtered row", () => {
  assert.deepEqual(
    summarizeAbbottPageStats([
      sampleRow,
      {
        ...sampleRow,
        pageviews: 43,
        users: 18,
      },
    ]),
    {
      pageviews: 200,
      users: 140,
    },
  );
});

test("page stats summary returns zero totals for an empty filtered result", () => {
  assert.deepEqual(summarizeAbbottPageStats([]), {
    pageviews: 0,
    users: 0,
  });
});

test("pageviews by direction aggregates null and blank values under the explicit unmapped label", () => {
  const rows = [
    { ...sampleRow, direction: "Кардиология", pageviews: 10 },
    { ...sampleRow, direction: "Неврология", pageviews: 25 },
    { ...sampleRow, direction: "Кардиология", pageviews: 7 },
    { ...sampleRow, direction: null, pageviews: 999 },
    { ...sampleRow, direction: "  ", pageviews: 998 },
  ];

  assert.deepEqual(buildAbbottPageviewsByDirection(rows, 3), [
    { label: ABBOTT_UNMAPPED_LABEL, value: 1997 },
    { label: "Неврология", value: 25 },
    { label: "Кардиология", value: 17 },
  ]);
});

test("page metadata options and chart groups retain one unmapped bucket", () => {
  const rows = [
    { ...sampleRow, material_type: null, access: "" },
    { ...sampleRow, material_type: "  ", access: null },
    { ...sampleRow, material_type: "Видео", access: "Врачи" },
  ];

  assert.deepEqual(buildAbbottPageDimensionOptions(rows, (row) => row.material_type), [
    { value: "Видео", label: "Видео" },
    { value: ABBOTT_UNMAPPED_LABEL, label: ABBOTT_UNMAPPED_LABEL },
  ]);
  assert.deepEqual(groupAbbottPageStatsByDimension(rows, (row) => row.access, (row) => row.users), [
    { label: ABBOTT_UNMAPPED_LABEL, value: 244 },
    { label: "Врачи", value: 122 },
  ]);
});

test("page chart groups retain an unmapped bucket after eight higher-valued mapped groups", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => ({
      ...sampleRow,
      direction: `Направление ${index + 1}`,
      users: 100 - index,
    })),
    { ...sampleRow, direction: null, users: 1 },
    { ...sampleRow, direction: "Направление 9", users: 50 },
  ];

  assert.deepEqual(
    limitAbbottPageDimensionGroups(
      groupAbbottPageStatsByDimension(rows, (row) => row.direction, (row) => row.users),
      8,
    ).map((row) => row.label),
    [
      "Направление 1",
      "Направление 2",
      "Направление 3",
      "Направление 4",
      "Направление 5",
      "Направление 6",
      "Направление 7",
      "Направление 8",
      ABBOTT_UNMAPPED_LABEL,
    ],
  );
});

test("metadata coverage reports mapped material pages and pageviews", () => {
  assert.deepEqual(
    summarizeAbbottPageMetadataCoverage([
      { ...sampleRow, pageviews: 30, material_type: "Видео" },
      { ...sampleRow, pageviews: 20, material_type: null },
      { ...sampleRow, pageviews: 10, material_type: " " },
    ]),
    { mappedRows: 1, totalRows: 3, mappedPageviews: 30, totalPageviews: 60 },
  );
});

test("metadata coverage treats a literal unmapped label as a mapped canonical material type", () => {
  assert.deepEqual(
    summarizeAbbottPageMetadataCoverage([{ ...sampleRow, pageviews: 30, material_type: ABBOTT_UNMAPPED_LABEL }]),
    { mappedRows: 1, totalRows: 1, mappedPageviews: 30, totalPageviews: 30 },
  );
});

test("pageviews by direction defaults to the top eight sorted results", () => {
  const rows = [
    { ...sampleRow, direction: "Кардиология", pageviews: 40 },
    { ...sampleRow, direction: "Неврология", pageviews: 100 },
    { ...sampleRow, direction: "Гастроэнтерология", pageviews: 60 },
    { ...sampleRow, direction: "Эндокринология", pageviews: 90 },
    { ...sampleRow, direction: "Терапия", pageviews: 20 },
    { ...sampleRow, direction: "Педиатрия", pageviews: 80 },
    { ...sampleRow, direction: "Дерматология", pageviews: 50 },
    { ...sampleRow, direction: "Онкология", pageviews: 70 },
    { ...sampleRow, direction: "Ревматология", pageviews: 10 },
    { ...sampleRow, direction: "Пульмонология", pageviews: 30 },
  ];

  assert.deepEqual(buildAbbottPageviewsByDirection(rows), [
    { label: "Неврология", value: 100 },
    { label: "Эндокринология", value: 90 },
    { label: "Педиатрия", value: 80 },
    { label: "Онкология", value: 70 },
    { label: "Гастроэнтерология", value: 60 },
    { label: "Дерматология", value: 50 },
    { label: "Кардиология", value: 40 },
    { label: "Пульмонология", value: 30 },
  ]);
});

test("export rows keep page identity and raw numeric metrics", () => {
  assert.deepEqual(buildAbbottPageStatsExportRows([sampleRow]), [
    {
      "Заголовок страницы": "Видеолекция о головокружении",
      URL: "https://abbottpro.ru/video/262339",
      Направление: "Неврология и психиатрия",
      "Тип материала": "Видео",
      Доступ: "Врачи",
      "Просмотры Метрики": 157,
      "Пользователи Метрики (page-level)": 122,
      "Просмотры Bitrix": 150,
      "Сессии Bitrix": 75,
      "User ID Bitrix": 61,
      "Сессии с User ID": 44,
      "Анонимные сессии": 31,
      "Средняя сессия Bitrix, мин": 2.08,
    },
  ]);
});

test("export rows label unmapped page metadata without changing metrics", () => {
  assert.deepEqual(buildAbbottPageStatsExportRows([{ ...sampleRow, direction: null, material_type: "", access: "  " }])[0], {
    "Заголовок страницы": "Видеолекция о головокружении",
    URL: "https://abbottpro.ru/video/262339",
    Направление: ABBOTT_UNMAPPED_LABEL,
    "Тип материала": ABBOTT_UNMAPPED_LABEL,
    Доступ: ABBOTT_UNMAPPED_LABEL,
    "Просмотры Метрики": 157,
    "Пользователи Метрики (page-level)": 122,
    "Просмотры Bitrix": 150,
    "Сессии Bitrix": 75,
    "User ID Bitrix": 61,
    "Сессии с User ID": 44,
    "Анонимные сессии": 31,
    "Средняя сессия Bitrix, мин": 2.08,
  });
});
