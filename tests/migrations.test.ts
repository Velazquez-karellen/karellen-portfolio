import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("all D1 migrations apply in order to a fresh SQLite database", async () => {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON");
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        if (statement.trim()) database.exec(statement);
      }
    }
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map((row) => String(row.name));
    assert.ok(tables.includes("translation_jobs"));
    assert.ok(tables.includes("admin_audit_log"));
    assert.ok(tables.includes("project_translations"));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM supported_locales").get()?.count, 2);
  } finally {
    database.close();
  }
});
