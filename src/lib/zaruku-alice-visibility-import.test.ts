import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  isPortalHostname,
  parseAliceVisibilityWorkbook,
} from "@/lib/zaruku-alice-visibility-import";

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_QUERY_ROWS = 5_000;

async function workbookBuffer(rows: unknown[][], additionalSheets: unknown[][][] = []): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("sheet1").addRows(rows);
  additionalSheets.forEach((sheetRows, index) => {
    workbook.addWorksheet(`extra-${index + 1}`).addRows(sheetRows);
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const header = ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", ...Array.from({ length: 10 }, (_, i) => `Сайт ${i + 1}`)];
const input = { accountId: "66624469", portalDomain: "zaruku.ru", period: "2026-08", officialSovPct: 43.91, capturedAt: "2026-09-04T13:28:14.000Z", sourceFilename: "export.xlsx", featuredSites: ["https://onco-life.ru"] };

test("portal matching uses the hostname rather than a URL substring", () => {
  assert.equal(isPortalHostname("zaruku.ru", "zaruku.ru"), true);
  assert.equal(isPortalHostname("www.zaruku.ru", "zaruku.ru"), true);
  assert.equal(isPortalHostname("catalog.example", "zaruku.ru"), false);
});

test("ExcelJS parser keeps official SoV separate from exported example coverage", async () => {
  const parsed = await parseAliceVisibilityWorkbook(await workbookBuffer([header,
    ["инвалидность после мастэктомии", "true", "https://yandex.ru/search/?text=x", "https://zaruku.ru/article/", "https://example.org/a"],
    ["онкологический центр", "false", "https://yandex.ru/search/?text=y", "https://example.org/b", "https://catalog.example/review/zaruku.ru.html"],
  ]), input);
  assert.equal(parsed.officialSovPct, 43.91);
  assert.equal(parsed.exportedQueryCount, 2);
  assert.equal(parsed.portalPresentQueryCount, 1);
  assert.equal(parsed.samplePresencePct, 50);
  assert.equal(parsed.queries[0].portalPosition, 1);
  assert.equal(parsed.queries[1].portalPosition, null);
  assert.equal(parsed.sources.length, 4);
});

test("ExcelJS parser preserves the reviewed 155/89/1313 real-workbook totals", async () => {
  const rows = Array.from({ length: 155 }, (_, index) => {
    const sourceCount = index < 73 ? 9 : 8;
    const portalPresent = index < 89;
    const sources = Array.from({ length: sourceCount }, (_unused, sourceIndex) =>
      portalPresent && sourceIndex === 0
        ? `https://zaruku.ru/article-${index}`
        : `https://source-${sourceIndex}.example/query-${index}`,
    );
    return [`query ${index}`, String(portalPresent), `https://yandex.ru/search/?text=${index}`, ...sources];
  });
  const parsed = await parseAliceVisibilityWorkbook(
    await workbookBuffer([header, ...rows]),
    { ...input, featuredSites: Array.from({ length: 10 }, (_, index) => `https://featured-${index}.example`) },
  );
  assert.equal(parsed.exportedQueryCount, 155);
  assert.equal(parsed.portalPresentQueryCount, 89);
  assert.equal(parsed.sources.length, 1_313);
  assert.equal(parsed.featured.length, 10);
  assert.ok(Math.abs(parsed.samplePresencePct - 57.41935483870968) < 1e-12);
});

test("parser rejects compressed workbook input above five MiB before decoding", async () => {
  await assert.rejects(
    async () => parseAliceVisibilityWorkbook(Buffer.alloc(MAX_WORKBOOK_BYTES + 1), input),
    /5 MiB|размер/i,
  );
});

test("parser requires exactly one worksheet", async () => {
  await assert.rejects(
    async () => parseAliceVisibilityWorkbook(
      await workbookBuffer([header, ["q", "false", "https://a.test", "https://example.org"]], [[header]]),
      input,
    ),
    /один рабочий лист/i,
  );
});

test("parser rejects more than 5000 query rows", async () => {
  const rows = Array.from({ length: MAX_QUERY_ROWS + 1 }, (_, index) => [
    `query ${index}`,
    "false",
    `https://yandex.ru/search/?text=${index}`,
    "https://example.org",
  ]);
  await assert.rejects(
    async () => parseAliceVisibilityWorkbook(await workbookBuffer([header, ...rows]), input),
    /5000|строк/i,
  );
});

test("parser rejects more than 100 featured sites before decoding", async () => {
  await assert.rejects(
    async () => parseAliceVisibilityWorkbook(
      await workbookBuffer([header]),
      { ...input, featuredSites: Array.from({ length: 101 }, (_, index) => `https://featured-${index}.example`) },
    ),
    /100|отмеченных/i,
  );
});

test("parser rejects malformed headers", async () => assert.rejects(async () => parseAliceVisibilityWorkbook(await workbookBuffer([["Запрос"], ["q"]]), input), /Заголовки/));
test("parser rejects non-empty extra header columns", async () => assert.rejects(async () => parseAliceVisibilityWorkbook(await workbookBuffer([[...header, "Сайт 11"], ["q", "false", "https://a.test", "https://example.org"]]), input), /Заголовки/));
test("parser rejects non-empty cells beyond the tenth source", async () => assert.rejects(async () => parseAliceVisibilityWorkbook(await workbookBuffer([[...header], ["q", "false", "https://a.test", "https://example.org", ...Array(9).fill(null), "https://extra.example"]]), input), /лишн/));
test("parser rejects duplicate queries", async () => assert.rejects(async () => parseAliceVisibilityWorkbook(await workbookBuffer([header, ["q", "false", "https://a.test", "https://example.org"], [" Q ", "false", "https://a.test", "https://example.org"]]), input), /повторяется/));
test("parser rejects invalid presence flags", async () => assert.rejects(async () => parseAliceVisibilityWorkbook(await workbookBuffer([header, ["q", "yes", "https://a.test", "https://example.org"]]), input), /true или false/));
test("parser rejects invalid URLs", async () => assert.rejects(async () => parseAliceVisibilityWorkbook(await workbookBuffer([header, ["q", "false", "not-a-url", "https://example.org"]]), input), /ссылка отсутствует|Invalid URL/));
test("parser rejects presence/source mismatches", async () => assert.rejects(async () => parseAliceVisibilityWorkbook(await workbookBuffer([header, ["q", "true", "https://a.test", "https://example.org"]]), input), /не совпадает/));
