import assert from "node:assert/strict";
import test from "node:test";
import { abbottDatabaseConfig } from "../../../../src/lib/abbott-private-store";

test("embed and manager credentials remain distinct", () => {
  const environment = {
    ABBOTT_EMBED_DB_HOST: "embed-db",
    ABBOTT_EMBED_DB_PORT: "3307",
    ABBOTT_EMBED_DB_USER: "embed-user",
    ABBOTT_EMBED_DB_PASSWORD: "embed-password",
    ABBOTT_EMBED_DB_NAME: "report_bd",
    ABBOTT_PRIVATE_DB_HOST: "manager-db",
    ABBOTT_PRIVATE_DB_PORT: "3308",
    ABBOTT_PRIVATE_DB_USER: "manager-user",
    ABBOTT_PRIVATE_DB_PASSWORD: "manager-password",
    ABBOTT_PRIVATE_DB_NAME: "report_bd_private",
  };

  assert.equal(abbottDatabaseConfig("embed", environment).database, "report_bd");
  assert.equal(abbottDatabaseConfig("manager", environment).database, "report_bd_private");
  assert.equal(abbottDatabaseConfig("embed", environment).user, "embed-user");
  assert.equal(abbottDatabaseConfig("manager", environment).user, "manager-user");
});
