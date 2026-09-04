import ExcelJS from "exceljs";

export type ExcelExportColumn = {
  header: string;
  width?: number;
};

export async function createExcelRecordsBlob(
  rows: Array<Record<string, string | number>>,
  {
    sheetName,
    columns,
  }: {
    sheetName: string;
    columns: ExcelExportColumn[];
  },
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = columns.map(({ header, width }) => ({
    header,
    key: header,
    ...(width === undefined ? {} : { width }),
  }));
  worksheet.addRows(rows);
  const bytes = await workbook.xlsx.writeBuffer();
  return new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
