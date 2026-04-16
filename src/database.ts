import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "ekw_data.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS registers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prefix TEXT NOT NULL,
    number TEXT NOT NULL,
    check_digit INTEGER NOT NULL,
    full_number TEXT UNIQUE NOT NULL,
    content TEXT,
    parsed_data TEXT,
    status TEXT DEFAULT 'pending',
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scraper_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS batch_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prefix TEXT NOT NULL,
    number TEXT NOT NULL,
    check_digit INTEGER NOT NULL,
    full_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'range',
    last_error TEXT,
    locked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;

export type QueueStatus = "pending" | "in_progress" | "success" | "error";

export type SaveRegisterInput = {
  prefix: string;
  number: string;
  checkDigit: number;
  content?: string;
  parsedData?: any;
  status?: string;
};

export const saveRegister = (data: SaveRegisterInput) => {
  const fullNumber = `${data.prefix}/${data.number}/${data.checkDigit}`;
  const stmt = db.prepare(`
    INSERT INTO registers (prefix, number, check_digit, full_number, content, parsed_data, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(full_number) DO UPDATE SET
      content = excluded.content,
      parsed_data = excluded.parsed_data,
      status = excluded.status,
      last_updated = CURRENT_TIMESTAMP
  `);

  return stmt.run(
    data.prefix,
    data.number,
    data.checkDigit,
    fullNumber,
    data.content || null,
    data.parsedData ? JSON.stringify(data.parsedData) : null,
    data.status || "pending",
  );
};

export const getRegisters = () => {
  return db.prepare("SELECT * FROM registers ORDER BY last_updated DESC").all();
};

export const getRegisterByNumber = (fullNumber: string) => {
  return db.prepare("SELECT * FROM registers WHERE full_number = ?").get(fullNumber);
};

export const enqueueRegisters = (items: Array<{ prefix: string; number: string; checkDigit: number; source?: string }>) => {
  const stmt = db.prepare(`
    INSERT INTO batch_queue (prefix, number, check_digit, full_number, status, source)
    VALUES (?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(full_number) DO NOTHING
  `);

  const transaction = db.transaction((entries: typeof items) => {
    let inserted = 0;
    for (const entry of entries) {
      const fullNumber = `${entry.prefix}/${entry.number}/${entry.checkDigit}`;
      const result = stmt.run(entry.prefix, entry.number, entry.checkDigit, fullNumber, entry.source || "range");
      inserted += Number(result.changes);
    }
    return inserted;
  });

  return transaction(items);
};

export const getBatchQueue = () => {
  return db.prepare("SELECT * FROM batch_queue ORDER BY id ASC").all();
};

export const getBatchStats = () => {
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error
      FROM batch_queue
    `)
    .get() as Record<string, number | null>;

  return {
    total: row.total ?? 0,
    pending: row.pending ?? 0,
    in_progress: row.in_progress ?? 0,
    success: row.success ?? 0,
    error: row.error ?? 0,
  };
};

export const getNextQueueItem = () => {
  const markInProgress = db.prepare(`
    UPDATE batch_queue
    SET status = 'in_progress', locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT id
      FROM batch_queue
      WHERE status IN ('pending', 'error')
      ORDER BY
        CASE status WHEN 'pending' THEN 0 ELSE 1 END,
        id ASC
      LIMIT 1
    )
    RETURNING *
  `);

  return markInProgress.get();
};

export const getQueueItemByFullNumber = (fullNumber: string) => {
  return db.prepare("SELECT * FROM batch_queue WHERE full_number = ?").get(fullNumber);
};

export const updateQueueStatus = (fullNumber: string, status: QueueStatus, lastError?: string | null) => {
  return db
    .prepare(`
      UPDATE batch_queue
      SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE full_number = ?
    `)
    .run(status, lastError ?? null, fullNumber);
};

export const resetQueueItem = (fullNumber: string) => {
  return db
    .prepare(`
      UPDATE batch_queue
      SET status = 'pending', last_error = NULL, locked_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE full_number = ?
    `)
    .run(fullNumber);
};
