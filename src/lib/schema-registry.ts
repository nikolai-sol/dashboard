import fs from "fs";
import path from "path";
import { loadSchema, type PlatformSchema } from "@/lib/schema-parser";

export type SchemaMeta = {
  id: string;
  display_name: string;
  source: PlatformSchema["source"];
  schema_file: string;
  source_key: string;
  source_type: PlatformSchema["source_type"] | null;
  canonical_table: string | null;
};

function schemasDir() {
  return path.join(process.cwd(), "src", "schemas");
}

export function listSchemaMetas(): SchemaMeta[] {
  const dir = schemasDir();
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort((a, b) => a.localeCompare(b));

  const metas: SchemaMeta[] = [];
  for (const file of files) {
    const schemaFile = `schemas/${file}`;
    const schema = loadSchema(schemaFile);
    metas.push({
      id: schema.platform,
      display_name: schema.display_name,
      source: schema.source,
      schema_file: schemaFile,
      source_key: schema.source_key ?? schema.platform,
      source_type: schema.source_type ?? (schema.source === "gsheet" ? "gsheet" : "ads"),
      canonical_table: schema.canonical_table ?? null,
    });
  }

  return metas;
}

export function getSchemaMetaByPlatform(platformId: string): SchemaMeta | null {
  const metas = listSchemaMetas();
  return metas.find((meta) => meta.id === platformId) ?? null;
}
