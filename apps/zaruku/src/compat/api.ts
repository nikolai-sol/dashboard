// Temporary combined-runtime adapters. Isolated routes import their own implementations directly.
export { createZarukuDashboardGetHandler } from "../lib/zaruku-json-handler";
export { createZarukuExcelGetHandler } from "../lib/zaruku-excel-handler";
export { createZarukuPdfGetHandler } from "../lib/zaruku-pdf-handler";
export { isZarukuDashboardIdentity } from "../lib/zaruku-route-access";
