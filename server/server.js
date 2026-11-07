"use strict";

/**
 * Server minimal untuk Toko Kue Manis Senja.
 * - Menyajikan website statis (HTML/CSS/JS).
 * - Membuat transaksi Midtrans Snap dari sisi server (Server Key tidak pernah dikirim ke browser).
 * - Menerima dan memverifikasi notifikasi pembayaran Midtrans.
 * - Menyimpan pesan formulir kontak ke server/data/messages.jsonl.
 *
 * Hanya memakai modul bawaan Node.js (tanpa dependensi eksternal).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.jsonl");

const PRODUCTS = require(path.join(ROOT, "data", "products.js"));
const productById = new Map(PRODUCTS.map((product) => [product.id, product]));

loadDotEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";
const SERVER_KEY = (process.env.MIDTRANS_SERVER_KEY || "").trim();
const CLIENT_KEY = (process.env.MIDTRANS_CLIENT_KEY || "").trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
const MIDTRANS_CONFIGURED =
  isUsableKey(SERVER_KEY) && isUsableKey(CLIENT_KEY);
const SNAP_SCRIPT_URL = IS_PRODUCTION
  ? "https://app.midtrans.com/snap/snap.js"
  : "https://app.sandbox.midtrans.com/snap/snap.js";
const MIDTRANS_API_BASE = IS_PRODUCTION
  ? "https://api.midtrans.com"
  : "https://api.sandbox.midtrans.com";

const MAX_BODY_BYTES = 100 * 1024;
const MAX_LINES = 50;
const MAX_QTY = 99;

const orders = new Map();
let ordersSaveChain = Promise.resolve();
const rateBuckets = new Map();

/* ------------------------------- Bootstrap -------------------------------- */

fs.mkdirSync(DATA_DIR, { recursive: true });
loadOrders();

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    if (req.url && req.url.startsWith("/api/")) {
      console.log(
        `${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - startedAt} ms)`
      );
    }
  });

  route(req, res).catch((error) => {
    console.error("Unhandled request error:", error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Terjadi kesalahan pada server." });
    } else {
      res.end();
    }
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} sudah dipakai. Hentikan proses lain atau jalankan dengan PORT lain.`
    );
  } else {
    console.error("Server error:", error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Toko Kue Manis Senja");
  console.log(`  Website : http://${HOST}:${PORT}`);
  console.log(
    `  Mode    : ${
      MIDTRANS_CONFIGURED
        ? `Midtrans ${IS_PRODUCTION ? "PRODUCTION" : "Sandbox"}`
        : "DEMO (belum memproses pembayaran sungguhan)"
    }`
  );
  console.log(`  Server Key di .env: ${MIDTRANS_CONFIGURED ? "terisi" : "belum diisi"}`);
  console.log("");
});

/* --------------------------------- Routing -------------------------------- */

async function route(req, res) {
  setSecurityHeaders(res);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/api/config" && req.method === "GET") {
    return sendJson(res, 200, {
      midtransConfigured: MIDTRANS_CONFIGURED,
      demoMode: !MIDTRANS_CONFIGURED,
      clientKey: MIDTRANS_CONFIGURED ? CLIENT_KEY : "",
      snapScriptUrl: SNAP_SCRIPT_URL,
      environment: IS_PRODUCTION ? "production" : "sandbox"
    });
  }

  if (pathname === "/api/checkout" && req.method === "POST") {
    return handleCheckout(req, res);
  }

  if (pathname === "/api/midtrans/notification" && req.method === "POST") {
    return handleNotification(req, res);
  }

  if (pathname === "/api/contact" && req.method === "POST") {
    return handleContact(req, res);
  }

  if (pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "Endpoint tidak ditemukan." });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end("Metode tidak diizinkan.");
  }

  return serveStatic(req, res, pathname);
}

/* ------------------------------- Checkout --------------------------------- */

