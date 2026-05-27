import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:vizualizeit.db";

let _db: Database | null = null;
// Promise cache — zapobiega race condition przy równoczesnych wywołaniach getDb()
// na świeżej instalacji, gdzie Database.load() uruchamia 16 migracji i zajmuje
// więcej czasu. Bez tego dwa równoczesne wywołania (np. loadProjects + loadSettings)
// mogły obie wejść w Database.load(), jeden wylatywał z błędem i _db zostawało null.
let _dbPromise: Promise<Database> | null = null;

/** Singleton połączenia SQLite. Pierwsze wywołanie inicjuje, kolejne reużywają instancji. */
export async function getDb(): Promise<Database> {
  if (_db) return _db;
  if (!_dbPromise) {
    _dbPromise = Database.load(DB_URL).then((db) => {
      _db = db;
      return db;
    }).catch((e) => {
      // Zresetuj promise żeby kolejne wywołanie mogło spróbować ponownie
      _dbPromise = null;
      throw e;
    });
  }
  return _dbPromise;
}
