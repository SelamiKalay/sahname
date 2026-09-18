/* ============================================================
   ŞAH — Yerel geliştirme sunucusu + yerel ağ oda rölesi
   ------------------------------------------------------------
   Çalıştır:  node server.js
   Aynı Wi-Fi ağındaki telefondan:  http://<bilgisayar-ip>:5173
   ============================================================ */
const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const ROOT = __dirname;
const PORT = 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml", ".png": "image/png",
  ".jpg":  "image/jpeg",    ".ico": "image/x-icon",
  ".woff2": "font/woff2",   ".webp": "image/webp"
};

/* ---------- Güvenlik ayarları ---------- */
const MAX_ODA        = 200;    // aynı anda açık kalabilecek oda sayısı
const MAX_OLAY       = 500;    // oda başına saklanan olay
const ISTEK_PENCERE  = 10_000; // hız sınırı penceresi (ms)
const ISTEK_LIMIT    = 60;     // pencere başına IP başına istek

/* Yalnızca uygulamanın çalışması için gereken dosyalar sunulur.
   server.js, test betikleri, .git gibi şeyler ASLA dışarı verilmez. */
const SERVILEBILIR = new Set([
  "/index.html", "/style.css", "/app.js", "/game.js", "/engine.js", "/p2p.js", "/native.js",
  "/manifest.webmanifest"
]);
const SERVILEBILIR_KLASOR = ["/assets/", "/vendor/"];
const SERVILEBILIR_UZANTI = new Set([".png", ".svg", ".jpg", ".jpeg", ".webp", ".ico", ".webmanifest",
                                     ".js", ".css", ".woff2"]);

/* ---------- Hız sınırı (IP başına) ---------- */
const istekSayaci = new Map();  // ip -> {adet, sifirla}
function hizAsildiMi(ip) {
  const now = Date.now();
  let k = istekSayaci.get(ip);
  if (!k || now > k.sifirla) { k = { adet: 0, sifirla: now + ISTEK_PENCERE }; istekSayaci.set(ip, k); }
  k.adet++;
  return k.adet > ISTEK_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, k] of istekSayaci) if (now > k.sifirla) istekSayaci.delete(ip);
}, 30_000).unref();

/* ---------- Oda deposu (bellekte) ---------- */
const rooms = new Map();   // code -> { players:Map(id->token), events, seq, touched }
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const jeton = () => require("crypto").randomBytes(16).toString("hex");

function makeCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(""); }
  while (rooms.has(code));
  return code;
}

// 30 dakika dokunulmayan odaları temizle
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (now - r.touched > 30 * 60e3) rooms.delete(code);
}, 60e3).unref();

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req, limit = 1e6) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
  });
}

/* ---------- Girdi temizleme ve yetki ---------- */
const temizKod = v => { const s = String(v ?? "").toUpperCase(); return /^[A-Z0-9]{4}$/.test(s) ? s : null; };
const temizId  = v => { const s = String(v ?? ""); return /^[A-Za-z0-9_-]{4,40}$/.test(s) ? s : null; };

