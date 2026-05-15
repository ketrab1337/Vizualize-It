import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:vizualizeit.db";

let _db: Database | null = null;

/** Singleton połączenia SQLite. Pierwsze wywołanie inicjuje, kolejne reużywają instancji. */
export async function getDb(): Promise<Database> {
  if (!_db) _db = await Database.load(DB_URL);
  return _db;
}
