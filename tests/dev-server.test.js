/* Geliştirme sunucusu duman testi — yalnızca Node yerleşikleri.
   Çalıştır: node --test tests/   (veya: npm test) */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
let sunucu;

test.before(async () => {
  sunucu = spawn(process.execPath, [path.join(__dirname, "..", "tools", "dev-server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  // Sunucu ayağa kalkana kadar /api/ping yoklanır (en fazla ~5 sn)
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + "/api/ping")).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("sunucu açılmadı");
});

test.after(() => sunucu.kill());

const get = p => fetch(BASE + p);
const post = (p, body) => fetch(BASE + p, { method: "POST", body: JSON.stringify(body) });

test("uygulama dosyaları doğru türle sunulur", async () => {
  for (const [yol, tur] of [
    ["/", "text/html"], ["/index.html", "text/html"], ["/app.js", "application/javascript"],
    ["/style.css", "text/css"], ["/vendor/chess.min.js", "application/javascript"],
    ["/vendor/webfonts/fa-solid-900.woff2", "font/woff2"],
  ]) {
    const r = await get(yol);
    assert.equal(r.status, 200, yol);
    assert.ok(r.headers.get("content-type").startsWith(tur), `${yol}: ${r.headers.get("content-type")}`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    await r.arrayBuffer();
  }
});

test("beyaz liste dışındaki dosyalar ve dizin aşma denemeleri 404", async () => {
  for (const yol of [
    "/tools/dev-server.js", "/package.json", "/build.js", "/.git/config", "/README.md",
    "/android/app/build.gradle", "/vendor/../package.json", "/vendor/%2e%2e/package.json",
    "/assets/%2e%2e/tools/dev-server.js", "/vendor/..%2fbuild.js", "/vendor/%5c..%5cbuild.js",
  ]) {
    const r = await get(yol);
    assert.equal(r.status, 404, yol);
    await r.arrayBuffer();
  }
});

test("bozuk yüzde kodlaması 400 döner, sunucu çalışmaya devam eder", async () => {
  let r = await get("/%E0%A4%A");
  assert.equal(r.status, 400); await r.arrayBuffer();
  r = await get("/index.html");
  assert.equal(r.status, 200); await r.arrayBuffer();
});

test("oda akışı: oluştur, katıl, mesaj gönder, al", async () => {
  const a = await (await post("/api/room/create", { playerId: "oyuncuA" })).json();
  assert.ok(a.ok && /^[A-Z0-9]{4}$/.test(a.code) && a.token, JSON.stringify(a));

  const b = await (await post("/api/room/join", { code: a.code.toLowerCase(), playerId: "oyuncuB" })).json();
  assert.equal(b.ok, true);
  assert.equal(b.players, 2);

  const s = await (await post("/api/room/send", { code: a.code, playerId: "oyuncuA", token: a.token, data: { hamle: "e4" } })).json();
  assert.deepEqual(s, { ok: true, seq: 1 });

  const qs = (pid, tok, since = 0) => `/api/room/state?code=${a.code}&playerId=${pid}&token=${tok}&since=${since}`;
  const durumB = await (await get(qs("oyuncuB", b.token))).json();
  assert.deepEqual(durumB.events, [{ seq: 1, from: "oyuncuA", data: { hamle: "e4" } }]);

  const durumA = await (await get(qs("oyuncuA", a.token))).json();
  assert.deepEqual(durumA.events, [], "oyuncu kendi olayını geri almaz");
  const sonra = await (await get(qs("oyuncuB", b.token, 1))).json();
  assert.deepEqual(sonra.events, [], "since sonrası olay yok");
});

test("oda yetkisi: yanlış jeton 403, dolu oda 409, bilinmeyen oda 404, geçersiz girdi 400", async () => {
  const a = await (await post("/api/room/create", { playerId: "sahip1" })).json();
  await post("/api/room/join", { code: a.code, playerId: "rakip1" });

  let r = await post("/api/room/send", { code: a.code, playerId: "sahip1", token: "yanlis", data: 1 });
  assert.equal(r.status, 403); await r.arrayBuffer();
  r = await get(`/api/room/state?code=${a.code}&playerId=sahip1&token=`);
  assert.equal(r.status, 400); await r.arrayBuffer();
  r = await post("/api/room/join", { code: a.code, playerId: "ucuncu" });
  assert.equal(r.status, 409); await r.arrayBuffer();
  r = await post("/api/room/join", { code: "ZZZ9", playerId: "kimse1" });
  assert.equal(r.status, 404); await r.arrayBuffer();
  r = await post("/api/room/create", { playerId: "x" });
  assert.equal(r.status, 400, "çok kısa oyuncu kimliği"); await r.arrayBuffer();
  r = await post("/api/room/create", "{bozuk json");
  assert.equal(r.status, 400); await r.arrayBuffer();
});

// En sonda: hız sınırı aynı IP'nin sonraki API isteklerini de engeller
test("hız sınırı: pencere başına 60 API isteğinden sonrası 429", async () => {
  const durumlar = [];
  for (let i = 0; i < 70; i++) {
    const r = await get("/api/ping");
    durumlar.push(r.status);
    await r.arrayBuffer();
  }
  assert.ok(durumlar.includes(429), "hiç 429 dönmedi");
  assert.ok(durumlar.indexOf(429) <= 60, `429 çok geç geldi (${durumlar.indexOf(429)}. istek)`);
  const r = await get("/index.html");
  assert.equal(r.status, 200, "statik dosyalar hız sınırından etkilenmez"); await r.arrayBuffer();
});
