declare module "exceljs/lib/doc/workbook" {
  import ExcelJS from "exceljs";

  const Workbook: typeof ExcelJS.Workbook;
  export default Workbook;
}
