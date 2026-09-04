import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

test("ExcelJS export helper preserves column order, widths, and row values", async () => {
  const modulePath = "./excel-export";
  const loaded = await import(modulePath).catch(() => ({}));
  const createExcelRecordsBlob = (loaded as {
    createExcelRecordsBlob?: (
      rows: Array<Record<string, string | number>>,
      options: { sheetName: string; columns: Array<{ header: string; width: number }> },
    ) => Promise<Blob>;
  }).createExcelRecordsBlob;
  assert.equal(typeof createExcelRecordsBlob, "function");

  const blob = await createExcelRecordsBlob!(
    [{ Name: "Alpha", Count: 2 }],
    { sheetName: "Rows", columns: [{ header: "Name", width: 24 }, { header: "Count", width: 12 }] },
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const worksheet = workbook.getWorksheet("Rows")!;
  assert.deepEqual((worksheet.getRow(1).values as unknown[]).slice(1), ["Name", "Count"]);
  assert.deepEqual((worksheet.getRow(2).values as unknown[]).slice(1), ["Alpha", 2]);
  assert.equal(worksheet.getColumn(1).width, 24);
  assert.equal(worksheet.getColumn(2).width, 12);
});
