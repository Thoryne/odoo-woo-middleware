import sqlite3 from "sqlite3";
import { promisify } from "node:util";

const DB_PATH = process.env.DB_PATH || "./data.sqlite";

let db;
let runAsync, getAsync, execAsync;

export async function initDb() {
  sqlite3.verbose();
  db = new sqlite3.Database(DB_PATH);

  // Promisify methods
  runAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  getAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  execAsync = promisify(db.exec).bind(db);

  await execAsync(`
    CREATE TABLE IF NOT EXISTS processed_orders (
      id INTEGER PRIMARY KEY,
      woo_order_id TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

export async function hasProcessedOrder(orderId) {
  const row = await getAsync(
    "SELECT 1 AS ok FROM processed_orders WHERE woo_order_id = ?",
    [String(orderId)]
  );
  return !!row;
}

export async function markOrderProcessed(orderId) {
  await runAsync(
    "INSERT OR IGNORE INTO processed_orders (woo_order_id) VALUES (?)",
    [String(orderId)]
  );
}
