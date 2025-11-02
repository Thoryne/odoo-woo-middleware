import { initDb } from "../store.js";

try {
  await initDb();
  console.log("DB ready");
  process.exit(0);
} catch (e) {
  console.error("DB migrate failed:", e);
  process.exit(1);
}
