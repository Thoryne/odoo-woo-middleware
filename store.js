import sqlite3 from "sqlite3";
import { open } from "sqlite";

let db;

export async function initDb() {
  db = await open({ filename: process.env.DB_PATH || "./data.sqlite", driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS processed_orders (
      woo_order_id TEXT PRIMARY KEY,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
