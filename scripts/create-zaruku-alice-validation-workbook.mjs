#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";

export async function createZarukuAliceValidationWorkbook(outputPath) {
  if (!outputPath || !path.isAbsolute(outputPath)) {
    throw new Error("An absolute output path is required");
  }
  const nonce = randomBytes(16).toString("hex");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `release-validation-${nonce}`;
  workbook.addWorksheet("Alice validation").addRows([
    ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", ...Array.from({ length: 10 }, (_unused, index) => `Сайт ${index + 1}`)],
    [
      `release validation present ${nonce}`,
      "true",
      `https://yandex.ru/search/?text=present-${nonce}`,
      `https://zaruku.ru/release-validation/${nonce}`,
      `https://source-a.example/${nonce}`,
    ],
    [
      `release validation absent ${nonce}`,
      "false",
      `https://yandex.ru/search/?text=absent-${nonce}`,
      `https://source-b.example/${nonce}`,
    ],
  ]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createZarukuAliceValidationWorkbook(process.argv[2]).catch((error) => {
    process.stderr.write(`Unable to create Alice release validation workbook: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