/** Oda + oyuncu + jeton üçlüsünü doğrular. Jetonsuz kimse odaya erişemez. */
function yetkiliOda(code, playerId, token) {
  const kod = temizKod(code), pid = temizId(playerId), tok = String(token ?? "");
  if (!kod || !pid || !tok) return { ok: false, kod: 400, error: "Geçersiz istek" };
  const oda = rooms.get(kod);
  if (!oda) return { ok: false, kod: 404, error: "Oda bulunamadı" };
  if (oda.players.get(pid) !== tok) return { ok: false, kod: 403, error: "Yetkisiz" };
  return { ok: true, oda };
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === "/api/ping") return json(res, 200, { ok: true });

  if (route === "/api/room/create" && req.method === "POST") {
    if (rooms.size >= MAX_ODA) return json(res, 503, { ok: false, error: "Sunucu dolu, biraz sonra dene" });
    const code = makeCode();
    const { playerId } = await readBody(req);
    const pid = temizId(playerId);
    if (!pid) return json(res, 400, { ok: false, error: "Geçersiz oyuncu" });
    const tok = jeton();
    rooms.set(code, { players: new Map([[pid, tok]]), events: [], seq: 0, touched: Date.now() });
    return json(res, 200, { ok: true, code, token: tok });
  }

  if (route === "/api/room/join" && req.method === "POST") {
    const { code, playerId } = await readBody(req);
    const pid = temizId(playerId);
    const kod = temizKod(code);
    if (!pid || !kod) return json(res, 400, { ok: false, error: "Geçersiz istek" });
    const room = rooms.get(kod);
    if (!room) return json(res, 404, { ok: false, error: "Oda bulunamadı" });
    if (room.players.size >= 2 && !room.players.has(pid))
      return json(res, 409, { ok: false, error: "Oda dolu" });
    const tok = room.players.get(pid) || jeton();
    room.players.set(pid, tok);
    room.touched = Date.now();
    return json(res, 200, { ok: true, players: room.players.size, token: tok });
  }

  if (route === "/api/room/send" && req.method === "POST") {
    const { code, playerId, token, data } = await readBody(req);
    const room = yetkiliOda(code, playerId, token);
    if (!room.ok) return json(res, room.kod, { ok: false, error: room.error });
    const r = room.oda;
    r.seq++;
    r.events.push({ seq: r.seq, from: temizId(playerId), data });
    if (r.events.length > MAX_OLAY) r.events.splice(0, r.events.length - MAX_OLAY);
    r.touched = Date.now();
    return json(res, 200, { ok: true, seq: r.seq });
  }

  if (route === "/api/room/state") {
    const code = url.searchParams.get("code");
    const playerId = url.searchParams.get("playerId");
    const token = url.searchParams.get("token");
    const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);
    const room = yetkiliOda(code, playerId, token);
    if (!room.ok) return json(res, room.kod, { ok: false, error: room.error });
    const r = room.oda;
    r.touched = Date.now();
    const pid = temizId(playerId);
    const events = r.events.filter(e => e.seq > since && e.from !== pid);
    return json(res, 200, { ok: true, players: r.players.size, events });
  }

  return json(res, 404, { ok: false, error: "Bilinmeyen uç nokta" });
}

/* ---------- Sunucu ---------- */
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const ip = req.socket.remoteAddress || "?";

  if (url.pathname.startsWith("/api/")) {
    // Kaba kuvvet ve istek seli koruması
    if (hizAsildiMi(ip)) return json(res, 429, { ok: false, error: "Çok fazla istek, biraz bekle" });
    try { return await handleApi(req, res, url); }
    catch (err) { console.warn("[API] Hata:", err); return json(res, 500, { ok: false, error: "Sunucu hatası" }); }
  }

  // Tarayıcı simgeyi <link rel="icon"> veri-URI'sinden alır;
  // yine de /favicon.ico yokladığı için sessizce boş yanıt veriyoruz.
  if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }

  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  p = p.replace(/\\/g, "/");

  // BEYAZ LİSTE: yalnızca uygulamanın ihtiyaç duyduğu dosyalar sunulur.
  // Böylece server.js, test betikleri, .git vb. yerel ağa sızmaz.
  const klasordeMi = SERVILEBILIR_KLASOR.some(k => p.startsWith(k)) &&
                     SERVILEBILIR_UZANTI.has(path.extname(p).toLowerCase()) &&
                     !p.includes("..");
  if (!SERVILEBILIR.has(p) && !klasordeMi) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Bulunamadı");
  }

  const filePath = path.join(ROOT, p);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Bulunamadı"); }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    res.end(data);
  });
}).listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
  console.log("\n  ŞAH — sunucu çalışıyor\n");
  console.log("  Bu bilgisayar :  http://localhost:" + PORT);
  ips.forEach(ip => console.log("  Aynı Wi-Fi    :  http://" + ip + ":" + PORT));
  console.log("");
});
