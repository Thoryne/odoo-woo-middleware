import axios from "axios";

const ODOO_URL   = (process.env.ODOO_URL   || "").replace(/\/+$/, "");
const ODOO_DB    = (process.env.ODOO_DB    || "");
const ODOO_LOGIN = (process.env.ODOO_LOGIN || "");
const ODOO_API_KEY = (process.env.ODOO_API_KEY || "");

let ODOO_UID = null;

async function odooJsonRpc(route, payload) {
  const url = `${ODOO_URL}${route}`;
  const { data } = await axios.post(url, payload, { timeout: 30000 });
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

async function odooAuthenticate() {
  if (ODOO_UID) return ODOO_UID;
  const payload = { jsonrpc: "2.0", method: "call", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY }, id: 1 };
  const result = await odooJsonRpc("/web/session/authenticate", payload);
  ODOO_UID = result.uid;
  return ODOO_UID;
}

export async function odooExecuteKw(model, method, args = [], kwargs = {}) {
  const uid = await odooAuthenticate();
  const payload = { jsonrpc: "2.0", method: "call", params: { service: "object", method: "execute_kw", args: [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs] }, id: Date.now() };
  return odooJsonRpc("/jsonrpc", payload);
}

export async function findOrCreatePartner(order) {
  const email = order.billing?.email || order.customer?.email || "";
  const name = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(" ") || order.billing?.company || email || "Woo Customer";
  const partners = await odooExecuteKw("res.partner", "search_read", [[["email","=",email]], ["id"]], { limit: 1 });
  if (partners.length) return partners[0].id;
  const vals = { name, email, phone: order.billing?.phone || null, street: order.billing?.address_1 || null, street2: order.billing?.address_2 || null, city: order.billing?.city || null, zip: order.billing?.postcode || null, customer_rank: 1 };
  return await odooExecuteKw("res.partner", "create", [vals]);
}

export async function ensureProductBySku(sku, item) {
  if (!sku) return null;
  const found = await odooExecuteKw("product.product", "search_read", [[["default_code","=",sku]], ["id"]], { limit: 1 });
  if (found.length) return found[0].id;
  const tmplId = await odooExecuteKw("product.template", "create", [{ name: item.name || sku, default_code: sku, list_price: Number(item.price || 0), type: "product" }]);
  const variants = await odooExecuteKw("product.product", "search_read", [[["product_tmpl_id","=",tmplId]], ["id"]], { limit: 1 });
  return variants.length ? variants[0].id : null;
}

export async function createSaleOrderWithLines({ partnerId, clientOrderRef, wooOrderId, lines }) {
  const orderId = await odooExecuteKw("sale.order", "create", [{ partner_id: partnerId, client_order_ref: clientOrderRef }]);
  for (const l of lines) {
    await odooExecuteKw("sale.order.line", "create", [{ order_id: orderId, product_id: l.product_id, product_uom_qty: l.qty, price_unit: l.price_unit, tax_id: [], name: "From Woo" }]);
  }
  return orderId;
}

export async function fetchOdooStockPriceSnapshot() {
  const products = await odooExecuteKw("product.product", "search_read", [[["default_code","!=",false]]], ["default_code","qty_available","lst_price"], { limit: 200 });
  return products.map(p => ({ sku: p.default_code, stock: Math.max(0, Math.floor(p.qty_available || 0)), price: Number(p.lst_price || 0) }));
}
