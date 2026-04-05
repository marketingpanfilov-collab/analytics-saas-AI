/**
 * Applies supabase/migrations/20260630104000_billing_org_id_required.sql via direct Postgres.
 * Requires DATABASE_URL (Settings → Database → URI, often pooler :6543) in .env.local — NOT the same as NEXT_PUBLIC_SUPABASE_URL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

function loadEnvLocal() {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvLocal();

const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.SUPABASE_DB_URL?.trim();
if (!databaseUrl) {
  console.error(
    "Нет DATABASE_URL (или SUPABASE_DB_URL) в окружении / .env.local.\n" +
      "Возьмите строку из Supabase → Project Settings → Database → Connection string → URI (нужен пароль БД).\n" +
      "NEXT_PUBLIC_SUPABASE_URL — это HTTPS API, через него DDL выполнить нельзя."
  );
  process.exit(1);
}

const migrationFile = path.join(root, "supabase/migrations/20260630104000_billing_org_id_required.sql");
const sql = fs.readFileSync(migrationFile, "utf8");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  console.log("Connected. Running migration:", path.basename(migrationFile));
  await client.query(sql);
  console.log("OK: migration finished.");
} catch (e) {
  console.error("Migration failed:", e.message);
  if (e.position) console.error("At position:", e.position);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