async function handleCheckout(req, res) {
  if (!takeRateLimit(clientIp(req), "checkout", 20)) {
    return sendJson(res, 429, { error: "Terlalu banyak percobaan. Coba lagi sebentar." });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  const validation = validateCheckout(body);
  if (!validation.ok) {
    return sendJson(res, 400, { error: validation.error });
  }

  const { customer, note, items } = validation.value;
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const orderId = createOrderId();

  const order = {
    orderId,
    total,
    status: MIDTRANS_CONFIGURED ? "pending" : "demo",
    demo: !MIDTRANS_CONFIGURED,
    customer,
    note,
    items,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  orders.set(orderId, order);
  await persistOrders();

  if (!MIDTRANS_CONFIGURED) {
    return sendJson(res, 200, {
      demo: true,
      orderId,
      total,
      status: "demo",
      message: "DEMO — belum memproses pembayaran sungguhan."
    });
  }

  try {
    const transaction = await createSnapTransaction(order);
    order.snapToken = transaction.token;
    order.updatedAt = new Date().toISOString();
    await persistOrders();

    return sendJson(res, 200, {
      demo: false,
      orderId,
      total,
      token: transaction.token,
      redirectUrl: transaction.redirect_url,
      clientKey: CLIENT_KEY,
      snapScriptUrl: SNAP_SCRIPT_URL
    });
  } catch (error) {
    order.status = "failed";
    order.updatedAt = new Date().toISOString();
    await persistOrders();
    console.error("Gagal membuat transaksi Midtrans:", error.message);
    return sendJson(res, 502, {
      error:
        "Gagal membuat transaksi Midtrans. Periksa Server Key, Client Key, dan koneksi internet."
    });
  }
}

function validateCheckout(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body permintaan tidak valid." };
  }

  const customer = body.customer || {};
  const name = typeof customer.name === "string" ? customer.name.trim() : "";
  const email = typeof customer.email === "string" ? customer.email.trim() : "";
  const phone = typeof customer.phone === "string" ? customer.phone.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";

  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Nama pemesan tidak valid." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return { ok: false, error: "Email pemesan tidak valid." };
  }
  if (!/^[0-9+\-\s()]{8,20}$/.test(phone)) {
    return { ok: false, error: "Nomor telepon tidak valid." };
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_LINES) {
    return { ok: false, error: "Daftar pesanan tidak valid." };
  }

  const seen = new Set();
  const items = [];

  for (const entry of body.items) {
    if (!entry || typeof entry.id !== "string") {
      return { ok: false, error: "Item pesanan tidak valid." };
    }
    if (seen.has(entry.id)) {
      return { ok: false, error: "Item pesanan duplikat." };
    }
    seen.add(entry.id);

    const product = productById.get(entry.id);
    if (!product) {
      return { ok: false, error: `Produk "${entry.id}" tidak ditemukan.` };
    }

    const qty = Number(entry.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok: false, error: `Jumlah untuk "${product.name}" harus 1–${MAX_QTY}.` };
    }

    items.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty
    });
  }

  return { ok: true, value: { customer: { name, email, phone }, note, items } };
}

