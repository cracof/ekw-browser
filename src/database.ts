import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "ekw_data.db");
const db = new Database(dbPath);

// Initialize database
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
`);

export default db;

export const saveRegister = (data: {
  prefix: string;
  number: string;
  checkDigit: number;
  content?: string;
  parsedData?: any;
  status?: string;
}) => {
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
    data.status || 'pending'
  );
};

export const getRegisters = () => {
  return db.prepare("SELECT * FROM registers ORDER BY last_updated DESC").all();
};

export const getRegisterByNumber = (fullNumber: string) => {
  return db.prepare("SELECT * FROM registers WHERE full_number = ?").get(fullNumber);
};
