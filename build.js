/* ============================================================
   Şahname — web varlıklarını www/ klasörüne toplar
   ------------------------------------------------------------
   Capacitor, uygulamanın içine gömülecek dosyaları tek bir
   klasörden alır. Bu betik yalnızca GEREKLİ dosyaları kopyalar;
   server.js, build.js gibi geliştirme dosyaları pakete girmez.

   Kullanım:  node build.js
   ============================================================ */
const fs = require("fs");
const path = require("path");

const KOK = __dirname;
const HEDEF = path.join(KOK, "www");

const DOSYALAR = [
  "index.html", "style.css", "app.js", "game.js", "engine.js", "p2p.js", "native.js",
  "manifest.webmanifest"
];
const KLASORLER = ["assets", "vendor"];

/* İkon/açılış KAYNAK dosyaları pakete girmez — bunlar yalnızca
   `npx @capacitor/assets generate` komutunun girdisidir ve
   native tarafa zaten ayrı ayrı yerleştirilir (~6 MB tasarruf). */
const HARIC = new Set([
  "icon.png", "icon-1024.png", "splash.png", "splash-dark.png", "mark-512.png"
]);

/** Klasörü içeriğiyle birlikte kopyalar. */
function klasorKopyala(kaynak, hedef) {
  fs.mkdirSync(hedef, { recursive: true });
  let sayi = 0, boyut = 0;
  for (const oge of fs.readdirSync(kaynak, { withFileTypes: true })) {
    if (HARIC.has(oge.name)) continue;
    const k = path.join(kaynak, oge.name), h = path.join(hedef, oge.name);
    if (oge.isDirectory()) {
      const alt = klasorKopyala(k, h);
      sayi += alt.sayi; boyut += alt.boyut;
    } else {
      fs.copyFileSync(k, h);
      sayi++; boyut += fs.statSync(k).size;
    }
  }
  return { sayi, boyut };
}

/* ------------------------------------------------------------
   SÜRÜM DAMGASI
   ------------------------------------------------------------
   app.js içindeki SURUM.derleme alanı her derlemede güncellenir ve
   Ayarlar ekranının altında görünür. Böylece telefondaki uygulamanın
   hangi derleme olduğu bakınca anlaşılır — "kuruldu mu kurulmadı mı"
   diye tahmin etmeye gerek kalmaz.

   Ayrıca Android versionCode her derlemede bir artar: aynı sürüm
   numarasıyla üst üste kurulum yapıldığında Android paket kurucusu
   "uygulama yüklenmedi" diyebiliyordu.
   ------------------------------------------------------------ */
function surumDamgala() {
  const d = new Date();
  const iki = n => String(n).padStart(2, "0");
  const damga = `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())} ${iki(d.getHours())}:${iki(d.getMinutes())}`;

  const appYol = path.join(KOK, "app.js");
  let app = fs.readFileSync(appYol, "utf8");
  const desen = /(const SURUM = \{ ad: ")([^"]+)(", derleme: ")([^"]*)("\s*\};)/;
  const eslesme = desen.exec(app);
  if (!eslesme) { console.warn("  ! SURUM satırı bulunamadı, damga atlandı"); return null; }
  app = app.replace(desen, `$1$2$3${damga}$5`);
  fs.writeFileSync(appYol, app);

  // Android sürüm kodunu artır
  const gradleYol = path.join(KOK, "android", "app", "build.gradle");
  let kod = null;
  if (fs.existsSync(gradleYol)) {
    let g = fs.readFileSync(gradleYol, "utf8");
    g = g.replace(/versionCode\s+(\d+)/, (_, n) => { kod = Number(n) + 1; return `versionCode ${kod}`; });
    g = g.replace(/versionName\s+"[^"]*"/, `versionName "${eslesme[2]}"`);
    fs.writeFileSync(gradleYol, g);
  }
  return { ad: eslesme[2], damga, kod };
}

const surum = surumDamgala();
if (surum) console.log(`\n  Sürüm ${surum.ad} · derleme ${surum.damga}${surum.kod ? ` · versionCode ${surum.kod}` : ""}\n`);

// Temiz başlangıç
fs.rmSync(HEDEF, { recursive: true, force: true });
fs.mkdirSync(HEDEF, { recursive: true });

let toplam = 0, adet = 0;
for (const d of DOSYALAR) {
  const kaynak = path.join(KOK, d);
  if (!fs.existsSync(kaynak)) { console.warn(`  ! eksik: ${d}`); continue; }
  fs.copyFileSync(kaynak, path.join(HEDEF, d));
  const b = fs.statSync(kaynak).size;
  toplam += b; adet++;
  console.log(`  ${d.padEnd(24)} ${(b / 1024).toFixed(1)} KB`);
}

for (const k of KLASORLER) {
  const kaynak = path.join(KOK, k);
  if (!fs.existsSync(kaynak)) { console.warn(`  ! eksik klasör: ${k}`); continue; }
  const r = klasorKopyala(kaynak, path.join(HEDEF, k));
  toplam += r.boyut; adet += r.sayi;
  console.log(`  ${(k + "/").padEnd(24)} ${r.sayi} dosya, ${(r.boyut / 1024).toFixed(0)} KB`);
}

console.log(`\n  www/ hazır — ${adet} dosya, ${(toplam / 1024 / 1024).toFixed(2)} MB`);
