import test from "node:test";
import assert from "node:assert/strict";
import {
  ABBOTT_UNMAPPED_LABEL,
  buildAbbottMnnOptions,
  formatAbbottMnnValues,
  buildAbbottPageDimensionOptions,
  buildAbbottPageStatsExportRows,
  buildAbbottPageviewsByDirection,
  filterAbbottPageStatsRows,
  groupAbbottPageStatsByDimension,
  labelAbbottPageDimension,
  limitAbbottPageDimensionGroups,
  matchesPageStatsSearch,
  matchesSelectedPageDimension,
  matchesSelectedMaterialType,
  matchesSelectedMnn,
  summarizeAbbottPageMetadataCoverage,
  summarizeAbbottPageStats,
} from "./abbott-page-stats";
import type { AbbottBiPageStatRow } from "@/lib/types";

const sampleRow: AbbottBiPageStatRow = {
  page_title: "Видеолекция о головокружении",
  url: "https://abbottpro.ru/video/262339",
  direction: "Неврология и психиатрия",
  mnn: [
    { key: "омакор", label: "Омакор" },
    { key: "трайкор", label: "Трайкор" },
  ],
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

const reviewedArticleMnnCases = [
  {
    id: 9918,
    url: "https://abbottpro.ru/academy/articles/narusheniya-obmena-lipidov-v-svete-rossiyskikh-klinicheskikh-rekomendatsiy-2023-goda-povtorenie-proy",
    raw: ["супра", "трайкор"],
    expected: "Супрозафен; Трайкор",
  },
  {
    id: 19209,
    url: "https://abbottpro.ru/academy/videos/vozmozhnosti-vnedreniya-ranney-stratifikatsii-serdechno-sosudistogo-riska",
    raw: ["Омакор", "супра", "трайкор"],
    expected: "Омакор; Супрозафен; Трайкор",
  },
  {
    id: 19239,
    url: "https://abbottpro.ru/academy/videos/suprozafen-odno-resheniye-dlya-dvukh-tseley-terapii-smeshannoy-dislipidemii",
    raw: ["супра"],
    expected: "Супрозафен",
  },
  {
    id: 19443,
    url: "https://abbottpro.ru/academy/videos/satellitniy-simpozium-gipertriglitseridemiya-stranstviye-v-reshenii-problemy-riska-ssz-i-pankreatita",
    raw: ["Омакор", "трайкор супра"],
    expected: "Омакор; Трайкор; Супрозафен",
  },
];

const noPageFilters = {
  query: "", pageTitleQuery: "", direction: "", mnn: [] as string[], materialTypes: [] as string[], access: "",
};

for (const article of reviewedArticleMnnCases) {
  test(`reviewed article ${article.id} uses the same MNN correction in options, filter, search, table and export`, () => {
    const row: AbbottBiPageStatRow = {
      ...sampleRow, page_title: "Материал", url: article.url,
      mnn: article.raw.map((label) => ({ key: label.toLocaleLowerCase("ru"), label })),
    };
    const before = structuredClone(row);
    const options = buildAbbottMnnOptions([row]);
    assert.ok(options.some((option) => option.value === "супрозафен" && option.label === "Супрозафен"));
    assert.ok(options.every((option) => !["супра", "трайкор супра"].includes(option.value)));
    assert.equal(formatAbbottMnnValues(row.mnn, options, row.url), article.expected);
    assert.equal(buildAbbottPageStatsExportRows([row])[0].МНН, article.expected);
    assert.deepEqual(filterAbbottPageStatsRows([row], { ...noPageFilters, mnn: ["супрозафен"] }), [row]);
    assert.deepEqual(filterAbbottPageStatsRows([row], { ...noPageFilters, query: "Супрозафен" }), [row]);
    assert.deepEqual(filterAbbottPageStatsRows([row], { ...noPageFilters, query: "супра" }), [row]);
    assert.deepEqual(summarizeAbbottPageStats([row]), { pageviews: 157, users: 122 });
    assert.deepEqual(row, before);
  });
}

test("article MNN rules do not normalize unreviewed articles, foreign hosts, or unrelated source keys", () => {
  const known = reviewedArticleMnnCases[0].url;
  const unreviewedUrls = [
    "https://abbottpro.ru/academy/videos/kontrol-triglitseridov-kak-faktor-snizheniya-serdechno-sosudistogo-riska",
    "https://abbottpro.ru/academy/videos/kak-priumnozhit-nashi-sily-v-borbe-za-znaniya",
    known.replace("https://abbottpro.ru", "https://other.example"),
    known.replace("https://", "http://"),
    `${known}/other`,
    "",
  ];
  for (const url of unreviewedUrls) {
    const row = { ...sampleRow, url, page_title: "Материал", mnn: [{ key: "супра", label: "супра" }] };
    assert.equal(buildAbbottPageStatsExportRows([row])[0].МНН, "супра");
    assert.deepEqual(filterAbbottPageStatsRows([row], { ...noPageFilters, mnn: ["супрозафен"] }), []);
  }
  const otherKey = { ...sampleRow, url: known, mnn: [{ key: "трайкор супра", label: "трайкор супра" }] };
  assert.equal(buildAbbottPageStatsExportRows([otherKey])[0].МНН, "трайкор супра");
  assert.equal(buildAbbottPageStatsExportRows([{ ...otherKey, mnn: [] }])[0].МНН, ABBOTT_UNMAPPED_LABEL);
});

test("reviewed compound correction is idempotent, deduplicates products and retains unknown values", () => {
  const row = {
    ...sampleRow, url: reviewedArticleMnnCases[3].url,
    mnn: [
      { key: "омакор", label: "Омакор" },
      { key: "трайкор супра", label: "трайкор супра" },
      { key: "супрозафен", label: "Супрозафен" },
      { key: "трайкор", label: "Трайкор" },
      { key: "особое", label: "Особое" },
    ],
  };
  const before = structuredClone(row);
  for (const url of [row.url, `${row.url}/`, `${row.url}/?utm_source=test#section`]) {
    assert.equal(buildAbbottPageStatsExportRows([{ ...row, url }])[0].МНН, "Омакор; Трайкор; Супрозафен; Особое");
  }
  assert.deepEqual(row, before);
  const canonical = { ...row, mnn: row.mnn.filter((value) => value.key !== "трайкор супра") };
  assert.equal(buildAbbottPageStatsExportRows([canonical])[0].МНН, "Омакор; Супрозафен; Трайкор; Особое");
});

test("mixed article options keep unresolved supra separate from the reviewed product", () => {
  const known = { ...sampleRow, url: reviewedArticleMnnCases[0].url, mnn: [{ key: "супра", label: "супра" }] };
  const unresolved = { ...known, url: "https://abbottpro.ru/academy/videos/kak-priumnozhit-nashi-sily-v-borbe-za-znaniya" };
  assert.deepEqual(buildAbbottMnnOptions([known, unresolved]).map((x) => x.value).sort(), ["супра", "супрозафен"]);
  assert.deepEqual(filterAbbottPageStatsRows([known, unresolved], { ...noPageFilters, mnn: ["супра"] }), [unresolved]);
  assert.deepEqual(filterAbbottPageStatsRows([known, unresolved], { ...noPageFilters, mnn: ["супрозафен"] }), [known]);
});

test("empty material selection keeps all material types", () => {
  assert.equal(matchesSelectedMaterialType("Видео", []), true);
  assert.equal(matchesSelectedMaterialType(null, []), true);
});

test("material selection matches any selected type", () => {
  assert.equal(matchesSelectedMaterialType("Видео", ["Статьи", "Видео"]), true);
  assert.equal(matchesSelectedMaterialType("Калькуляторы", ["Статьи", "Видео"]), false);
  assert.equal(matchesSelectedMaterialType(null, [ABBOTT_UNMAPPED_LABEL]), true);
});

test("MNN selection uses OR within the filter and keeps unmapped rows explicit", () => {
  assert.equal(matchesSelectedMnn(
    [{ key: "омакор", label: "Омакор" }, { key: "трайкор", label: "Трайкор" }],
    ["трайкор", "клацид"],
  ), true);
  assert.equal(matchesSelectedMnn([{ key: "омакор", label: "Омакор" }], ["трайкор", "клацид"]), false);
  assert.equal(matchesSelectedMnn([], []), true);
  assert.equal(matchesSelectedMnn([], [ABBOTT_UNMAPPED_LABEL]), true);
});

test("global page search includes every MNN label", () => {
  assert.equal(
    filterAbbottPageStatsRows([sampleRow], {
      query: "трайкор",
      pageTitleQuery: "",
      direction: "",
      mnn: [],
      materialTypes: [],
      access: "",
    }).length,
    1,
  );
});

test("MNN display variants with the same semantic key collapse to one canonical label", () => {
  const rows = [
    { ...sampleRow, mnn: [{ key: "физиотенз", label: "физиотенз" }] },
    { ...sampleRow, url: `${sampleRow.url}/2`, mnn: [{ key: "физиотенз", label: "Физиотенз®" }] },
    { ...sampleRow, url: `${sampleRow.url}/3`, mnn: [{ key: "физиотенз", label: "Физиотенз" }] },
    { ...sampleRow, url: `${sampleRow.url}/4`, mnn: [{ key: "физотенз", label: "физотенз" }] },
  ];

  assert.deepEqual(
    buildAbbottPageStatsExportRows(rows).map((row) => row.МНН),
    ["Физиотенз", "Физиотенз", "Физиотенз", "Физиотенз"],
  );
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

test("page stats selector applies direction, material type, access, and both searches as one predicate", () => {
  const matchingRow = { ...sampleRow };
  const rows = [
    matchingRow,
    { ...sampleRow, url: "https://abbottpro.ru/video/other-direction", direction: "Кардиология" },
    { ...sampleRow, url: "https://abbottpro.ru/article/262339", material_type: "Статья" },
    { ...sampleRow, url: "https://abbottpro.ru/public/262339", access: "Все" },
    { ...sampleRow, page_title: "Видеолекция о мигрени" },
    { ...sampleRow, url: "https://abbottpro.ru/video/no-material-id" },
  ];

  assert.deepEqual(
    filterAbbottPageStatsRows(rows, {
      query: "головокружении",
      pageTitleQuery: "262339",
      direction: "Неврология и психиатрия",
      mnn: ["омакор"],
      materialTypes: ["Видео"],
      access: "Врачи",
    }),
    [matchingRow],
  );
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
      МНН: "Омакор; Трайкор",
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
    МНН: "Омакор; Трайкор",
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


const approvedMnnSpellings = [
  ["селетра", "Селетра", "селектра", "Селектра"],
  ["супразофен", "супразофен", "супрозафен", "Супрозафен"],
  ["трайкоор", "Трайкоор", "трайкор", "Трайкор"],
  ["физотенз", "физотенз", "физиотенз", "Физиотенз"],
] as const;

for (const [rawKey, rawLabel, canonicalKey, canonicalLabel] of approvedMnnSpellings) {
  test(`approved MNN spelling ${rawLabel} is canonical even when no correct label exists`, () => {
    const row = { ...sampleRow, mnn: [{ key: rawKey, label: rawLabel }] };
    const options = buildAbbottMnnOptions([row]);
    assert.deepEqual(options, [{ value: canonicalKey, label: canonicalLabel }]);
    assert.equal(formatAbbottMnnValues(row.mnn, options), canonicalLabel);
    assert.equal(formatAbbottMnnValues(row.mnn, []), canonicalLabel);
    assert.equal(buildAbbottPageStatsExportRows([row])[0].МНН, canonicalLabel);
    assert.equal(matchesSelectedMnn(row.mnn, [canonicalKey]), true);
    assert.equal(matchesSelectedMnn([{ key: canonicalKey, label: canonicalLabel }], [rawKey]), true);
  });

  test(`MNN search keeps raw and corrected ${canonicalLabel} names searchable`, () => {
    const row = { ...sampleRow, mnn: [{ key: rawKey, label: rawLabel }] };
    const canonicalRow = { ...sampleRow, mnn: [{ key: canonicalKey, label: canonicalLabel }] };
    for (const query of [rawLabel, rawKey, canonicalLabel, canonicalKey]) {
      const filters = { query, pageTitleQuery: "", direction: "", mnn: [], materialTypes: [], access: "" };
      assert.deepEqual(filterAbbottPageStatsRows([row], filters), [row]);
      assert.deepEqual(filterAbbottPageStatsRows([canonicalRow], filters), [canonicalRow]);
    }
  });
}

test("canonical MNN duplicates collapse within an article without changing other values or metrics", () => {
  const row = {
    ...sampleRow,
    mnn: [
      { key: "трайкоор", label: "Трайкоор" },
      { key: "омега", label: "омега" },
      { key: "трайкор", label: "Трайкор®" },
      { key: "физио", label: "физио" },
      { key: "супра", label: "супра" },
      { key: "трайкор супра", label: "трайкор супра" },
      { key: "бетасерк 24 мг", label: "Бетасерк 24 мг" },
      { key: "неизвестное", label: "Неизвестное название" },
    ],
  };
  const before = structuredClone(row);
  const options = buildAbbottMnnOptions([row]);
  assert.equal(options.filter((option) => option.value === "трайкор").length, 1);
  assert.equal(formatAbbottMnnValues(row.mnn, options),
    "Трайкор; омега; физио; супра; трайкор супра; Бетасерк 24 мг; Неизвестное название");
  const exported = buildAbbottPageStatsExportRows([row]);
  assert.equal(exported.length, 1);
  assert.equal(exported[0].МНН, formatAbbottMnnValues(row.mnn, options));
  const { МНН: _beforeMnn, ...beforeMetrics } = buildAbbottPageStatsExportRows([sampleRow])[0];
  const { МНН: _afterMnn, ...afterMetrics } = exported[0];
  assert.deepEqual(afterMetrics, beforeMetrics);
  assert.deepEqual(summarizeAbbottPageStats([row]), { pageviews: 157, users: 122 });
  assert.deepEqual(row, before);
});
