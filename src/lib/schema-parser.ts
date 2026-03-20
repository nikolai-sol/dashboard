import fs from "fs";
import path from "path";
import YAML from "yaml";

export interface PlatformSchema {
  platform: string;
  display_name: string;
  source: "mysql" | "gsheet";
  source_key?: string;
  source_type?: "ads" | "analytics" | "gsheet" | "manual" | "leads";
  canonical_table?: string;
  tables?: {
    campaigns: {
      table: string;
      filter?: string;
      id_col: string;
      name_col: string;
    };
    stats: {
      table: string;
      join_to: string;
      join_on: string;
      filter?: string;
      date_col: string;
      metrics: Array<{
        col: string;
        label: string;
        type: string;
        format?: string;
        currency?: string;
      }>;
    };
  };
  sheet_url?: string;
  columns?: Array<{
    col: string;
    label: string;
    type: string;
    currency?: string;
  }>;
}

function normalizeSchemaPath(schemaFile: string): string {
  const clean = schemaFile.replace(/^\/+/, "").replace(/^src\//, "");
  return path.join(process.cwd(), "src", clean);
}

export function loadSchema(schemaFile: string): PlatformSchema {
  const filePath = normalizeSchemaPath(schemaFile);
  const content = fs.readFileSync(filePath, "utf-8");
  return YAML.parse(content) as PlatformSchema;
}
