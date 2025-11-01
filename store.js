import sqlite from "sqlite";
import sqlite3 from "sqlite3"; // si tu utilises l’API sqlite3/opensqlite

const DB_PATH = process.env.DB_PATH || "./data.sqlite";

let db;
export async function initDb() {
  db = await sqlite.open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS processed_orders (
      id INTEGER PRIMARY KEY,
      woo_order_id TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}
export async function hasProcessedOrder(orderId) {
  const row = await db.get("SELECT 1 FROM processed_orders WHERE woo_order_id = ?", [String(orderId)]);
  return !!row;
}
export async function markOrderProcessed(orderId) {
  await db.run("INSERT OR IGNORE INTO processed_orders (woo_order_id) VALUES (?)", [String(orderId)]);
}
