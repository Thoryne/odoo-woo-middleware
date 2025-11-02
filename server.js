import { odooExecuteKw } from "./odoo.js";
import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import rawBody from "raw-body";
import cron from "node-cron";
import pino from "pino";
import { initDb, hasProcessedOrder, markOrderProcessed } from "./store.js";
import { findOrCreatePartner, ensureProductBySku, createSaleOrderWithLines, fetchOdooStockPriceSnapshot } from "./odoo.js";
import { wooUpdateProductStockPrice } from "./woo.js";

dotenv.config();
const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

app.use((req, res, next) => {
  if (req.method === "POST" && req.headers["content-type"]?.includes("application/json")) {
    rawBody(req, { encoding: true }, (err, string) => {
      if (err) return next(err);
      req.rawBody = string;
      try { req.body = JSON.parse(string); } catch { return res.status(400).send("Invalid JSON"); }
      next();
    });
  } else { next(); }
});

app.get("/healthz", (_, res) => res.send("ok"));

function verifyWooSignature(req) {
  const secret = process.env.WOO_WEBHOOK_SECRET || "";
  const signature = req.headers["x-wc-webhook-signature"] || "";

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(req.rawBody || "");
  const digest = hmac.digest("base64");

  // DEBUG temporaire
  console.log("[HMAC] secret=", JSON.stringify(secret));
  console.log("[HMAC] header signature=", signature);
  console.log("[HMAC] computed digest =", digest);

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

app.post("/webhooks/woocommerce/order-created", async (req, res) => {
  console.log("HEADERS IN:", JSON.stringify(req.headers, null, 2));

  // Laisse passer les pings non signés en x-www-form-urlencoded (optionnel)
  if (
    !req.headers["x-wc-webhook-signature"] &&
    (req.headers["content-type"] || "").includes("application/x-www-form-urlencoded")
  ) {
    console.log("Woo ping/test non signé → 200");
    return res.status(200).send("ok");
  }

  if (!verifyWooSignature(req)) return res.status(401).send("Bad signature");

  const order = req.body;

  try {
    if (await hasProcessedOrder(order.id)) return res.status(200).send("ok");

    const partnerId = await findOrCreatePartner(order);
    const lines = [];
    for (const item of order.line_items || []) {
      const sku = item.sku || "";
      const qty = Number(item.quantity || 1);
      const priceUnit = Number(item.price || item.total / Math.max(qty,1));
      const productId = await ensureProductBySku(sku, item);
      if (!productId) continue;
      lines.push({ product_id: productId, qty, price_unit: priceUnit });
    }
    await createSaleOrderWithLines({
      partnerId,
      clientOrderRef: order.number || String(order.id),
      wooOrderId: String(order.id),
      lines
    });
    await markOrderProcessed(order.id);
    return res.status(200).send("ok");
  } catch (e) {
    // ⇩⇩⇩ LOG DÉTAILLÉ ⇩⇩⇩
    console.error("ORDER_WEBHOOK_FAIL >>>");
    console.error("Message:", e?.message);
    if (e?.response) {
      console.error("Odoo HTTP", e.response.status, e.response.statusText);
      console.error("Odoo body:", JSON.stringify(e.response.data, null, 2));
    } else {
      console.error("Stack:", e?.stack);
    }
    // ⇧⇧⇧ LOG DÉTAILLÉ ⇧⇧⇧
    return res.status(500).send("error");
  }
});

	
app.post("/webhooks/woocommerce/order-updated", async (req, res) => {
  if (!verifyWooSignature(req)) return res.status(401).send("Bad signature");
  res.status(200).send("ok");
});

if (process.env.CRON_STOCK_PRICE) {
  cron.schedule(process.env.CRON_STOCK_PRICE, async () => {
    try {
      const snapshot = await fetchOdooStockPriceSnapshot();
      for (const row of snapshot) await wooUpdateProductStockPrice(row);
    } catch (e) {
      logger.error({ err: e?.response?.data || e.message }, "Cron failed");
    }
  });
}

// --- DEBUG: voir ce que lit l'app depuis .env (clé masquée)
app.get("/debug/env", (req, res) => {
  const mask = (s) => (s ? s[0] + "***" + s.slice(-3) : "");
  res.json({
    ODOO_URL: process.env.ODOO_URL || "",
    ODOO_DB: process.env.ODOO_DB || "",
    ODOO_LOGIN: process.env.ODOO_LOGIN || "",
    ODOO_API_KEY: mask(process.env.ODOO_API_KEY || "")
  });
});

// --- DEBUG: tester l'auth Odoo sans passer par Woo
import axios from "axios"; // assure-toi d'avoir cet import en haut du fichier

app.get("/debug/odoo-auth", async (req, res) => {
  try {
    const base = (process.env.ODOO_URL || "").replace(/\/+$/, "");
    if (!base) {
      return res.status(400).json({ ok: false, err: "Missing ODOO_URL" });
    }
    const url = `${base}/web/session/authenticate`;
    const body = {
      jsonrpc: "2.0",
      method: "call",
      params: {
        db: process.env.ODOO_DB || "",
        login: process.env.ODOO_LOGIN || "",
        // IMPORTANT : ici on teste directement avec la clé API comme "password"
        password: process.env.ODOO_API_KEY || ""
      },
      id: 1
    };
    const r = await axios.post(url, body, { headers: { "Content-Type": "application/json" } });
    const ok = !!r.data?.result?.uid;
    return res.status(ok ? 200 : 500).json({ ok, raw: r.data });
  } catch (e) {
    const err = e?.response?.data || e?.message || "unknown";
    console.error("ODOO_AUTH_FAIL >>>", err);
    return res.status(500).json({ ok: false, err });
  }
});


const PORT = process.env.PORT || 3000;
initDb().then(() => app.listen(PORT, () => console.log(`Listening on :${PORT}`)));
