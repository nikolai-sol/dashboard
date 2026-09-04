import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  isPortalHostname,
  parseAliceVisibilityWorkbook,
} from "@/lib/zaruku-alice-visibility-import";

function workbookBuffer(rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "sheet1");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

const header = ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", ...Array.from({ length: 10 }, (_, i) => `Сайт ${i + 1}`)];
const input = { accountId: "66624469", portalDomain: "zaruku.ru", period: "2026-08", officialSovPct: 43.91, capturedAt: "2026-09-04T13:28:14.000Z", sourceFilename: "export.xlsx", featuredSites: ["https://onco-life.ru"] };

test("portal matching uses the hostname rather than a URL substring", () => {
  assert.equal(isPortalHostname("zaruku.ru", "zaruku.ru"), true);
  assert.equal(isPortalHostname("www.zaruku.ru", "zaruku.ru"), true);
  assert.equal(isPortalHostname("catalog.example", "zaruku.ru"), false);
});

test("parser keeps official SoV separate from exported example coverage", () => {
  const parsed = parseAliceVisibilityWorkbook(workbookBuffer([header,
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

test("parser rejects malformed headers", () => assert.throws(() => parseAliceVisibilityWorkbook(workbookBuffer([["Запрос"], ["q"]]), input), /Заголовки/));
test("parser rejects non-empty extra header columns", () => assert.throws(() => parseAliceVisibilityWorkbook(workbookBuffer([[...header, "Сайт 11"], ["q", "false", "https://a.test", "https://example.org"]]), input), /Заголовки/));
test("parser rejects non-empty cells beyond the tenth source", () => assert.throws(() => parseAliceVisibilityWorkbook(workbookBuffer([[...header], ["q", "false", "https://a.test", "https://example.org", ...Array(9).fill(null), "https://extra.example"]]), input), /лишн/));
test("parser rejects duplicate queries", () => assert.throws(() => parseAliceVisibilityWorkbook(workbookBuffer([header, ["q", "false", "https://a.test", "https://example.org"], [" Q ", "false", "https://a.test", "https://example.org"]]), input), /повторяется/));
test("parser rejects invalid presence flags", () => assert.throws(() => parseAliceVisibilityWorkbook(workbookBuffer([header, ["q", "yes", "https://a.test", "https://example.org"]]), input), /true или false/));
test("parser rejects invalid URLs", () => assert.throws(() => parseAliceVisibilityWorkbook(workbookBuffer([header, ["q", "false", "not-a-url", "https://example.org"]]), input), /ссылка отсутствует|Invalid URL/));
test("parser rejects presence/source mismatches", () => assert.throws(() => parseAliceVisibilityWorkbook(workbookBuffer([header, ["q", "true", "https://a.test", "https://example.org"]]), input), /не совпадает/));