async function createSnapTransaction(order) {
  const payload = {
    transaction_details: {
      order_id: order.orderId,
      gross_amount: order.total
    },
    item_details: order.items.map((item) => ({
      id: item.id.slice(0, 50),
      price: item.price,
      quantity: item.qty,
      name: item.name.slice(0, 50)
    })),
    customer_details: {
      first_name: order.customer.name.slice(0, 50),
      email: order.customer.email,
      phone: order.customer.phone
    }
  };

  if (PUBLIC_BASE_URL) {
    payload.callbacks = { finish: `${PUBLIC_BASE_URL}/#menu` };
  }

  const authorization =
    "Basic " + Buffer.from(`${SERVER_KEY}:`, "utf8").toString("base64");

  const response = await fetch(`${MIDTRANS_API_BASE}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error("Respons Midtrans bukan JSON yang valid.");
  }

  if (!response.ok) {
    const messages = Array.isArray(data.error_messages)
      ? data.error_messages.join("; ")
      : "tanpa detail";
    throw new Error(`Midtrans ${response.status}: ${messages}`);
  }

  if (!data.token) {
    throw new Error("Midtrans tidak mengembalikan token Snap.");
  }

  return data;
}

/* ------------------------------ Notification ------------------------------ */

async function handleNotification(req, res) {
  if (!MIDTRANS_CONFIGURED) {
    return sendJson(res, 503, {
      error: "MIDTRANS_SERVER_KEY belum dikonfigurasi; notifikasi tidak dapat diverifikasi."
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const statusCode = typeof body.status_code === "string" ? body.status_code : "";
  const grossAmount = typeof body.gross_amount === "string" ? body.gross_amount : "";
  const signature = typeof body.signature_key === "string" ? body.signature_key : "";
  const transactionStatus =
    typeof body.transaction_status === "string" ? body.transaction_status : "";

  if (!orderId || !statusCode || !grossAmount || !signature || !transactionStatus) {
    return sendJson(res, 400, { error: "Payload notifikasi tidak lengkap." });
  }

  const expected = crypto
    .createHash("sha512")
    .update(orderId + statusCode + grossAmount + SERVER_KEY)
    .digest("hex");

  if (!safeEqualHex(expected, signature)) {
    console.warn(`Notifikasi dengan signature tidak valid untuk order ${orderId}.`);
    return sendJson(res, 401, { error: "Signature notifikasi tidak valid." });
  }

  const order = orders.get(orderId);
  if (!order) {
    console.warn(`Notifikasi untuk order tidak dikenal: ${orderId}.`);
    return sendJson(res, 404, { error: "Order tidak ditemukan." });
  }

  if (order.demo) {
    console.warn(`Notifikasi Midtrans diterima untuk order demo ${orderId}; diabaikan.`);
    return sendJson(res, 400, { error: "Order demo tidak memiliki transaksi Midtrans." });
  }

  const notifiedAmount = Number(grossAmount);
  if (!Number.isFinite(notifiedAmount) || notifiedAmount !== order.total) {
    console.warn(`Nominal notifikasi tidak cocok untuk order ${orderId}.`);
    return sendJson(res, 400, { error: "Nominal notifikasi tidak cocok dengan pesanan." });
  }

  order.status = transactionStatus;
  order.paid =
    transactionStatus === "settlement" ||
    (transactionStatus === "capture" && body.fraud_status === "accept");
  order.paymentType = typeof body.payment_type === "string" ? body.payment_type : null;
  order.transactionId =
    typeof body.transaction_id === "string" ? body.transaction_id : null;
  order.fraudStatus = typeof body.fraud_status === "string" ? body.fraud_status : null;
  order.updatedAt = new Date().toISOString();
  order.notifiedAt = new Date().toISOString();

  await persistOrders();
  console.log(
    `Notifikasi terverifikasi: ${orderId} -> ${order.status}` +
      (order.paid ? " (lunas)" : "")
  );

  return sendJson(res, 200, { ok: true });
}

/* --------------------------------- Kontak --------------------------------- */

async function handleContact(req, res) {
  if (!takeRateLimit(clientIp(req), "contact", 10)) {
    return sendJson(res, 429, { error: "Terlalu banyak pesan. Coba lagi sebentar." });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (name.length < 2 || name.length > 80) {
    return sendJson(res, 400, { error: "Nama minimal 2 karakter." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return sendJson(res, 400, { error: "Email tidak valid." });
  }
  if (message.length < 5 || message.length > 1000) {
    return sendJson(res, 400, { error: "Pesan harus 5–1000 karakter." });
  }

  const record = {
    receivedAt: new Date().toISOString(),
    name,
    email,
    message
  };

  try {
    await fs.promises.appendFile(MESSAGES_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch (error) {
    console.error("Gagal menyimpan pesan kontak:", error.message);
    return sendJson(res, 500, { error: "Pesan gagal disimpan di server." });
  }

  console.log(`Pesan kontak baru dari ${name} <${email}>.`);
  return sendJson(res, 200, { ok: true });
}

/* ------------------------------ Static files ------------------------------ */

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    return sendText(res, 400, "Permintaan tidak valid.");
  }

  if (decoded.includes("\0")) {
    return sendText(res, 400, "Permintaan tidak valid.");
  }

  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const allowed =
    relative === "index.html" ||
    relative.startsWith("assets/") ||
    relative.startsWith("data/");

  if (!allowed || relative.split("/").includes("..")) {
    return sendText(res, 404, "Halaman tidak ditemukan.");
  }

  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT + path.sep)) {
    return sendText(res, 403, "Akses ditolak.");
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    return sendText(res, 404, "Halaman tidak ditemukan.");
  }

  if (!stat.isFile()) {
    return sendText(res, 404, "Halaman tidak ditemukan.");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const isHtml = ext === ".html";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=3600"
  });

  if (req.method === "HEAD") {
    return res.end();
  }

  fs.createReadStream(filePath)
    .on("error", (error) => {
      console.error("Gagal membaca file statis:", error.message);
      res.destroy();
    })
    .pipe(res);
}

/* --------------------------------- Helpers -------------------------------- */

function loadDotEnv(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return;
  }

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

function isUsableKey(value) {
  if (!value) return false;
  return !/^(isi_|ganti_|your_|xxx|placeholder)/i.test(value);
}

function loadOrders() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach((order) => {
        if (order && typeof order.orderId === "string") {
          orders.set(order.orderId, order);
        }
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Tidak dapat memuat orders.json:", error.message);
    }
  }
}

function persistOrders() {
  const snapshot = JSON.stringify(Array.from(orders.values()), null, 2);

  ordersSaveChain = ordersSaveChain
    .then(async () => {
      const tempFile = `${ORDERS_FILE}.tmp`;
      await fs.promises.writeFile(tempFile, snapshot, "utf8");
      await fs.promises.rename(tempFile, ORDERS_FILE);
    })
    .catch((error) => {
      console.error("Gagal menyimpan orders.json:", error.message);
    });

  return ordersSaveChain;
}

function createOrderId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `KS-${stamp}-${random}`;
}

function safeEqualHex(expected, actual) {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(actual, "utf8"));
}

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function takeRateLimit(key, route, limitPerMinute) {
  const bucketKey = `${route}:${key}`;
  const now = Date.now();
  const bucket = rateBuckets.get(bucketKey);

  if (!bucket || now - bucket.startedAt > 60_000) {
    rateBuckets.set(bucketKey, { startedAt: now, count: 1 });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limitPerMinute;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    const fail = (statusCode, message) => {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    };

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(413, "Body permintaan terlalu besar.");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        const parseError = new Error("Body harus berupa JSON yang valid.");
        parseError.statusCode = 400;
        reject(parseError);
      }
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(message)
  });
  res.end(message);
}
