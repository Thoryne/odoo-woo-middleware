import axios from "axios";

const WOO_URL = (process.env.WOO_URL || "").replace(/\/+$/, "");
const CK = process.env.WOO_CONSUMER_KEY || "";
const CS = process.env.WOO_CONSUMER_SECRET || "";

function wc(path) {
  const url = `${WOO_URL}/wp-json/wc/v3${path}`;
  return axios.create({ baseURL: url, auth: { username: CK, password: CS }, timeout: 30000 });
}

export async function wooUpdateProductStockPrice({ sku, stock, price }) {
  if (!sku) return;
  const { data: prods } = await wc(`/products`).get("", { params: { sku } });
  if (!Array.isArray(prods) || !prods.length) return;
  const prod = prods[0];
  const payload = { manage_stock: true, stock_quantity: Number(stock), regular_price: String(price), status: "publish" };
  await wc(`/products/${prod.id}`).put("", payload);
}
