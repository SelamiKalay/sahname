/* ============================================================
   ŞAH — Uygulama çekirdeği
   ------------------------------------------------------------
   Store    : LocalStorage kalıcılığı
   Catalog  : market ürün kataloğu
   Economy  : S-Coin kazanç/harcama
   Sfx      : WebAudio ile üretilen ses efektleri
   Haptics  : titreşim
   Toast    : bildirimler
   Theme    : tahta/taş teması uygulama
   Router   : sekme + alt ekran yönlendirme
   App      : tüm arayüz bağlamaları
   ============================================================ */
"use strict";

/* Sürüm damgası. `derleme` satırını build.js her çalıştığında kendisi
   günceller — bu yüzden elle değiştirilmeyecek. Ayarlar ekranının en
   altında görünür; hangi derlemenin kurulu olduğu böyle anlaşılır. */
const SURUM = { ad: "1.1.0", derleme: "2026-08-27 20:01" };

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------------------------------------
   GÜVENLİK YARDIMCILARI
   ------------------------------------------------------------
   HTML şablonlarına giren HER değişken esc()'ten geçmelidir.
   Kaynak güvenilir görünse bile (localStorage, ağdaki rakip,
   QR içeriği) kurcalanmış olabilir.
   ------------------------------------------------------------ */
const esc = v => String(v ?? "").replace(/[&<>"'`]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));

/** Yalnızca gerçek bir resim veri-URI'si ise döndürür, değilse null. */
const guvenliResimUrl = v => {
  const s = String(v ?? "");
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;
};

/* ------------------------------------------------------------
   PROFİL — ağ üzerinden paylaşılan kimlik
   ------------------------------------------------------------
   Yerel ağ maçında iki taraf birbirine adını, derecesini ve
   fotoğrafını bildirir. Fotoğraf iki yönde de dikkat ister:

   • GİDERKEN küçültülür. Depodaki kare 256 piksel (~20 KB); veri
     kanalı için gereksiz büyük ve el sıkışmayı yavaşlatır. 96
     piksele indirilip ~4 KB'a düşürülür.

   • GELİRKEN doğrulanır. Karşı taraf bizim uygulamamız olmak
     zorunda değil; gelen metin bir resim veri-URI'si biçiminde
     değilse veya makul boyutu aşıyorsa atılır.
   ------------------------------------------------------------ */
const Profil = {
  AG_BOYU: 96,
  AG_SINIRI: 40000,          // ~30 KB resim; fazlası kabul edilmez

  /** Depodaki fotoğrafın ağ için küçültülmüş hâli (yoksa null). */
  kucukAvatar() {
    const kaynak = guvenliResimUrl(Store.data.profile.avatar);
    if (!kaynak) return Promise.resolve(null);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = this.AG_BOYU;
          c.getContext("2d").drawImage(img, 0, 0, this.AG_BOYU, this.AG_BOYU);
          const kucuk = c.toDataURL("image/jpeg", 0.7);
          resolve(kucuk.length <= this.AG_SINIRI ? kucuk : null);
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = kaynak;
    });
  },

  /** Ağdan gelen fotoğrafı doğrular; güvenli değilse null döner. */
  agdanGelenAvatar(v) {
    if (typeof v !== "string" || v.length > this.AG_SINIRI) return null;
    return guvenliResimUrl(v);
  }
};

/* ------------------------------------------------------------
   DEPOLAMA KATMANI (cihazda kalıcı)
   ------------------------------------------------------------
   Tüm kullanıcı verisi CİHAZIN KENDİSİNDE tutulur; hiçbir veri
   sunucuya gönderilmez.

   Web'de  : localStorage
   Uygulamada: varsa yerel eklenti (Capacitor Preferences / Cordova
             NativeStorage) ile AYNI ANDA yazılır.

   Neden çift yazım? WebView'in localStorage'ı işletim sistemi
   tarafından (depolama baskısı, "önbelleği temizle") silinebilir.
   Yerel eklenti kalıcıdır. Açılışta önce yerelden okunup
   localStorage tazelenir, böylece kod senkron çalışmaya devam eder.

   UYGULAMAYA GEÇERKEN: buraya dokunmak gerekmez — eklenti varsa
   kendiliğinden devreye girer. Yapılacak tek şey Capacitor
   Preferences (veya benzeri) eklentisini projeye eklemek.
   ------------------------------------------------------------ */
const Persist = {
  KEY: "sah.save.v1",
  native: null,

  /** Cihazda yerel depolama eklentisi var mı? */
  detect() {
    const p = (window.Capacitor && window.Capacitor.Plugins) || {};
    if (p.Preferences) {
      return {
        ad: "Capacitor Preferences",
        get: k => p.Preferences.get({ key: k }).then(r => r.value),
        set: (k, v) => p.Preferences.set({ key: k, value: v }),
        del: k => p.Preferences.remove({ key: k })
      };
    }
    if (window.NativeStorage) {
      const ns = window.NativeStorage;
      return {
        ad: "Cordova NativeStorage",
        get: k => new Promise(res => ns.getItem(k, res, () => res(null))),
        set: (k, v) => new Promise(res => ns.setItem(k, v, res, res)),
        del: k => new Promise(res => ns.remove(k, res, res))
      };
    }
    return null;
  },

  /** Açılışta yerel depodaki veriyi localStorage'a taşır. */
  async hydrate() {
    this.native = this.detect();
    if (!this.native) return false;
    try {
      const val = await this.native.get(this.KEY);
      if (val) localStorage.setItem(this.KEY, val);
      console.log("[Depolama] Yerel eklenti aktif:", this.native.ad);
      return true;
    } catch (e) {
      console.warn("[Depolama] Yerel okuma başarısız:", e);
      return false;
    }
  },

  read() { try { return localStorage.getItem(this.KEY); } catch { return null; } },

  write(json) {
    try { localStorage.setItem(this.KEY, json); }
    catch (e) { console.warn("[Depolama] localStorage yazılamadı:", e); }
    if (this.native) this.native.set(this.KEY, json).catch(() => {});
  },

  remove() {
    try { localStorage.removeItem(this.KEY); } catch {}
    if (this.native) this.native.del(this.KEY).catch(() => {});
  }
};

/* ------------------------------------------------------------
   KALICI DEPOLAMA
   ------------------------------------------------------------ */
const Store = {
  KEY: "sah.save.v1",
  AD_SINIRI: 18,                 // üst bar ve oyuncu çubukları bu uzunluğa göre tasarlandı

  defaults() {
    return {
      profile:   { name: "Misafir", avatar: null },
      wallet:    { coins: 100 },                       // hoş geldin bonusu
      settings:  { sound: true, vibrate: true, hints: true, autoFlip: true },
      theme:     { board: "walnut", pieces: "classic" },
      inventory: { boards: ["walnut", "slate"], pieces: ["classic"] },
      stats:     { wins: 0, losses: 0, draws: 0 },
      rating:    { elo: 800, games: 0, peak: 800 },   // satranç usulü derece
      history:   [],                                  // son 5 maç (analiz için)
      aktifMac:  null,                                // yarım kalan dereceli maç
      cihazKimligi: null,                             // anonim kimlik (promosyon için)
      kullanilanKodlar: [],                           // tekrar kullanımı engellemek için
      satinAlmalar: [],                               // işlenmiş mağaza siparişleri
      reklam: { gun: "", izlenen: 0, macSayaci: 0, sonGecis: 0 }
    };
  },

  data: null,

  load() {
    try {
      const raw = Persist.read();
      const saved = raw ? JSON.parse(raw) : {};
      const def = this.defaults();
      // Derin birleştirme (yeni alanlar eklenirse eski kayıt bozulmasın)
      this.data = {
        profile:   { ...def.profile,   ...(saved.profile   || {}) },
        wallet:    { ...def.wallet,    ...(saved.wallet    || {}) },
        settings:  { ...def.settings,  ...(saved.settings  || {}) },
        theme:     { ...def.theme,     ...(saved.theme     || {}) },
        inventory: {
          boards: Array.from(new Set([...def.inventory.boards, ...((saved.inventory || {}).boards || [])])),
          pieces: Array.from(new Set([...def.inventory.pieces, ...((saved.inventory || {}).pieces || [])]))
        },
        stats:     { ...def.stats,     ...(saved.stats     || {}) },
        rating:    { ...def.rating,    ...(saved.rating    || {}) },
        history:   this.temizGecmis(saved.history),
        aktifMac:  this.temizAktifMac(saved.aktifMac),
        cihazKimligi: typeof saved.cihazKimligi === "string" && /^[0-9A-Z]{6,16}$/.test(saved.cihazKimligi)
                      ? saved.cihazKimligi : null,
        kullanilanKodlar: Array.isArray(saved.kullanilanKodlar)
                      ? saved.kullanilanKodlar.filter(k => typeof k === "string" && k.length <= 16).slice(-200)
                      : [],
      satinAlmalar: Array.isArray(saved.satinAlmalar)
                      ? saved.satinAlmalar.filter(k => typeof k === "string" && k.length <= 64).slice(-50)
                      : [],
      /* Reklam sayaçları kurcalanabilir; günlük sınırı aşmasın diye
         sayı olmayan ya da negatif değerler sıfırlanır. */
      reklam: (() => {
        const r = (saved.reklam && typeof saved.reklam === "object") ? saved.reklam : {};
        const sayi = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
        return { gun: typeof r.gun === "string" ? r.gun.slice(0, 12) : "",
                 izlenen: sayi(r.izlenen), macSayaci: sayi(r.macSayaci), sonGecis: sayi(r.sonGecis) };
      })()
      };
      /* Envanterde katalogda olmayan kimlikler birikmesin: bozuk bir kayıt
         ya da eski bir sürümden kalan ürün, ayarlardaki renk kutularında
         sahipsiz bir kutu olarak duruyordu. Tema geri dönüşü aşağıda
         zaten yapılıyor; buradaki süzme onu da doğru besliyor. */
      for (const tur of ["boards", "pieces"]) {
        const gecerli = new Set(Catalog[tur].map(x => x.id));
        this.data.inventory[tur] = this.data.inventory[tur].filter(id => gecerli.has(id));
      }

      // Derece alanları kurcalanmış olabilir — makul aralığa sıkıştır
      const rt = this.data.rating;
      const sayi = (v, vars) => { const n = Number(v); return Number.isFinite(n) ? n : vars; };
      rt.elo   = Math.min(4000, Math.max(100, Math.round(sayi(rt.elo, def.rating.elo))));
      rt.games = Math.max(0, Math.round(sayi(rt.games, 0)));
      rt.peak  = Math.min(4000, Math.max(rt.elo, Math.round(sayi(rt.peak, rt.elo))));
      // Sayısal alanlar bozulmuşsa (elle kurcalama, eski sürüm) düzelt
      const c = Number(this.data.wallet.coins);
      this.data.wallet.coins = Number.isFinite(c) && c >= 0 ? Math.floor(c) : def.wallet.coins;
      ["wins", "losses", "draws"].forEach(k => {
        const v = Number(this.data.stats[k]);
        this.data.stats[k] = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
      });
      // Yalnızca gerçek metin kabul edilir; nesne/sayı gelirse varsayılana döner
      const ad = this.data.profile.name;
      this.data.profile.name = (typeof ad === "string" && ad.trim()) ? ad.trim().slice(0, 18) : def.profile.name;
      if (typeof this.data.profile.avatar !== "string") this.data.profile.avatar = null;
      // Seçili tema envanterde yoksa varsayılana dön
      if (!this.data.inventory.boards.includes(this.data.theme.board)) this.data.theme.board = def.theme.board;
      if (!this.data.inventory.pieces.includes(this.data.theme.pieces)) this.data.theme.pieces = def.theme.pieces;
    } catch (e) {
      console.warn("[Store] Kayıt okunamadı, varsayılana dönülüyor.", e);
      this.data = this.defaults();
    }
    return this.data;
  },

  /**
   * Kayıtlı maç geçmişini doğrular. Depodaki veri elle değiştirilmiş
   * olabileceği için tür ve boyut sınırları burada zorlanır.
   */
  temizGecmis(ham) {
    if (!Array.isArray(ham)) return [];
    const izinliSonuc = ["win", "loss", "draw"];
    return ham.slice(0, 5).map(h => {
      if (!h || typeof h !== "object") return null;
      const moves = Array.isArray(h.moves)
        ? h.moves.filter(m => typeof m === "string" && m.length <= 10).slice(0, 400)
        : [];
      if (!moves.length) return null;
      return {
        id: String(h.id ?? Date.now()).slice(0, 24),
        moves,
        outcome: izinliSonuc.includes(h.outcome) ? h.outcome : "draw",
        reason: String(h.reason ?? "").slice(0, 60),
        label:  String(h.label  ?? "Maç").slice(0, 40),
        color:  h.color === "b" ? "b" : "w",
        date:   String(h.date ?? new Date().toISOString()).slice(0, 40)
      };
    }).filter(Boolean);
  },

  /** Yarım kalan maç kaydını doğrular (kurcalanmış olabilir). */
  temizAktifMac(ham) {
    if (!ham || typeof ham !== "object") return null;
    const hamleler = Array.isArray(ham.hamleler)
      ? ham.hamleler.filter(m => typeof m === "string" && m.length <= 10).slice(0, 400)
      : [];
    if (!hamleler.length) return null;
    const elo = Number(ham.rakipElo);
    return {
      mod: ham.mod === "net" ? "net" : "bot",
      renk: ham.renk === "b" ? "b" : "w",
      rakipElo: Number.isFinite(elo) ? Math.min(4000, Math.max(100, Math.round(elo))) : 1000,
      seviye: typeof ham.seviye === "string" ? ham.seviye.slice(0, 20) : null,
      hamleler,
      zaman: Number(ham.zaman) || Date.now()
    };
  },

  // Yazma/silme daima Persist üzerinden gider; böylece uygulamada
  // cihazın yerel deposuna da aynı anda yazılır.
  save() {
    try {
      Persist.write(JSON.stringify(this.data));
    } catch (e) {
      // Kota dolduysa en hacimli iki alanı (fotoğraf, geçmiş) bırakıp
      // tekrar dene — coin ve temaların kaybolmasındansa bunlar gitsin.
      console.warn("[Store] Kayıt yazılamadı, sadeleştirilip yeniden denenecek.", e);
      try {
        const yedek = { ...this.data, profile: { ...this.data.profile, avatar: null }, history: [] };
        Persist.write(JSON.stringify(yedek));
        this.data.profile.avatar = null;
        this.data.history = [];
        Toast.show("Depolama doldu — fotoğraf ve maç geçmişi temizlendi", "bad", 5000);
        App.renderAvatar?.(); App.renderHistory?.();
      } catch (e2) {
        console.error("[Store] Kayıt tamamen başarısız:", e2);
        Toast.show("Veriler kaydedilemiyor (depolama dolu)", "bad", 5000);
      }
    }
  },

  reset() { Persist.remove(); this.load(); }
};

/* ------------------------------------------------------------
   NADİRLİK KADEMELERİ
   ------------------------------------------------------------
   Her market ürünü bir kademeye aittir. Kademe iki işi birden
   yapar: fiyat bandını belirler ve kartın kenarını/rozetini
   renklendirir. Sıralama: yaygın < nadir < destansı < efsanevi.
   ------------------------------------------------------------ */
const Nadirlik = {
  SIRA: ["yaygin", "nadir", "destansi", "efsanevi"],
  yaygin:   { ad: "Yaygın",   ikon: "fa-circle"   },
  nadir:    { ad: "Nadir",    ikon: "fa-gem"      },
  destansi: { ad: "Destansı", ikon: "fa-star"     },
  efsanevi: { ad: "Efsanevi", ikon: "fa-crown"    },

  bilgi(k) { return this[k] || this.yaygin; },
  derece(k) { const i = this.SIRA.indexOf(k); return i < 0 ? 0 : i; }
};

/* ------------------------------------------------------------
   MARKET KATALOĞU
   ------------------------------------------------------------
   r = nadirlik kademesi. Fiyatlar kademe bandına göre verilir:
     yaygın   150 –  350
     nadir    450 –  750
     destansı 1100 – 1700
     efsanevi 2500 – 3000
   Maç başına ortalama ~40 S kazanıldığı için efsanevi bir ürün
   uzun soluklu bir hedeftir; acele edenler için S-Coin paketi var.
   ------------------------------------------------------------ */
const Catalog = {
  boards: [
    /* — yaygın — */
    { id: "walnut",   name: "Ceviz",        price: 0,    free: true, r: "yaygin" },
    { id: "slate",    name: "Arduvaz",      price: 0,    free: true, r: "yaygin" },
    { id: "sand",     name: "Kum",          price: 150,  r: "yaygin" },
    { id: "marble",   name: "Mermer",       price: 200,  r: "yaygin" },
    { id: "forest",   name: "Orman",        price: 250,  r: "yaygin" },
    { id: "bambu",    name: "Bambu",        price: 300,  r: "yaygin" },
    { id: "kahve",    name: "Kahve",        price: 350,  r: "yaygin" },
    /* — nadir — */
    { id: "coral",    name: "Mercan",       price: 450,  r: "nadir" },
    { id: "emerald",  name: "Zümrüt",       price: 500,  r: "nadir" },
    { id: "ice",      name: "Buz",          price: 550,  r: "nadir" },
    { id: "rose",     name: "Gül",          price: 600,  r: "nadir" },
    { id: "deniz",    name: "Sığ Deniz",    price: 650,  r: "nadir" },
    { id: "sonbahar", name: "Sonbahar",     price: 700,  r: "nadir" },
    { id: "lavanta",  name: "Lavanta",      price: 750,  r: "nadir" },
    /* — destansı — */
    { id: "midnight", name: "Gece Mavisi",  price: 1100, r: "destansi" },
    { id: "volcano",  name: "Volkan",       price: 1300, r: "destansi" },
    { id: "derin",    name: "Derin Su",     price: 1400, r: "destansi" },
    { id: "safir",    name: "Safir",        price: 1500, r: "destansi" },
    { id: "neon",     name: "Neon",         price: 1600, r: "destansi" },
    /* — efsanevi — */
    { id: "uzay",     name: "Uzay Boşluğu", price: 2500, r: "efsanevi" },
    { id: "nebula",   name: "Bulutsu",      price: 3000, r: "efsanevi" }
  ],
  pieces: [
    /* — yaygın — */
    { id: "classic",  name: "Klasik",      price: 0,    free: true, r: "yaygin" },
    { id: "ahsap",    name: "Ahşap",       price: 150,  r: "yaygin" },
    { id: "shadow",   name: "Gölge",       price: 250,  r: "yaygin" },
    { id: "marble",   name: "Mermer",      price: 350,  r: "yaygin" },
    /* — nadir — */
    { id: "bronz",    name: "Bronz",       price: 450,  r: "nadir" },
    { id: "inci",     name: "İnci",        price: 550,  r: "nadir" },
    { id: "crystal",  name: "Kristal",     price: 650,  r: "nadir" },
    { id: "gumus",    name: "Gümüş",       price: 750,  r: "nadir" },
    /* — destansı — */
    { id: "ember",    name: "Ateş",        price: 1100, r: "destansi" },
    { id: "zumrut",   name: "Zümrüt",      price: 1200, r: "destansi" },
    { id: "gold",     name: "Altın",       price: 1300, r: "destansi" },
    { id: "obsidyen", name: "Obsidyen",    price: 1500, r: "destansi" },
    { id: "neon",     name: "Neon",        price: 1600, r: "destansi" },
    { id: "royal",    name: "Kraliyet",    price: 1700, r: "destansi" },
    /* — efsanevi — */
    { id: "uzay",     name: "Yıldız Tozu", price: 2500, r: "efsanevi" },
    { id: "nebula",   name: "Bulutsu",     price: 2800, r: "efsanevi" },
    { id: "elmas",    name: "Elmas",       price: 3000, r: "efsanevi" }
  ],
  find(kind, id) { return this[kind].find(x => x.id === id); },

  /** Markette gösterim sırası: önce kademe, sonra fiyat. */
  sirali(kind) {
    return this[kind].slice().sort((a, b) =>
      Nadirlik.derece(a.r) - Nadirlik.derece(b.r) || a.price - b.price);
  }
};

/* ------------------------------------------------------------
   ELO DERECELENDİRME
   ------------------------------------------------------------
   Gerçek satranç Elo formülü:
       beklenen = 1 / (1 + 10^((rakip − sen) / 400))
       yeni     = sen + K × (sonuç − beklenen)
   Kendinden güçlüyü yenmek çok, zayıfı yenmek az kazandırır.

   Ayrıca hamle kaliten küçük bir ek puan getirir: maç bitince
   kendi hamlelerin motorla karşılaştırılır, ortalama santipiyon
   kaybın düşükse birkaç puan eklenir.
   ------------------------------------------------------------ */
const Rating = {
  BASLANGIC: 800,
  TABAN: 100,                       // bunun altına düşmez

  // Botların sabit dereceleri (Stockfish seviyesi + düşünme süresine göre)
  // Bot dereceleri BotGame.ZORLUK içinde tanımlı (tek kaynak)
  get BOT_ELO() {
    const t = {};
    for (const [ad, z] of Object.entries(BotGame.ZORLUK)) t[ad] = z.elo;
    return t;
  },

  /** Oynanan maç sayısı arttıkça derece daha az oynar (K katsayısı). */
  K(oyun) { return oyun < 10 ? 40 : oyun < 30 ? 24 : 16; },

  /** sonuc: 1 galibiyet, 0.5 beraberlik, 0 mağlubiyet */
  hesapla(benim, rakip, sonuc, oyun) {
    const beklenen = 1 / (1 + Math.pow(10, (rakip - benim) / 400));
    const degisim = this.K(oyun) * (sonuc - beklenen);
    return { degisim: Math.round(degisim), beklenen };
  },

  /** Maç sonucunu uygular ve değişimi döndürür. */
  uygula(rakipElo, outcome) {
    const r = Store.data.rating;
    const sonuc = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
    const { degisim } = this.hesapla(r.elo, rakipElo, sonuc, r.games);

    r.elo = Math.max(this.TABAN, r.elo + degisim);
    r.games++;
    if (r.elo > r.peak) r.peak = r.elo;
    Store.save();
    App.renderProfile();
    return degisim;
  },

  /** Hamle kalitesine göre küçük ek puan (0–8). */
  bonusHesapla(ortKayip) {
    if (ortKayip == null) return 0;
    if (ortKayip <= 20)  return 8;
    if (ortKayip <= 40)  return 5;
    if (ortKayip <= 70)  return 3;
    if (ortKayip <= 120) return 1;
    return 0;
  },

  bonusUygula(puan) {
    if (puan <= 0) return 0;
    const r = Store.data.rating;
    r.elo += puan;
    if (r.elo > r.peak) r.peak = r.elo;
    Store.save();
    App.renderProfile();
    return puan;
  },

  /**
   * Oyuncunun KENDİ hamlelerinin ortalama santipiyon kaybını ölçer.
   * Motoru uzun süre meşgul etmemek için kısa süreli ve sınırlı tarar.
   * @returns {Promise<number|null>} ortalama kayıp (cp)
   */
  async kaliteOlc(sanHamleler, renk, sinir = 50) {
    if (!Array.isArray(sanHamleler) || !sanHamleler.length) return null;
    const hamleler = sanHamleler.slice(0, sinir);
    const probe = new Chess();
    const skorlar = [];

    // Her konumun skorunu topla (sıradaki oyuncu açısından)
    for (let i = 0; i <= hamleler.length; i++) {
      const info = await Engine.analyze(probe.fen(), { movetime: 150 });
      if (info.unavailable) return null;
      skorlar.push(info.mate != null ? (info.mate > 0 ? 10000 : -10000) : info.cp);
      if (i < hamleler.length && !probe.move(hamleler[i])) break;
    }

    // Yalnızca bizim hamlelerimizin kaybını al
    const walk = new Chess();
    const kayiplar = [];
    for (let i = 0; i < hamleler.length && i + 1 < skorlar.length; i++) {
      const oynayan = walk.turn();
      walk.move(hamleler[i]);
      if (oynayan !== renk) continue;
      const kayip = Math.max(0, skorlar[i] + skorlar[i + 1]);   // taraf değiştiği için toplanır
      if (kayip < 3000) kayiplar.push(kayip);                   // mat sıçramalarını dışla
    }
    if (!kayiplar.length) return null;
    return Math.round(kayiplar.reduce((a, b) => a + b, 0) / kayiplar.length);
  }
};

/* ------------------------------------------------------------
   TEMALI SEÇİCİ
   ------------------------------------------------------------
   Tarayıcının kendi <select> açılır listesi işletim sistemi
   tarafından çizilir: koyu temada yazılar okunmuyor ve uygulamanın
   görünümüyle hiç uyuşmuyor. Bu yüzden select'leri gizleyip
   yerlerine temaya uygun bir düğme + alt panel koyuyoruz.
   Değer yine gizli select'te tutulduğu için okuma kodu değişmiyor.
   ------------------------------------------------------------ */
const Secici = {
  sheet: null, liste: null, baslik: null, aktifSelect: null,

  init() {
    this.sheet  = $("#secimSheet");
    this.liste  = $("#secimListe");
    this.baslik = $("#secimBaslik");
    $("#secimIptal").onclick = () => this.kapat();
    this.sheet.addEventListener("click", e => { if (e.target === this.sheet) this.kapat(); });
  },

  /** Bir <select>'i temalı düğmeye dönüştürür. */
  bagla(select, baslik) {
    if (!select || select.dataset.secici) return;
    select.dataset.secici = "1";
    select.hidden = true;

    const dugme = document.createElement("button");
    dugme.type = "button";
    dugme.className = "secici";
    dugme.innerHTML = `<span class="secici__deger"></span><i class="fa-solid fa-chevron-down"></i>`;
    select.after(dugme);

    const tazele = () => {
      const secili = select.options[select.selectedIndex];
      dugme.querySelector(".secici__deger").textContent = secili ? secili.textContent.trim() : "";
    };
    tazele();
    select.addEventListener("change", tazele);
    dugme.onclick = () => this.ac(select, baslik || "Seç");
  },

  ac(select, baslik) {
    this.aktifSelect = select;
    this.baslik.textContent = baslik;
    this.liste.innerHTML = "";

    Array.from(select.options).forEach((opt, i) => {
      const sat = document.createElement("button");
      sat.type = "button";
      sat.className = "secim-sat" + (i === select.selectedIndex ? " is-active" : "");
      sat.innerHTML = `<span>${esc(opt.textContent.trim())}</span>
                       <i class="fa-solid fa-check"></i>`;
      sat.onclick = () => {
        select.selectedIndex = i;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        Sfx.play("tap"); Haptics.tap();
        this.kapat();
      };
      this.liste.appendChild(sat);
    });

    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add("is-open"));
  },

  kapat() {
    this.sheet.classList.remove("is-open");
    setTimeout(() => { this.sheet.hidden = true; }, 220);
    this.aktifSelect = null;
  }
};

/* ------------------------------------------------------------
   PROMOSYON KODU
   ------------------------------------------------------------
   Kodlar İMZALIDIR: içeriği (tip + miktar + seri) gizli bir anahtarla
   imzalanır. Uygulama imzayı doğrular; imzasız/uydurma kod geçmez.

   Kod ÜRETİCİSİ uygulamada YOKTUR — ayrı bir dosyadadır
   (kod-uretici.html) ve build.js'in kopyaladığı dosya listesinde
   bulunmadığı için APK'ya asla girmez.

   Kod cihaza bağlanabilir: imza, kullanıcının cihaz kimliğiyle
   birlikte alınırsa o kod başka telefonda çalışmaz. Kimlik boş
   bırakılırsa herkese açık (kampanya) kodu üretilir.

   Not: Uygulama verisi cihazda tutulduğu için kararlı bir saldırgan
   zaten depoyu elle düzenleyip kendine coin verebilir. Bu sistemin
   amacı kodların tahmin edilmesini ve gelişigüzel paylaşılmasını
   engellemektir; kırılamaz bir kasa değildir.
   ------------------------------------------------------------ */
const Promosyon = {
  // Üretici araçtaki anahtarla AYNI olmalı
  GIZLI: "BURAYA-KENDI-GIZLI-ANAHTARINI-YAZ",   // yayın paketinde gerçek anahtar kullanılır, depoya konmaz
  ALFABE: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",   // I, L, O, U yok (karışmasın)
  BASLANGIC: Date.UTC(2026, 0, 1),              // son kullanma tarihi başlangıcı

  _b32(sayi, uzunluk) {
    let s = "";
    for (let i = 0; i < uzunluk; i++) { s = this.ALFABE[sayi % 32] + s; sayi = Math.floor(sayi / 32); }
    return s;
  },
  _sayi(metin) {
    let n = 0;
    for (const c of metin) { const i = this.ALFABE.indexOf(c); if (i < 0) return NaN; n = n * 32 + i; }
    return n;
  },

  async _imza(yuk, cihaz, uzunluk = 11) {
    const anahtar = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(this.GIZLI),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bayt = new Uint8Array(await crypto.subtle.sign(
      "HMAC", anahtar, new TextEncoder().encode(yuk + "|" + cihaz)));
    let s = "";
    for (let i = 0; i < uzunluk; i++) s += this.ALFABE[bayt[i] % 32];
    return s;
  },

  /**
   * Karıştırma sırası: koddaki ilk karakterden türeyen sabit permütasyon.
   * Amaç, yük ve imzanın kodda BLOK HÂLİNDE durmamasıdır — aksi hâlde aynı
   * ödül için üretilen kodlar aynı önekle başlar ve desen ele verir.
   * Her kodun karıştırma anahtarı farklı olduğu için iki kod birbirine
   * hiç benzemez. (Güvenlik imzadan gelir; bu katman deseni gizler.)
   */
  _karistirmaSirasi(k) {
    const n = 19;
    const sira = Array.from({ length: n }, (_, i) => i);
    let s = (k * 2654435761 + 12345) >>> 0;
    for (let i = n - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [sira[i], sira[j]] = [sira[j], sira[i]];
    }
    return sira;
  },

  /** "A1B2-C3D4-…" → sadece harf/rakam, karışabilen harfler düzeltilmiş */
  _sadelestir(kod) {
    return String(kod || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
      .replace(/I/g, "1").replace(/L/g, "1").replace(/O/g, "0").replace(/U/g, "V");
  },

  /**
   * Kodu doğrular ve ödülü verir.
   * Biçim: 20 karakter — [0] karıştırma anahtarı, kalan 19 karakter
   * dağıtılmış hâlde 8 karakter yük + 11 karakter imza.
   * @returns {Promise<{ok:boolean, mesaj:string, tip?:string, miktar?:number}>}
   */
  async kullan(hamKod) {
    const kod = this._sadelestir(hamKod);
    if (kod.length !== 20) return { ok: false, mesaj: "Kod 20 karakter olmalı" };

    const kullanilan = Store.data.kullanilanKodlar || [];
    if (kullanilan.includes(kod)) return { ok: false, mesaj: "Bu kod daha önce kullanıldı" };

    // Karıştırmayı çöz
    const k = this.ALFABE.indexOf(kod[0]);
    if (k < 0) return { ok: false, mesaj: "Kod geçersiz" };
    const sira = this._karistirmaSirasi(k);
    let duz = "";
    for (let i = 0; i < 19; i++) duz += kod[1 + sira[i]];

    const yuk = duz.slice(0, 8), imza = duz.slice(8);
    // Önce bu cihaza özel, sonra herkese açık imza denenir
    const cihazImza = await this._imza(yuk, Kimlik.al());
    const genelImza = await this._imza(yuk, "*");
    if (imza !== cihazImza && imza !== genelImza) {
      return { ok: false, mesaj: "Kod geçersiz" };
    }

    const tip = yuk[0];
    const miktar = this._sayi(yuk.slice(1, 4));
    if (!Number.isFinite(miktar) || miktar <= 0) return { ok: false, mesaj: "Kod okunamadı" };

    /* Son kullanma: 2026-01-01'den itibaren gün sayısı (0 = süresiz).
       Herkese açık kodların sonsuza dek dolaşmasını engeller. */
    const gun = this._sayi(yuk.slice(4, 6));
    if (Number.isFinite(gun) && gun > 0) {
      const bitis = this.BASLANGIC + gun * 86400000;
      if (Date.now() > bitis) {
        const t = new Date(bitis);
        return { ok: false, mesaj: `Kodun süresi dolmuş (${t.toLocaleDateString("tr-TR")})` };
      }
    }

    // Ödülü ver
    if (tip === "C") {
      Store.data.wallet.coins += miktar;
    } else if (tip === "E") {
      const r = Store.data.rating;
      r.elo = Math.min(4000, r.elo + miktar);
      if (r.elo > r.peak) r.peak = r.elo;
    } else {
      return { ok: false, mesaj: "Bilinmeyen kod türü" };
    }

    kullanilan.push(kod);
    Store.data.kullanilanKodlar = kullanilan.slice(-200);   // sınırsız büyümesin
    Store.save();
    App.renderWallet(true);
    App.renderProfile();

    return { ok: true, tip, miktar,
             mesaj: tip === "C" ? `${miktar} S hesabına eklendi!` : `Derecene ${miktar} Elo eklendi!` };
  }
};

/* ------------------------------------------------------------
   CİHAZ KİMLİĞİ
   ------------------------------------------------------------
   Anonim, cihaza özel bir kimlik. Kişisel bilgi içermez; geri
   bildirimde gönderilir ki o kullanıcıya özel kod üretilebilsin.
   ------------------------------------------------------------ */
const Kimlik = {
  al() {
    let k = Store.data.cihazKimligi;
    if (!k) {
      const ham = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "")
                                     : Math.random().toString(36).slice(2) + Date.now().toString(36));
      k = ham.toUpperCase().slice(0, 10);
      Store.data.cihazKimligi = k;
      Store.save();
    }
    return k;
  }
};

/* ------------------------------------------------------------
   GERİ BİLDİRİM
   ------------------------------------------------------------
   Sunucumuz olmadığı için ücretsiz form servisi (Web3Forms) kullanılır.
   Anahtar yoksa veya internet yoksa kullanıcının mail uygulaması
   doldurulmuş halde açılır — yazdığı yazı boşa gitmez.

   ANAHTAR NASIL ALINIR: web3forms.com adresine mail adresini gir,
   erişim anahtarı mailine gelir; aşağıdaki sabite yapıştır.
   ------------------------------------------------------------ */
const GeriBildirim = {
  ANAHTAR: "",                                   // Web3Forms erişim anahtarı (depoya konmaz)
  MAIL: "",                                      // yedek: mailto adresi (depoya konmaz)
  UC: "https://api.web3forms.com/submit",
  BEKLEME: 60_000,                               // spam koruması
  _sonGonderim: 0,

  /**
   * Otomatik eklenen bilgiler.
   * Kullanıcı bunları yazmak zorunda kalmasın diye profil ve hesap
   * durumu da gönderilir — mağduriyet iddiasını teyit edebilmek ve
   * gerekirse o kişiye özel promosyon kodu üretebilmek için.
   * Profil FOTOĞRAFI gönderilmez (gereksiz ve çok büyük).
   */
  _teknikBilgi() {
    const d = Store.data;
    const satinAlinan = [
      ...d.inventory.boards.filter(x => !["walnut", "slate"].includes(x)),
      ...d.inventory.pieces.filter(x => x !== "classic")
    ];
    return [
      `--- Kullanıcı ---`,
      `Ad: ${d.profile.name}`,
      `Cihaz kimliği: ${Kimlik.al()}          <-- promosyon kodu için`,
      `Bakiye: ${d.wallet.coins} S`,
      `Derece: ${d.rating.elo} Elo (en yüksek ${d.rating.peak}, ${d.rating.games} dereceli maç)`,
      `İstatistik: ${d.stats.wins}G / ${d.stats.losses}M / ${d.stats.draws}B`,
      `Satın aldıkları: ${satinAlinan.length ? satinAlinan.join(", ") : "yok"}`,
      ``,
      `--- Teknik ---`,
      `Uygulama: Şahname ${SURUM.ad} (${SURUM.derleme})`,
      `Ortam: ${(typeof Native !== "undefined" && Native.var) ? "Android uygulaması" : "tarayıcı"}`,
      `Cihaz: ${navigator.userAgent}`,
      `Ekran: ${screen.width}x${screen.height}`,
      `Motor: ${Engine.ready ? "hazır" : "yüklenemedi"}`
    ].join("\n");
  },

  async gonder() {
    const konu = $("#fbKonu").value;
    const metin = $("#fbMetin").value.trim();
    const iletisimTur = $("#fbIletisimTur").value;
    const iletisim = $("#fbIletisim").value.trim();

    if (metin.length < 10) {
      Toast.show("Lütfen biraz daha ayrıntı yaz (en az 10 karakter)", "bad");
      Sfx.play("error"); return;
    }
    /* Geri dönüş isteniyorsa geçerli bir e-posta şart — yoksa yanıt
       ulaşmaz ve kullanıcı cevap beklerken boşuna bekler. */
    if (iletisimTur !== "yok" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(iletisim)) {
      Toast.show("Geçerli bir e-posta adresi yaz", "bad");
      Sfx.play("error"); return;
    }
    const kalan = this.BEKLEME - (Date.now() - this._sonGonderim);
    if (kalan > 0) {
      Toast.show(`Biraz bekle — ${Math.ceil(kalan / 1000)} sn sonra tekrar gönderebilirsin`, "info");
      return;
    }

    const btn = $("#fbGonder");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Gönderiliyor…';

    const iletisimSatiri = iletisimTur === "yok"
      ? "Geri dönüş istemiyor"
      : `${iletisimTur}: ${iletisim}`;
    const govde = `${metin}\n\n--- İletişim ---\n${iletisimSatiri}\n\n${this._teknikBilgi()}`;
    let basarili = false;

    if (this.ANAHTAR) {
      try {
        const alanlar = {
          access_key: this.ANAHTAR,
          // Konu ön eki SABİT kalmalı: Gmail'de "[Şahname] içerenleri
          // spam'e atma" filtresi buna göre eşleşiyor.
          subject: `[Şahname] ${konu}`,
          from_name: "Şahname geri bildirim",
          message: govde
        };
        // Kullanıcı e-posta bıraktıysa doğrudan "Yanıtla" ile ulaşılabilsin
        if (iletisimTur !== "yok" && iletisim) alanlar.replyto = iletisim;

        const r = await fetch(this.UC, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(alanlar)
        });
        basarili = r.ok && (await r.json()).success;
      } catch (e) {
        console.warn("[Geri bildirim] Servise ulaşılamadı:", e);
      }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Gönder';

    if (basarili) {
      this._sonGonderim = Date.now();
      $("#fbMetin").value = ""; $("#fbIletisim").value = ""; this._sayaciTazele();
      Toast.show("Teşekkürler! Geri bildirimin ulaştı.", "good", 4000);
      Sfx.play("coin"); Haptics.tap([12, 30, 12]);
    } else {
      // Yedek: mail uygulamasını doldurulmuş halde aç
      this._mailAc(konu, govde);
    }
  },

  _mailAc(konu, govde) {
    const url = `mailto:${this.MAIL}?subject=${encodeURIComponent("[Şahname] " + konu)}`
              + `&body=${encodeURIComponent(govde)}`;
    Toast.show("Mail uygulaman açılıyor — göndermek için 'gönder'e bas", "info", 5000);
    try { location.href = url; }
    catch (_) { Toast.show("Mail uygulaması açılamadı", "bad"); }
  },

  _sayaciTazele() {
    const n = $("#fbMetin").value.length;
    $("#fbSayac").textContent = `${n}/1000`;
  },

  kur() {
    $("#fbGonder").onclick = () => this.gonder();
    $("#fbMetin").addEventListener("input", () => this._sayaciTazele());
    this._sayaciTazele();

    // Açılır listeleri temalı seçiciye çevir
    Secici.bagla($("#fbKonu"), "Konu seç");
    Secici.bagla($("#fbIletisimTur"), "Geri dönüş yolu");

    // Geri dönüş isteniyorsa e-posta alanını göster
    const tur = $("#fbIletisimTur"), alan = $("#fbIletisimAlan"), giris = $("#fbIletisim");
    tur.addEventListener("change", () => {
      alan.hidden = tur.value === "yok";
      if (alan.hidden) giris.value = "";
    });
  }
};

/* ------------------------------------------------------------
   TAŞ DERSLERİ
   ------------------------------------------------------------
   Her ders bir konum + odak karesi. Mevcut BoardView yeniden
   kullanılır: taşın gidebileceği kareler chess.js'ten alınıp
   tahtada yakılır — yani anlatılan şey ekranda canlı gösterilir.
   ------------------------------------------------------------ */
const Dersler = {
  board: null, aktif: 0,

  LISTE: [
    { id: "piyon", ad: "Piyon", ikon: "chess-pawn",
      fen: "8/8/8/8/4P3/8/8/8 w - - 0 1", kare: "e4",
      ozet: "Sadece ileri gider, geri dönemez. İlk hamlesinde iki kare gidebilir.",
      maddeler: ["Düz ilerler ama ÇAPRAZ alır — tek böyle taş budur.",
                 "Başlangıç karesindeyken bir veya iki kare gidebilir.",
                 "Son yatayına ulaşırsa istediğin taşa terfi eder."] },

    { id: "at", ad: "At", ikon: "chess-knight",
      fen: "8/8/8/3N4/8/8/8/8 w - - 0 1", kare: "d5",
      ozet: "L çizerek gider: iki kare düz, bir kare yana.",
      maddeler: ["Üzerinden atlayabilen tek taştır; önü kapalı olsa da hareket eder.",
                 "Merkezde 8 kareye ulaşır, köşede yalnızca 2 kareye — kenarda zayıftır.",
                 "Her hamlede kare rengi değişir."] },

    { id: "fil", ad: "Fil", ikon: "chess-bishop",
      fen: "8/8/8/3B4/8/8/8/8 w - - 0 1", kare: "d5",
      ozet: "Çapraz gider, istediği kadar uzağa.",
      maddeler: ["Başladığı kare renginde kalır; asla diğer renge geçemez.",
                 "Bu yüzden iki fil birlikte tahtanın tamamını kontrol eder.",
                 "Açık çaprazlarda uzaktan etkilidir."] },

    { id: "kale", ad: "Kale", ikon: "chess-rook",
      fen: "8/8/8/3R4/8/8/8/8 w - - 0 1", kare: "d5",
      ozet: "Düz gider: yatay ve dikey, istediği kadar.",
      maddeler: ["Açık hatlarda çok güçlüdür.",
                 "Oyun sonunda değeri artar.",
                 "Rok hamlesine katılan iki taştan biridir."] },

    { id: "vezir", ad: "Vezir", ikon: "chess-queen",
      fen: "8/8/8/3Q4/8/8/8/8 w - - 0 1", kare: "d5",
      ozet: "Kale ve filin toplamı: hem düz hem çapraz.",
      maddeler: ["Tahtanın en güçlü taşıdır.",
                 "Erken çıkarmak risklidir — rakip taşlar onu kovalayarak zaman kazanır.",
                 "Merkezde 27 kareyi birden kontrol eder."] },

    { id: "sah", ad: "Şah", ikon: "chess-king",
      fen: "8/8/8/3K4/8/8/8/8 w - - 0 1", kare: "d5",
      ozet: "Her yöne bir kare gider. Oyunun amacı onu korumaktır.",
      maddeler: ["Asla tehdit altındaki kareye gidemez.",
                 "Oyun sonunda güçlü bir saldırı taşına dönüşür.",
                 "Şah kaçamıyorsa mat olur ve oyun biter."] },

    { id: "rok", ad: "Rok", ikon: "shield-halved",
      fen: "8/8/8/8/8/8/8/R3K2R w KQ - 0 1", kare: "e1", ozel: "e1g1",
      ozet: "Şah ve kale tek hamlede birlikte yer değiştirir.",
      maddeler: ["Şah iki kare kaleye doğru gider, kale onun öbür yanına geçer.",
                 "Aralarında taş olmamalı ve ikisi de daha önce oynamamış olmalı.",
                 "Şah çekilmişken veya geçtiği kareler tehdit altındayken yapılamaz."] },

    { id: "terfi", ad: "Terfi", ikon: "arrow-up",
      fen: "8/4P3/8/8/8/8/8/k6K w - - 0 1", kare: "e7", ozel: "e7e8q",
      ozet: "Son yatayına ulaşan piyon başka bir taşa dönüşür.",
      maddeler: ["Genellikle vezir seçilir çünkü en güçlüsüdür.",
                 "At, fil veya kale de seçilebilir — bazen at seçmek mat kurar.",
                 "Tahtada aynı anda birden fazla vezir olabilir."] },

    { id: "gecerken", ad: "Geçerken alma", ikon: "arrows-left-right",
      fen: "8/8/8/3pP3/8/8/8/k6K w - d6 0 2", kare: "e5", ozel: "e5d6",
      ozet: "İki kare atlayan piyonu, yanındaki piyon geçerken alabilir.",
      maddeler: ["Yalnızca rakip piyon iki kare ilerlediği HAMLEDEN hemen sonra yapılabilir.",
                 "Alan piyon, atlanan karenin üzerine oturur.",
                 "Bir hamle beklersen bu hak kaybolur."] }
  ],

  kur(refs) {
    this.board = new BoardView({ boardEl: refs.board, onMove: () => {} });
    this.board.lock(true);                 // dersler salt-okunur
    this._sekmeleriCiz();
    this.goster(0);
  },

  _sekmeleriCiz() {
    $("#lessonTabs").innerHTML = this.LISTE.map((d, i) =>
      `<button class="lesson-tab ${i === 0 ? "is-active" : ""}" data-ders="${i}">
         <i class="fa-solid fa-${d.ikon}"></i><span>${esc(d.ad)}</span></button>`).join("");
  },

  goster(i) {
    const d = this.LISTE[i];
    if (!d) return;
    this.aktif = i;

    $$("#lessonTabs .lesson-tab").forEach((b, k) => b.classList.toggle("is-active", k === i));

    const chess = new Chess(d.fen);
    this.board.setGame(chess);
    this.board.lock(true);

    /* Gidebileceği kareleri yak. Terfide aynı kareye 4 ayrı hamle
       (vezir/kale/fil/at) üretildiği için kare sayısı benzersizleştirilir. */
    const hamleler = chess.moves({ square: d.kare, verbose: true });
    const kareler = [...new Set(hamleler.map(m => m.to))];
    this.board.clearArrows();
    this.board._squares.get(d.kare)?.classList.add("is-hint-from");
    kareler.forEach(k => this.board._squares.get(k)?.classList.add("is-hint-to"));
    this.board.hintSquares = null;          // render'da tekrar boyanmasın

    $("#lessonTitle").textContent = d.ad;
    $("#lessonCount").textContent = kareler.length + " kare";
    $("#lessonSummary").textContent = d.ozet;
    $("#lessonPoints").innerHTML = d.maddeler.map(m => `<li>${esc(m)}</li>`).join("");

    const oynat = $("#lessonPlay");
    oynat.hidden = !d.ozel;
    oynat.onclick = () => this.ozelOynat(d);

    Sfx.play("tap");
  },

  /** Rok, terfi, geçerken alma gibi kuralları tahtada canlandırır. */
  ozelOynat(d) {
    const chess = new Chess(d.fen);
    const m = chess.move({ from: d.ozel.slice(0, 2), to: d.ozel.slice(2, 4), promotion: d.ozel[4] || "q" });
    if (!m) return;
    this.board.setLastMove(m);
    this.board.setGame(chess);
    this.board.lock(true);
    Sfx.play(/[kq]/.test(m.flags) ? "castle" : m.captured ? "capture" : "move");
    Haptics.tap(12);
    $("#lessonCount").textContent = m.san;
    // 2 saniye sonra başa dön
    setTimeout(() => { if (this.aktif === this.LISTE.indexOf(d)) this.goster(this.aktif); }, 2000);
  }
};

/* ------------------------------------------------------------
   HAMLE AÇIKLAYICI
   ------------------------------------------------------------
   "En iyi hamle e4" demek öğretmez; NEDEN en iyi olduğunu anlatmak
   öğretir. Motorun verdiği skor/varyasyon ile chess.js'in konum
   bilgisi birleştirilip kural tabanlı Türkçe gerekçe üretilir.
   Tamamen çevrimdışı çalışır, yapay zekâ kullanılmaz.
   ------------------------------------------------------------ */
const Aciklayici = {
  DEGER: { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 },
  AD:    { p: "piyon", n: "at", b: "fil", r: "kale", q: "vezir", k: "şah" },
  // Türkçe belirtme hâli — ek uydurmak yanlış sonuç veriyor ("veziru" gibi)
  BELIRTME: { p: "piyonu", n: "atı", b: "fili", r: "kaleyi", q: "veziri", k: "şahı" },
  MERKEZ: ["d4", "e4", "d5", "e5"],

  _buyukHarf(s) { return s.charAt(0).toLocaleUpperCase("tr") + s.slice(1); },

  /** Bir karedeki taşa saldıran/savunan sayısını verir. */
  _saldiranSayisi(chess, kare, renk) {
    // chess.js doğrudan sunmuyor: renk sırasını geçici kurup hamleleri tarıyoruz
    let sayi = 0;
    const parcalar = chess.fen().split(" ");
    parcalar[1] = renk;
    parcalar[3] = "-";                       // en passant hedefi karışmasın
    try {
      const gecici = new Chess(parcalar.join(" "));
      for (const m of gecici.moves({ verbose: true })) if (m.to === kare) sayi++;
    } catch (_) { return 0; }
    return sayi;
  },

  /** Hedef taş bedava mı? (saldıran var, savunan yok) */
  _bedavaMi(chess, kare, kurbanRenk) {
    const savunan = this._saldiranSayisi(chess, kare, kurbanRenk);
    return savunan === 0;
  },

  /**
   * Hamleden sonra taşımızın saldırdığı değerli rakip taşlar.
   * Hamle sonrası sıra RAKİPTE olduğu için doğrudan moves() sorulamaz —
   * sırayı geçici olarak bize çevirip kendi saldırılarımıza bakıyoruz.
   */
  _catalHedefleri(sonrasi, kare, benimRenk) {
    const p = sonrasi.fen().split(" ");
    p[1] = benimRenk;
    p[3] = "-";                                // en passant karışmasın
    let gecici;
    try { gecici = new Chess(p.join(" ")); } catch (_) { return []; }
    if (!gecici) return [];

    const hedefler = [];
    let hamleler = [];
    try { hamleler = gecici.moves({ square: kare, verbose: true }); } catch (_) { return []; }
    // Kare bazında toplanır: iki kaleyi birden vurmak da çataldır,
    // taş türüne göre tekilleştirilirse bu durum kaybolur.
    for (const m of hamleler) if (m.captured) hedefler.push({ kare: m.to, tas: m.captured });
    return hedefler;
  },

  /**
   * @param {string} fen        - hamle öncesi konum
   * @param {string} uci        - en iyi hamle (e2e4)
   * @param {object} info       - Engine.analyze çıktısı
   * @returns {string[]} en fazla 2 gerekçe cümlesi
   */
  acikla(fen, uci, info) {
    if (!uci) return [];
    let chess, hamle, sonrasi;
    try {
      chess = new Chess(fen);
      sonrasi = new Chess(fen);
      hamle = sonrasi.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
      if (!hamle) return [];
    } catch (_) { return []; }

    const gerekceler = [];
    const benim = hamle.color, rakip = benim === "w" ? "b" : "w";
    const tasAd = this.AD[hamle.piece];

    // 1) Mat varyasyonu — en güçlü gerekçe
    if (info && info.mate != null && info.mate > 0) {
      gerekceler.push(`${info.mate} hamlede mat ediyor.`);
    } else if (sonrasi.in_checkmate()) {
      gerekceler.push("Şah mat — oyunu bitiriyor.");
    }

    // 2) Terfi
    if (hamle.promotion) {
      gerekceler.push(`Piyon ${this.AD[hamle.promotion]}e çıkıyor.`);
    }

    // 3) Malzeme kazancı
    if (hamle.captured) {
      const kazanc = this.DEGER[hamle.captured];
      const maliyet = this.DEGER[hamle.piece];
      const bedava = this._bedavaMi(chess, hamle.to, rakip);
      if (bedava) {
        gerekceler.push(`Savunmasız ${this.BELIRTME[hamle.captured]} bedavaya alıyor (+${kazanc}).`);
      } else if (kazanc > maliyet) {
        gerekceler.push(`${this._buyukHarf(tasAd)}la daha değerli ${this.BELIRTME[hamle.captured]} alıyor.`);
      }
    }

    /* 4) Çatal — tek taşla birden fazla hedefi vurmak.
       Şah da bir hedeftir: şah çekerken aynı anda değerli bir taşa
       saldırmak ("kraliyet çatalı") en tipik at taktiğidir, ama
       chess.js şahı "alınabilir taş" olarak üretmediği için ayrıca
       şah kontrolü yapılır. */
    const hedefler = this._catalHedefleri(sonrasi, hamle.to, benim)
      .filter(h => this.DEGER[h.tas] >= 3);
    if (sonrasi.in_check() && hedefler.length >= 1 && !sonrasi.in_checkmate()) {
      gerekceler.push(`Çatal: şah çekerken ${this.BELIRTME[hedefler[0].tas]} de vuruyor.`);
    } else if (hedefler.length >= 2) {
      const turler = [...new Set(hedefler.map(h => h.tas))];
      // Aynı türden iki taşta "kale ve kale" demek yerine "iki kale"
      const adlar = turler.length === 1
        ? `${hedefler.length === 2 ? "iki" : hedefler.length} ${this.AD[turler[0]]}`
        : turler.map(t => this.AD[t]).join(" ve ");
      gerekceler.push(`Çatal: ${adlar} aynı anda tehdit altında.`);
    }

    // 5) Şah çekiyor
    if (!sonrasi.in_checkmate() && sonrasi.in_check()) {
      gerekceler.push("Şah çekerek rakibi cevap vermeye zorluyor.");
    }

    // 6) Tehdit altındaki kendi taşını kurtarıyor
    if (!hamle.captured) {
      const tehditVardi = this._saldiranSayisi(chess, hamle.from, rakip) > 0;
      const savunmaYoktu = this._saldiranSayisi(chess, hamle.from, benim) === 0;
      if (tehditVardi && savunmaYoktu && this.DEGER[hamle.piece] >= 3) {
        gerekceler.push(`Tehdit altındaki ${this.BELIRTME[hamle.piece]} güvenli kareye çekiyor.`);
      }
    }

    // 7) Rok
    if (/[kq]/.test(hamle.flags || "")) {
      gerekceler.push("Şahını rok ile güvene alıp kaleyi oyuna sokuyor.");
    }

    // 8) Açılışta geliştirme ve merkez
    const hamleNo = chess.history().length / 2;
    if (hamleNo < 12) {
      const arkaSira = benim === "w" ? "1" : "8";
      if (["n", "b"].includes(hamle.piece) && hamle.from[1] === arkaSira) {
        gerekceler.push(`${this._buyukHarf(this.BELIRTME[hamle.piece])} geliştirerek oyuna sokuyor.`);
      } else if (hamle.piece === "p" && this.MERKEZ.includes(hamle.to)) {
        gerekceler.push("Merkezi piyonla ele geçiriyor — açılışın temel kuralı.");
      }
    }

    // 9) Tek iyi hamle mi? (alternatiflerle fark)
    const altlar = (info && info.altlar) ? info.altlar.filter(Boolean) : [];
    if (gerekceler.length < 2 && altlar.length >= 2 &&
        altlar[0].cp != null && altlar[1].cp != null) {
      const fark = altlar[0].cp - altlar[1].cp;
      if (fark >= 100) gerekceler.push("Bu konumda gerçekten işe yarayan tek hamle bu.");
      else if (fark <= 15) gerekceler.push("Birkaç iyi seçenekten biri; konumu dengede tutuyor.");
    }

    // 10) Hiçbiri yakalanmadıysa konumsal genel açıklama
    if (!gerekceler.length) {
      const skor = info && info.cp != null ? info.cp : 0;
      gerekceler.push(skor > 60 ? "Üstünlüğü artıran sağlam bir konum hamlesi."
                    : skor < -60 ? "Zor konumda en dirençli savunma."
                    : "Konumu geliştiren dengeli bir hamle.");
    }

    return gerekceler.slice(0, 2);
  }
};

/* ------------------------------------------------------------
   YARIM KALAN MAÇ
   ------------------------------------------------------------
   Kaybedeceğini anlayıp uygulamayı kapatan biri ceza almadan
   kurtulmasın diye, dereceli maçlar oynanırken sürekli kaydedilir.
   Uygulama tekrar açıldığında maç kaldığı yerden sunulur:
   devam ederse ceza yok, teslim olursa mağlubiyet işlenir.
   Böylece çökme/pil bitmesi durumunda dürüst kullanıcı mağdur olmaz.
   ------------------------------------------------------------ */
const AktifMac = {
  ASGARI_HAMLE: 4,        // bunun altında kapatmak ceza sayılmaz

  /** Dereceli maç başlarken çağrılır. */
  basla(oyun, mod, ek = {}) {
    Store.data.aktifMac = {
      mod,                                   // "bot" | "net"
      renk: oyun.playerColor || oyun.myColor,
      rakipElo: oyun.rakipElo || null,
      seviye: ek.seviye || null,
      hamleler: [],
      zaman: Date.now()
    };
    Store.save();
  },

  /** Her hamleden sonra ve arka plana geçerken çağrılır. */
  kaydet(oyun) {
    const a = Store.data.aktifMac;
    if (!a) return;
    a.hamleler = oyun.moveList ? oyun.moveList() : [];
    a.rakipElo = oyun.rakipElo || a.rakipElo;
    Store.save();
  },

  /** Maç normal bittiğinde temizlenir. */
  temizle() {
    if (!Store.data.aktifMac) return;
    Store.data.aktifMac = null;
    Store.save();
  },

  /** Açılışta yarım maç var mı? (yalnızca anlamlı uzunluktakiler) */
  varMi() {
    const a = Store.data.aktifMac;
    return !!(a && Array.isArray(a.hamleler) && a.hamleler.length >= this.ASGARI_HAMLE);
  },

  /** Açılışta sorar: devam mı, teslim mi. Kapatılamaz. */
  async sor() {
    if (!this.varMi()) { this.temizle(); return; }
    const a = Store.data.aktifMac;
    const nerede = a.mod === "bot" ? `Bot · ${a.seviye || ""}`.trim() : "Yerel ağ";

    const devam = await Confirm.ask({
      title: "Yarım kalan maçın var",
      text: `${nerede} · ${a.hamleler.length} hamle oynanmıştı. Devam edersen bir kaybın olmaz.`,
      quote: "Maçı yarıda bırakmak mağlubiyet sayılır.",
      icon: "hourglass-half", tone: "is-draw",
      ok: "Devam Et", cancel: "Teslim Ol",
      kapatilamaz: true
    });

    if (devam) this._devamEt(a);
    else this._teslimOl(a);
  },

  _devamEt(a) {
    if (a.mod !== "bot") {
      // Ağ maçı sürdürülemez (rakip bağlantısı koptu) — mağlubiyet yazılır
      Toast.show("Ağ maçı sürdürülemiyor", "info");
      this._teslimOl(a);
      return;
    }
    Router.go("bot");
    Router.screen("botGame");
    const seviye = a.seviye || "Orta";
    const lv = $$("#levelGrid .level").find(x => x.dataset.name === seviye) || $("#levelGrid .level.is-active");
    App.bot.start({ color: a.renk, levelName: seviye });
    App.bot.loadMoves(a.hamleler);
    // start() kaydı sıfırladı; kaldığı yerden devam ettiğimiz için geri yaz
    Store.data.aktifMac = a; Store.save();
    Toast.show("Maç kaldığı yerden devam ediyor", "good");
  },

  _teslimOl(a) {
    const elo = a.rakipElo || 1000;
    const degisim = Rating.uygula(elo, "loss");
    Economy.award("loss");
    this.temizle();
    Toast.show(`Yarım kalan maç mağlubiyet sayıldı (${degisim} Elo)`, "bad", 4500);
  }
};

/* ------------------------------------------------------------
   EKONOMİ
   ------------------------------------------------------------ */
const Economy = {
  REWARD: { win: 50, loss: 25, draw: 35 },

  award(outcome) {
    const amount = this.REWARD[outcome] || 0;
    Store.data.wallet.coins += amount;
    if (outcome === "win")  Store.data.stats.wins++;
    if (outcome === "loss") Store.data.stats.losses++;
    if (outcome === "draw") Store.data.stats.draws++;
    Store.save();
    App.renderWallet(true);
    Sfx.play("coin");
    return amount;
  },

  canAfford(price) { return Store.data.wallet.coins >= price; },

  buy(kind, id) {
    const item = Catalog.find(kind, id);
    if (!item) return { ok: false, error: "Ürün bulunamadı" };

    const invKey = kind === "boards" ? "boards" : "pieces";
    if (Store.data.inventory[invKey].includes(id)) return { ok: false, error: "Zaten sahipsin" };
    if (!this.canAfford(item.price)) return { ok: false, error: "Yetersiz bakiye" };

    Store.data.wallet.coins -= item.price;
    Store.data.inventory[invKey].push(id);
    Store.save();
    App.renderWallet(true);
    return { ok: true, item };
  }
};
/* ------------------------------------------------------------
   S-COIN PAKETLERİ  (gerçek para)
   ------------------------------------------------------------
   Paket tanımları tek yerde durur. `urun` alanı Google Play
   Console'da açılacak ürünün kimliğidir — oradaki kimlikle birebir
   aynı olmak zorunda. `fiyat` yalnızca gösterim içindir; gerçek
   tutarı her zaman mağaza söyler (ülkeye ve para birimine göre
   değişir), bu yüzden mağaza bağlandığında bu yazının yerine
   mağazadan gelen fiyat konur.
   ------------------------------------------------------------ */
const Kasa = {
  PAKETLER: [
    { id: "kese",   ad: "Kese",   coin: 500,  bonus: 0,  fiyat: "₺29,99",  urun: "sahname_coin_500",  ikon: "fa-sack-dollar"  },
    { id: "torba",  ad: "Torba",  coin: 1200, bonus: 20, fiyat: "₺59,99",  urun: "sahname_coin_1200", ikon: "fa-bag-shopping" },
    { id: "sandik", ad: "Sandık", coin: 2600, bonus: 30, fiyat: "₺119,99", urun: "sahname_coin_2600", ikon: "fa-box-open"     },
    { id: "hazine", ad: "Hazine", coin: 7000, bonus: 40, fiyat: "₺249,99", urun: "sahname_coin_7000", ikon: "fa-gem"          }
  ],

  bul(id) { return this.PAKETLER.find(p => p.id === id); },

  /* Satın alınan coini hesaba geçirir.
     `siparis` mağazadan gelen benzersiz sipariş numarasıdır; aynı
     sipariş iki kez işlenmesin diye kaydedilir (uygulama satın alma
     sırasında kapanırsa mağaza aynı siparişi yeniden bildirir). */
  ver(paket, siparis) {
    const c = Store.data.satinAlmalar || (Store.data.satinAlmalar = []);
    if (siparis && c.includes(siparis)) return { ok: false, error: "Bu satın alma zaten işlendi" };
    if (siparis) { c.push(siparis); if (c.length > 50) c.shift(); }

    Store.data.wallet.coins += paket.coin;
    Store.save();
    App.renderWallet(true);
    Sfx.play("coin");
    return { ok: true };
  }
};

/* ------------------------------------------------------------
   ÖDEME KATMANI
   ------------------------------------------------------------
   Android'de uygulama içi satın alma yalnızca Google Play
   Faturalandırma ile yapılabilir; başka bir ödeme yolu (kart formu,
   havale, üçüncü parti cüzdan) Play politikası gereği yasak.
   Faturalandırmanın çalışması için iki şart var:

     1) Uygulama Play Console'da yayımlanmış olmalı,
     2) Kullanıcı uygulamayı Play Store'dan kurmuş olmalı.

   Yandan yüklenen (APK dosyasından kurulan) uygulamada Play
   Faturalandırma bağlanmaz — mağaza uygulamayı tanımaz. Bu yüzden
   aşağıdaki katman eklentiyi arar, bulamazsa satın almayı açmaz ve
   sebebini kullanıcıya dürüstçe söyler. Eklenti kurulduğunda hiçbir
   arayüz kodu değişmez; sadece `eklenti()` onu bulmaya başlar.
   ------------------------------------------------------------ */
const Odeme = {
  eklenti() {
    const P = window.Capacitor && window.Capacitor.Plugins;
    return (P && (P.Purchases || P.GooglePlayBilling || P.InAppPurchase)) || null;
  },

  durum() {
    if (this.eklenti()) return { ok: true };
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    return { ok: false, sebep: native ? "magaza" : "tarayici" };
  },

  /** Mağaza bağlıysa yerel fiyatları çeker ve kartlara yazar. */
  async fiyatlariTazele() {
    const e = this.eklenti();
    if (!e || typeof e.getProducts !== "function") return;
    try {
      const cevap = await e.getProducts({ productIds: Kasa.PAKETLER.map(p => p.urun) });
      ((cevap && cevap.products) || []).forEach(u => {
        const p = Kasa.PAKETLER.find(x => x.urun === (u.productId || u.id));
        if (p && u.price) p.fiyat = u.price;          // mağazanın yerel para birimi
      });
      App.renderCoinPacks();
    } catch (err) { console.warn("Fiyatlar alınamadı:", err); }
  },

  async satinAl(paketId) {
    const paket = Kasa.bul(paketId);
    if (!paket) return;

    const d = this.durum();
    if (!d.ok) { this.kapaliAnlat(d.sebep); return; }

    const e = this.eklenti();
    try {
      const sonuc = await e.purchase({ productId: paket.urun });
      /* Mağaza "satın alındı" demedikçe tek bir coin bile verilmez. */
      const durum = sonuc && (sonuc.state || sonuc.purchaseState || sonuc.status);
      if (!sonuc || (durum && String(durum).toLowerCase() !== "purchased")) {
        Toast.show("Satın alma tamamlanmadı.", "bad");
        return;
      }
      /* Tüketilebilir ürün: onaylanmazsa mağaza üç gün sonra parayı
         iade eder ve aynı ürün bir daha satın alınamaz. */
      if (typeof e.consume === "function") {
        await e.consume({ purchaseToken: sonuc.purchaseToken });
      }
      const r = Kasa.ver(paket, sonuc.orderId || sonuc.purchaseToken);
      Toast.show(r.ok ? `${paket.coin} S hesabına eklendi.` : r.error, r.ok ? "coin" : "bad");
    } catch (err) {
      const yazi = String((err && err.message) || err || "");
      if (!/cancel|iptal/i.test(yazi)) Toast.show("Satın alma başarısız: " + (yazi || "bilinmeyen hata"), "bad");
    }
  },

  /** Satın almanın neden kapalı olduğunu açık açık anlatır. */
  kapaliAnlat(sebep) {
    const text = sebep === "tarayici"
      ? "S-Coin satın alma yalnızca Android uygulamasında çalışır. Tarayıcıda açtığın sürümde ödeme alınamaz."
      : "S-Coin satın alma Google Play üzerinden yapılır; bunun için uygulamanın Play Store'dan kurulmuş olması gerekir. Bu sürüm APK dosyasından kurulduğu için mağaza bağlantısı yok.\n\nTüm temalar ve taş setleri maç kazanarak da açılıyor — satın alma yalnızca kestirme yol.";
    Confirm.ask({
      title: "Satın alma şu an kapalı",
      text,
      icon: "store-slash",
      tone: "is-draw",
      ok: "Anladım",
      tekButon: true
    });
  }
};
/* ------------------------------------------------------------
   REKLAM
   ------------------------------------------------------------
   Yerleşim kuralları (bilerek dar tutuldu):

     • Ödüllü reklam — yalnızca Market'te, kullanıcı isterse.
       İzleyince S-Coin kazandırır. Günlük sınırı var.
     • Afiş (banner) — yalnızca Market sekmesinde. Alt gezinme
       çubuğunun üstüne oturur, içerik onun kadar aşağıdan biter.
     • Geçiş reklamı — yalnızca BOT maçı bittikten sonra, birkaç
       maçta bir ve aralarında en az birkaç dakikayla.

   Nerede reklam YOK: oyun sırasında hiçbir yerde, öğreticide
   hiçbir yerde, yerel ağ maçında hiçbir yerde. Satranç dikkat
   isteyen bir oyun; hamle arasına reklam koymak uygulamayı
   kullanılamaz hâle getirir.

   KİMLİKLER ŞU AN TEST KİMLİĞİDİR. Google'ın herkese açık test
   birimleri gerçek reklam gösterir ama gelir getirmez ve hesabı
   riske atmaz. Yayına çıkarken hem buradaki BIRIM değerleri hem
   de AndroidManifest.xml'deki APPLICATION_ID gerçek AdMob
   kimlikleriyle değiştirilmeli — ikisi birlikte.
   ------------------------------------------------------------ */
const Reklam = {
  BIRIM: {
    gecis:  "ca-app-pub-3940256099942544/1033173712",
    odullu: "ca-app-pub-3940256099942544/5224354917"
  },
  TEST_KIMLIGI: true,          // gerçek kimlikler girilince false yapılacak

  ODUL: 75,                    // izleme başına S-Coin
  GUNLUK_SINIR: 5,             // günde en fazla kaç ödüllü reklam
  GECIS_MAC_ARALIGI: 3,        // kaç bot maçında bir geçiş reklamı
  GECIS_BEKLEME: 180000,       // iki geçiş reklamı arasında en az 3 dakika

  hazir: false, odulluYukleniyor: false,

  _eklenti() {
    const P = window.Capacitor && window.Capacitor.Plugins;
    return (P && P.AdMob) || null;
  },

  kullanilabilir() {
    return !!this._eklenti() &&
           !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  },

  /* Kullanıcı rızası (UMP).
     AB/İngiltere'deki kullanıcılara kişiselleştirilmiş reklam
     gösterebilmek için Google, uygulamanın rıza formunu göstermesini
     ZORUNLU tutuyor; göstermeyen uygulamalarda reklam sunumu kesilir.
     Form yalnızca gerekli bölgelerde çıkar — Türkiye'de kullanıcı
     hiçbir şey görmez, akış sessizce geçer.

     Formun içeriği AdMob panelinden ("Gizlilik ve mesajlaşma")
     tanımlanır; burada yalnızca çağrılır. */
  async _rizaAl() {
    const A = this._eklenti();
    if (!A || typeof A.requestConsentInfo !== "function") return;
    try {
      const bilgi = await A.requestConsentInfo();
      if (bilgi && bilgi.status === "REQUIRED" && bilgi.isConsentFormAvailable) {
        await A.showConsentForm();
      }
    } catch (e) { console.warn("[Reklam] Rıza akışı atlandı:", e); }
  },

  async baslat() {
    if (!this.kullanilabilir()) return;
    try {
      // Rıza önce alınır; reklam isteği ondan sonra yapılır
      await this._rizaAl();
      await this._eklenti().initialize({
        initializeForTesting: this.TEST_KIMLIGI,
        // Gerçek cihazda test reklamı görmek için kendi cihaz kimliğin
        // buraya eklenebilir; test birimleriyle gerekmiyor.
        testingDevices: []
      });
      this.hazir = true;
      this._odulluHazirla();          // ilk izleme anında beklememek için

      App.renderShop();               // ödüllü kartın alt yazısı tazelensin
    } catch (e) { console.warn("[Reklam] Başlatılamadı:", e); }
  },

  /* --- Günlük sayaç --- */
  _bugun() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; },

  _durum() {
    const s = Store.data.reklam || (Store.data.reklam = { gun: "", izlenen: 0, macSayaci: 0, sonGecis: 0 });
    if (s.gun !== this._bugun()) { s.gun = this._bugun(); s.izlenen = 0; }
    return s;
  },

  kalanHak() { return Math.max(0, this.GUNLUK_SINIR - this._durum().izlenen); },

  /* --- Ödüllü reklam --- */
  async _odulluHazirla() {
    if (!this.hazir || this.odulluYukleniyor) return;
    this.odulluYukleniyor = true;
    try {
      await this._eklenti().prepareRewardVideoAd({ adId: this.BIRIM.odullu });
    } catch (e) { console.warn("[Reklam] Ödüllü hazırlanamadı:", e); }
    this.odulluYukleniyor = false;
  },

  async odulluIzle() {
    if (!this.kullanilabilir()) {
      Confirm.ask({
        title: "Reklam şu an yok",
        text: "Ödüllü reklam yalnızca Android uygulamasında çalışır. Tarayıcıda açtığın sürümde gösterilemiyor.",
        icon: "circle-info", ok: "Anladım", tekButon: true
      });
      return;
    }
    if (this.kalanHak() <= 0) {
      Toast.show(`Bugünlük hakkın doldu. Yarın ${this.GUNLUK_SINIR} hak daha.`, "info", 3200);
      return;
    }

    try {
      await this._eklenti().prepareRewardVideoAd({ adId: this.BIRIM.odullu });
      const odul = await this._eklenti().showRewardVideoAd();

      /* Ödül YALNIZCA reklam sonuna kadar izlenirse gelir. Eklenti,
         kullanıcı yarıda kapatırsa ödül nesnesi döndürmez. */
      if (!odul) { Toast.show("Reklam tamamlanmadı, ödül verilmedi.", "info"); return; }

      const s = this._durum();
      s.izlenen++;
      Store.data.wallet.coins += this.ODUL;
      Store.save();
      App.renderWallet(true);
      Sfx.play("coin");
      Toast.show(`+${this.ODUL} S kazandın!`, "coin", 2600);
      this._odulluHazirla();          // sonraki için önden yükle
    } catch (e) {
      console.warn("[Reklam] Ödüllü gösterilemedi:", e);
      Toast.show("Reklam yüklenemedi, internet bağlantını kontrol et.", "bad", 3200);
    }
  },

  /* --- Afiş YOK (bilerek) ---
     Denendi, cihazda şu çıktı: reklam yükleniyor, AdMob gösterim
     bildiriyor, ama görüntü WebView'in ARKASINDA kalıyor. Eklenti afiş
     görünümünü etkinliğin kök katmanına ekliyor ve Capacitor WebView
     onun üstüne çiziliyor. Ekranın hem üstünde hem altında aynı sonuç
     alındı — yani konum değil, katman sorunu.

     Görünmeyen bir reklamın gösterim bildirmesi AdMob geçersiz trafik
     politikasının doğrudan ihlalidir ve hesap kapatma sebebidir. Bu
     yüzden afiş hiç istenmiyor. Ödüllü ve geçiş reklamları tam ekran
     açıldığından bu sorundan etkilenmiyor.

     Afiş ileride istenirse eklentinin Java tarafında afiş görünümünün
     öne alınması gerekir (bringToFront / setElevation). */

  /* --- Geçiş reklamı --- */
  /** Bot maçı bitti; sırası geldiyse geçiş reklamı gösterir. */
  async macBitti() {
    if (!this.hazir) return;
    const s = this._durum();
    s.macSayaci++;
    const sirasiGeldi = s.macSayaci % this.GECIS_MAC_ARALIGI === 0;
    const yeterinceBekledi = Date.now() - (s.sonGecis || 0) > this.GECIS_BEKLEME;
    Store.save();
    if (!sirasiGeldi || !yeterinceBekledi) return;

    try {
      await this._eklenti().prepareInterstitial({ adId: this.BIRIM.gecis, isTesting: this.TEST_KIMLIGI });
      await this._eklenti().showInterstitial();
      s.sonGecis = Date.now();
      Store.save();
    } catch (e) { console.warn("[Reklam] Geçiş gösterilemedi:", e); }
  }
};

/* ------------------------------------------------------------
   SES — fiziksel modelleme (harici dosya yok)
   ------------------------------------------------------------
   Gerçek bir tahta sesi saf tondan (bip) oluşmaz; üç katmanı vardır:
     1) Darbe    — çok kısa geniş bantlı gürültü (tokaç anı)
     2) Tıklama  — 1.5–3 kHz bandı, ~15 ms'de söner (sert temas)
     3) Gövde    — 150–350 Hz rezonans, ~100 ms'de söner (ahşap tınısı)
   Ayrıca her çalışta frekans/şiddet hafifçe rastgeleleşir; aksi halde
   arka arkaya hamlelerde makine gibi tekdüze duyulur.
   ------------------------------------------------------------ */
const Sfx = {
  ctx: null, master: null, gurultu: null,

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();

      /* Ana yol: sıkıştırıcı + yumuşak sınırlayıcı.
         Hızlı hamlelerde sesler üst üste bindiğinde toplam genlik 1'i aşıp
         dijital bozulma (kırpılma) yaratıyordu. Sıkıştırıcı tek başına
         yetmiyor çünkü bu darbeler çok ani; sona bir doyum eğrisi koyup
         sinyalin asla 1'i geçmemesini garanti ediyoruz. */
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 16;
      comp.ratio.value = 8; comp.attack.value = 0.0008; comp.release.value = 0.15;

      const sinirlayici = this.ctx.createWaveShaper();
      const n = 1024, egri = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        egri[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);   // yumuşak doyum
      }
      sinirlayici.curve = egri;
      sinirlayici.oversample = "2x";

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.75;
      this.master.connect(comp).connect(sinirlayici).connect(this.ctx.destination);

      this.gurultu = this._gurultuTamponu(1);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  /** Bir saniyelik beyaz gürültü — tüm darbelerde yeniden kullanılır. */
  _gurultuTamponu(saniye) {
    const n = Math.floor(this.ctx.sampleRate * saniye);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  _r(taban, sapma) { return taban * (1 + (Math.random() * 2 - 1) * sapma); },

  /* Bant geçiren filtre gürültünün büyük kısmını süzdüğü için çıkış
     seviyesi çok düşer; bu katsayı o kaybı telafi eder. */
  GURULTU_TELAFI: 6.5,

  /* Ses başına denge katsayıları.
     Katmanların sayısı ve filtre kayıpları her efektte farklı olduğu için
     ham kazançlar aynı olsa bile duyulan şiddet eşit çıkmıyor. Bu değerler
     her efekt tek tek ölçülüp hedef seviyeye getirilerek belirlendi. */
  SEVIYE: {
    move: 2.80, capture: 1.45, castle: 0.68, check: 2.55,
    mate: 1.70, coin: 3.30, error: 5.90, tap: 4.80
  },
  _carpan: 1,

  /** Filtrelenmiş gürültü patlaması (darbe/tıklama katmanı). */
  _patlama({ freq, q = 1.4, tip = "bandpass", sure = 0.03, gain = 0.3, gecikme = 0 }) {
    gain *= this.GURULTU_TELAFI * this._carpan;
    const ctx = this.ctx, t = ctx.currentTime + gecikme;
    const src = ctx.createBufferSource();
    src.buffer = this.gurultu;
    src.playbackRate.value = this._r(1, 0.15);

    const f = ctx.createBiquadFilter();
    f.type = tip; f.frequency.value = freq; f.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0012);      // ani atak
    g.gain.exponentialRampToValueAtTime(0.0001, t + sure); // hızlı sönüm

    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + sure + 0.02);
  },

  /** Sönümlü rezonans (ahşap gövde / metal tını). */
  _rezonans({ freq, sure = 0.1, gain = 0.18, tip = "triangle", gecikme = 0, kayma = 0 }) {
    gain *= this._carpan;
    const ctx = this.ctx, t = ctx.currentTime + gecikme;
    const osc = ctx.createOscillator();
    osc.type = tip;
    osc.frequency.setValueAtTime(freq, t);
    if (kayma) osc.frequency.exponentialRampToValueAtTime(freq * kayma, t + sure);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sure);

    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + sure + 0.02);
  },

  /**
   * Ahşap taşın tahtaya konma sesi.
   * @param {number} siddet 0.6 normal, 1.0 sert (alış), 1.3 çok sert
   */
  _tahtaVurusu(siddet = 1, gecikme = 0) {
    /* Rastgelelik bilinçli ama ölçülü: tamamen sabit olursa makine gibi,
       çok geniş olursa ses şiddeti hamleden hamleye zıplıyor. */
    // 1) Sert temas tıklaması
    this._patlama({ freq: this._r(2400, 0.09), q: 1.1, sure: 0.018 * this._r(1, .12),
                    gain: 0.30 * siddet, gecikme });
    // 2) Orta bant gövde darbesi
    this._patlama({ freq: this._r(760, 0.08), q: 0.9, sure: 0.045 * this._r(1, .12),
                    gain: 0.26 * siddet, gecikme: gecikme + 0.002 });
    // 3) Alçak ahşap rezonansı
    this._rezonans({ freq: this._r(196, 0.06), sure: 0.11 * this._r(1, .15),
                     gain: 0.34 * siddet, tip: "triangle", gecikme: gecikme + 0.003, kayma: 0.82 });
    // 4) Tahtanın altındaki derin tok ses
    this._rezonans({ freq: this._r(96, 0.05), sure: 0.075, gain: 0.24 * siddet,
                     tip: "sine", gecikme: gecikme + 0.004, kayma: 0.8 });
  },

  play(name) {
    if (!Store.data || !Store.data.settings.sound) return;
    if (!this._ensure()) return;
    this._carpan = this.SEVIYE[name] || 1;

    switch (name) {
      // Taşın tahtaya konması
      case "move":
        this._tahtaVurusu(0.85);
        break;

      // Alış: iki taşın çarpışması + konma (iki vuruş, çok kısa arayla)
      case "capture":
        this._patlama({ freq: this._r(3200, 0.2), q: 0.8, sure: 0.02, gain: 0.26 });
        this._tahtaVurusu(1.15);
        this._tahtaVurusu(0.55, 0.055);
        break;

      // Rok: iki taş art arda
      case "castle":
        this._tahtaVurusu(0.8);
        this._tahtaVurusu(0.7, 0.115);
        break;

      // Şah: tahta vuruşu + gergin, alçak bir uyarı
      case "check":
        this._tahtaVurusu(1.0);
        this._rezonans({ freq: 330, sure: 0.16, gain: 0.10, tip: "sine", gecikme: 0.03 });
        this._rezonans({ freq: 494, sure: 0.20, gain: 0.09, tip: "sine", gecikme: 0.09 });
        break;

      // Mat: kesin, derin ve uzun tınlayan son vuruş
      case "mate":
        this._tahtaVurusu(1.25);
        this._rezonans({ freq: 146, sure: 0.55, gain: 0.30, tip: "triangle", gecikme: 0.02, kayma: 0.72 });
        this._rezonans({ freq: 220, sure: 0.45, gain: 0.18, tip: "sine", gecikme: 0.05, kayma: 0.75 });
        this._rezonans({ freq: 73,  sure: 0.70, gain: 0.24, tip: "sine", gecikme: 0.03, kayma: 0.85 });
        break;

      // Madeni para: uyumsuz üst harmoniklerle metalik tını
      case "coin":
        this._patlama({ freq: 5200, q: 2.5, sure: 0.02, gain: 0.10 });
        [2340, 3510, 4790].forEach((f, i) =>
          this._rezonans({ freq: f, sure: 0.34 - i * 0.06, gain: 0.16 - i * 0.04,
                           tip: "sine", gecikme: i * 0.006 }));
        break;

      // Hata: boğuk, alçak tıkanma
      case "error":
        this._patlama({ freq: 220, q: 1.2, tip: "lowpass", sure: 0.10, gain: 0.09 });
        this._rezonans({ freq: 128, sure: 0.14, gain: 0.26, tip: "sawtooth", kayma: 0.6 });
        break;

      // Arayüz dokunuşu: çok hafif tık
      case "tap":
        this._patlama({ freq: this._r(3000, 0.15), q: 1.6, sure: 0.012, gain: 0.055 });
        this._rezonans({ freq: this._r(480, 0.1), sure: 0.03, gain: 0.10, tip: "sine" });
        break;
    }
  }
};

/* ------------------------------------------------------------
   TİTREŞİM
   ------------------------------------------------------------ */
const Haptics = {
  // Tarayıcı, gerçek bir dokunuş olmadan vibrate() çağrısını reddedip
  // konsola uyarı basar. Bu yüzden ilk kullanıcı etkileşimini bekliyoruz.
  userReady: false,

  arm() {
    if (this.userReady) return;
    this.userReady = true;
  },

  tap(pattern = 8) {
    if (!this.userReady) return;
    if (!Store.data || !Store.data.settings.vibrate) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }
};

/* ------------------------------------------------------------
   BİLDİRİM (toast)
   ------------------------------------------------------------ */
const Toast = {
  host: null,
  show(text, kind = "info", ms = 2400) {
    if (!this.host) this.host = $("#toastHost");
    const el = document.createElement("div");
    el.className = "toast toast--" + kind;
    const icon = { info: "circle-info", good: "circle-check", bad: "circle-exclamation", coin: "coins" }[kind] || "circle-info";
    // Metin DAİMA textContent ile basılır — bildirimlere ağdan/depodan
    // gelen veri karışabildiği için HTML olarak yorumlanmamalı.
    const i = document.createElement("i");
    i.className = "fa-solid fa-" + icon;
    const sp = document.createElement("span");
    sp.textContent = String(text ?? "");
    el.append(i, sp);
    this.host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    setTimeout(() => {
      el.classList.remove("is-in");
      setTimeout(() => el.remove(), 250);
    }, ms);
  }
};

/* ------------------------------------------------------------
   ONAY PENCERESİ
   Yanlışlıkla basmaları önler. Promise<boolean> döndürür.
   ------------------------------------------------------------ */
const Confirm = {
  el: null, resolve: null,

  init() {
    this.el = $("#confirmModal");
    $("#cfCancel").onclick = () => this._done(false);
    $("#cfOk").onclick     = () => this._done(true);
    // Kapatılamaz pencerelerde dışarı tıklamak işe yaramaz
    this.el.addEventListener("click", e => {
      if (e.target === this.el && !this.kapatilamaz) this._done(false);
    });
  },

  /**
   * @param {{title, text, list?:string[], quote?:string, ok?:string, cancel?:string, icon?:string, tone?:string}} o
   * @returns {Promise<boolean>}
   */
  ask(o) {
    this.kapatilamaz = !!o.kapatilamaz;
    $("#cfTitle").textContent = o.title || "Emin misin?";
    $("#cfText").textContent  = o.text || "";
    $("#cfIcon").className = "modal__icon " + (o.tone || "is-draw");
    $("#cfIcon").innerHTML = `<i class="fa-solid fa-${o.icon || "circle-question"}"></i>`;

    const list = $("#cfList");
    if (o.list && o.list.length) {
      list.innerHTML = o.list.map(x => `<div class="cf-item"><i class="fa-solid fa-xmark"></i> ${x}</div>`).join("");
      list.hidden = false;
    } else list.hidden = true;

    const q = $("#cfQuote");
    if (o.quote) { q.textContent = o.quote; q.hidden = false; } else q.hidden = true;

    $("#cfOk").textContent     = o.ok || "Evet";
    $("#cfCancel").textContent = o.cancel || "Vazgeç";
    // Bilgi penceresi: soru sorulmuyorsa "Vazgeç" anlamsız olur
    $("#cfCancel").hidden = !!o.tekButon;

    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add("is-open"));
    return new Promise(res => { this.resolve = res; });
  },

  _done(v) {
    this.el.classList.remove("is-open");
    setTimeout(() => { this.el.hidden = true; }, 200);
    const r = this.resolve; this.resolve = null;
    if (r) r(v);
  }
};

/* ------------------------------------------------------------
   MAÇ GEÇMİŞİ — yalnızca son 5 maç saklanır
   ------------------------------------------------------------ */
const History = {
  MAX: 5,

  /** Biten bir maçı kaydeder (en eskisi silinir). */
  save(game, outcome, reason, label) {
    const moves = game.moveList();
    if (!moves.length) return;
    const list = Store.data.history;
    list.unshift({
      id: Date.now(),
      moves, outcome, reason,
      label: label || "Maç",
      color: game.playerColor || game.myColor || "w",
      date: new Date().toISOString()
    });
    if (list.length > this.MAX) list.length = this.MAX;   // fazlası silinir
    Store.save();
    App.renderHistory();
  },

  clear() { Store.data.history = []; Store.save(); App.renderHistory(); }
};

/* ------------------------------------------------------------
   ÜRÜN ÖNİZLEME
   Satın almadan önce temayı küçük bir tahtada gösterir.
   ------------------------------------------------------------ */
const Preview = {
  el: null, current: null,
  LAYOUT: ["rnbqkbnr", "pppppppp", "········", "········", "····P···", "·····N··", "PPPP·PPP", "RNBQKB·R"],
  GLYPH: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },

  init() {
    this.el = $("#previewModal");
    $("#pvClose").onclick = () => this.hide();
    this.el.addEventListener("click", e => { if (e.target === this.el) this.hide(); });
    $("#pvBuy").onclick = () => {
      if (!this.current) return;
      const { kind, id } = this.current;
      this.hide();
      App.buyItem(kind, id);
    };
  },

  show(kind, id) {
    const item = Catalog.find(kind, id);
    if (!item) return;
    this.current = { kind, id };

    const owned = Store.data.inventory[kind].includes(id);
    $("#pvTitle").textContent = item.name;
    const nad = Nadirlik.bilgi(item.r);
    $("#pvSub").textContent = (kind === "boards" ? "Tahta teması" : "Taş seti") + " · " + nad.ad;
    const rz = $("#pvRarity");
    if (rz) { rz.className = "rarity rarity--" + item.r; rz.innerHTML = `<i class="fa-solid ${nad.ikon}"></i> ${nad.ad}`; }

    // Önizleme tahtası: temalar data-* niteliklerinden gelir
    const wrap = $("#pvWrap");
    wrap.dataset.board  = kind === "boards" ? id : Store.data.theme.board;
    wrap.dataset.pieces = kind === "pieces" ? id : Store.data.theme.pieces;

    const board = $("#pvBoard");
    board.innerHTML = this.LAYOUT.map((row, r) =>
      [...row].map((ch, f) => {
        const light = (r + f) % 2 === 0;
        const pc = ch === "·" ? "" :
          `<span class="pc ${ch === ch.toUpperCase() ? "pc--w" : "pc--b"}">${this.GLYPH[ch.toLowerCase()]}</span>`;
        return `<div class="sq ${light ? "sq--l" : "sq--d"}">${pc}</div>`;
      }).join("")).join("");

    const price = $("#pvPrice");
    const buy = $("#pvBuy");
    if (owned) {
      price.innerHTML = '<i class="fa-solid fa-check"></i> Bu ürüne sahipsin';
      price.className = "pv-price is-owned";
      buy.textContent = "Kullan";
      buy.onclick = () => { this.hide(); Theme.select(kind === "boards" ? "board" : "pieces", id); };
    } else {
      const afford = Economy.canAfford(item.price);
      price.innerHTML = `<i class="fa-solid fa-coins"></i> ${item.price} S` +
                        (afford ? "" : ' <span class="pv-warn">— bakiyen yetmiyor</span>');
      price.className = "pv-price";
      buy.textContent = afford ? "Satın Al" : "Yetersiz Bakiye";
      buy.disabled = !afford;
      buy.onclick = () => { const c = this.current; this.hide(); App.buyItem(c.kind, c.id); };
    }

    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add("is-open"));
  },

  hide() {
    this.el.classList.remove("is-open");
    setTimeout(() => { this.el.hidden = true; }, 200);
    $("#pvBuy").disabled = false;
  }
};

/* ------------------------------------------------------------
   QR TARAYICI
   ------------------------------------------------------------
   Önce tarayıcının yerleşik BarcodeDetector API'si denenir (hızlı),
   yoksa jsQR kütüphanesi CDN'den yüklenir.

   ÖNEMLİ: Kamera erişimi yalnızca "güvenli bağlam"da çalışır
   (https:// veya localhost). Yerel ağda http://192.168.x.x ile
   açıldığında tarayıcı kamerayı ENGELLER — bu durumda kullanıcı
   koda elle yönlendirilir. Uygulama olarak paketlendiğinde
   (WebView/Capacitor) bu kısıt ortadan kalkar.
   ------------------------------------------------------------ */
const Scanner = {
  el: null, video: null, stream: null, raf: null, detector: null,
  onResult: null, running: false,

  init() {
    this.el = $("#scanModal");
    this.video = $("#scanVideo");
    $("#scanClose").onclick = () => this.close();
    this.el.addEventListener("click", e => { if (e.target === this.el) this.close(); });
  },

  /** Kamera bu ortamda kullanılabilir mi? */
  availability() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return { ok: false, reason: "Bu tarayıcı kamera erişimini desteklemiyor." };
    if (!window.isSecureContext)
      return { ok: false, reason: "Tarayıcılar kamerayı yalnızca güvenli adreslerde (https veya localhost) açar. Yerel ağ adresiyle girdiğin için kamera kapalı — oda kodunu elle yazabilirsin." };
    return { ok: true };
  },

  /**
   * @param {function} onResult
   * @param {{ham?:boolean}} [opt] - ham:true ise QR içeriği olduğu gibi verilir
   *        (WebRTC el sıkışma kodları için); yoksa 4 haneli oda kodu aranır.
   */
  async open(onResult, opt = {}) {
    const av = this.availability();
    if (!av.ok) { Toast.show(av.reason, "bad", 5200); Sfx.play("error"); return false; }

    this.ham = !!opt.ham;
    this.onResult = onResult;
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add("is-open"));
    $("#scanStatus").textContent = "Kamera açılıyor…";

    try {
      /* 1280x720 bilinçli seçim: 1080p'den hızlı işlenir ama QR'ı
         okumaya fazlasıyla yeter. Sürekli otomatik netleme yakın
         mesafede okumayı belirgin hızlandırır. */
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          focusMode: { ideal: "continuous" }
        },
        audio: false
      });
      this.video.srcObject = this.stream;
      this.video.setAttribute("playsinline", "");
      await this.video.play();

      // Desteklenen cihazlarda sürekli netlemeyi ayrıca zorla
      try {
        const iz = this.stream.getVideoTracks()[0];
        const yetenek = iz.getCapabilities ? iz.getCapabilities() : {};
        const ayar = {};
        if (yetenek.focusMode && yetenek.focusMode.includes("continuous")) ayar.focusMode = "continuous";
        if (Object.keys(ayar).length) await iz.applyConstraints({ advanced: [ayar] });
      } catch (_) { /* cihaz desteklemiyorsa sorun değil */ }

      $("#scanStatus").textContent = "QR kodu çerçeveye getir";
    } catch (err) {
      $("#scanStatus").textContent = "Kamera açılamadı: " + (err.name === "NotAllowedError" ? "izin verilmedi" : err.message);
      return false;
    }

    /* Çözücü seçimi.
       Android'de BarcodeDetector "var" görünüp hiç sonuç döndürmeyebiliyor:
       arayüz WebView'de tanımlı ama arkasındaki Play Services barkod modülü
       cihaza inmemişse detect() sonsuza kadar boş dizi döner. Dışarıdan bu
       "QR hiç okunmuyor" diye görünür. Bu yüzden jsQR HER ZAMAN önceden
       yükleniyor ve dedektör birkaç saniye boyunca hiçbir şey bulamazsa
       sessizce ona geçiliyor. */
    this.detector = null;
    this._detektorBos = 0;
    if (typeof BarcodeDetector === "function") {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) this.detector = new BarcodeDetector({ formats: ["qr_code"] });
      } catch (_) { this.detector = null; }
    }
    try { await this._loadJsQr(); }
    catch (_) {
      if (!this.detector) { $("#scanStatus").textContent = "QR çözücü yüklenemedi"; return false; }
    }

    this.running = true;
    this._loop();
    return true;
  },

  _loadJsQr() {
    if (window.jsQR) return Promise.resolve();
    if (this._jsqrP) return this._jsqrP;
    this._jsqrP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "vendor/jsQR.js";            // uygulamanın içinde
      s.onload = res; s.onerror = () => rej(new Error("jsQR yüklenemedi"));
      document.head.appendChild(s);
    });
    return this._jsqrP;
  },

  /* Taramanın hızı doğrudan işlenen piksel sayısına bağlı.
     Telefon kamerası 1920x1080 (≈2 MP) veriyor; jsQR bu boyutta kare
     başına yüzlerce ms harcıyor ve okuma "çalışmıyor" gibi hissettiriyor.
     Bu yüzden ekrandaki çerçeveye denk gelen MERKEZ KARE kırpılıp
     ~400 piksele küçültülüyor: işlenen alan ~25 kat azalıyor. */
  /* Ölçüm sonucu seçildi. Eşleşme QR'ı sıkıştırılmış SDP taşıdığı için
     büyük (~97 modül); tarama boyu düştükçe modül başına piksel azalıyor
     ve uzaktan tutulan kod okunmuyor. Sahte kamera sahneleriyle ölçüm:
        320px → 3/6 sahne okundu, 26 ms/kare
        400px → 4/6,               25 ms
        560px → 5/6,               32 ms   ← seçildi
        640px → 5/6,               35 ms
     560, 720p görüntüde merkez kırpımını hiç küçültmeden bırakıyor
     (kırpım zaten 518 piksel), yani yeniden örnekleme kaybı da yok. */
  TARAMA_BOYU: 560,

  /* İki tarama alanı dönüşümlü kullanılıyor:
       "cerceve" — ekrandaki altın çerçeveye denk gelen merkez kare.
                   Modül başına daha çok piksel düşer, uzaktan okur.
       "tam"     — görüntünün tamamı. Kod çerçevenin biraz dışında
                   kalmışsa yalnızca bu yakalar.
     İkisi de aynı ~400 piksele indirildiği için maliyet eşit. */
  _kareAl(v, mod) {
    const kenar = Math.min(v.videoWidth, v.videoHeight);
    const kirp = mod === "tam" ? kenar : Math.round(kenar * 0.72);
    const sx = Math.round((v.videoWidth - kirp) / 2);
    const sy = Math.round((v.videoHeight - kirp) / 2);
    const boy = Math.min(this.TARAMA_BOYU, kirp);

    const c = this._canvas || (this._canvas = document.createElement("canvas"));
    if (c.width !== boy) { c.width = boy; c.height = boy; }
    const ctx = this._ctx || (this._ctx = c.getContext("2d", { willReadFrequently: true }));
    ctx.drawImage(v, sx, sy, kirp, kirp, 0, 0, boy, boy);
    return ctx.getImageData(0, 0, boy, boy);
  },

  async _loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
      let text = null;
      try {
        if (this.detector) {
          const codes = await this.detector.detect(v);
          if (codes.length) text = codes[0].rawValue;
          else if (window.jsQR && ++this._detektorBos > 45) {
            /* ~1,5 saniyedir hiçbir şey bulamadı: bu cihazda dedektör
               çalışmıyor olabilir. Sessizce jsQR'a geç, tarama durmasın. */
            this.detector = null;
            console.warn("[QR] BarcodeDetector sonuç vermiyor, jsQR'a geçildi.");
          }
        }
        if (!this.detector && window.jsQR) {
          /* Alan ve kontrast dönüşümlü taranıyor: kare başına tek bir
             çözüm denemesi yapılıyor ki hız düşmesin. */
          this._sayac = (this._sayac || 0) + 1;
          // Çerçeve kırpımı ölçümlerde her zaman daha iyi okudu; asıl yol o.
          // Tam kare yalnızca güvenlik ağı, ters kontrast daha da seyrek.
          const mod  = (this._sayac % 4) === 0 ? "tam" : "cerceve";
          const ters = (this._sayac % 7) === 0;
          const img = this._kareAl(v, mod);
          /* DİKKAT — "onlyInvert" KULLANILMAYACAK.
             vendor/jsQR.js'te shouldInvert yalnızca attemptBoth/invertFirst
             için açılıyor, ama tryInvertedFirst onlyInvert için de açılıyor.
             Sonuç: binarize ters matrisi hiç üretmiyor, scan(undefined)
             çağrılıyor ve fonksiyon istisna fırlatıyor. Eski kod karelerin
             yarısında bunu yapıyordu; hata yakalanıp yutulduğu için tarama
             sessizce yarı yarıya boşa gidiyordu. "attemptBoth" güvenli:
             ters matrisi gerçekten üretiyor. */
          const found = jsQR(img.data, img.width, img.height,
            { inversionAttempts: ters ? "attemptBoth" : "dontInvert" });
          if (found) text = found.data;
        }
      } catch (_) { /* kare atlanabilir */ }

      if (text) {
        // Ham modda WebRTC el sıkışma kodu beklenir (O. / A. ön ekli)
        const sonuc = this.ham
          ? (/^[OoAa]\./.test(text.trim()) ? text.trim() : null)
          : Scanner.extractCode(text);
        if (sonuc) {
          Sfx.play("coin"); Haptics.tap([15, 40, 15]);
          const cb = this.onResult;
          this.close();
          if (cb) cb(sonuc);
          return;
        }
        $("#scanStatus").textContent = this.ham
          ? "Bu QR bir bağlantı kodu değil"
          : "Bu QR bir oda kodu içermiyor";
      }
    }
    this.raf = requestAnimationFrame(() => this._loop());
  },

  /** QR içeriğinden 4 haneli oda kodunu ayıklar. */
  extractCode(text) {
    const m = /join-([A-Z0-9]{4})/i.exec(text) || /^\s*([A-Z0-9]{4})\s*$/i.exec(text);
    return m ? m[1].toUpperCase() : null;
  },

  close() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.video.srcObject = null;
    this.el.classList.remove("is-open");
    setTimeout(() => { this.el.hidden = true; }, 200);
  }
};

/* ------------------------------------------------------------
   OYUN SONU PENCERESİ
   ------------------------------------------------------------ */
const GameOver = {
  el: null, onAgain: null,

  init() {
    this.el = $("#gameOverModal");
    $("#goClose").onclick = () => this.hide();
    $("#goAgain").onclick = () => { this.hide(); if (this.onAgain) this.onAgain(); };
    $("#goAnalyze").onclick = () => { this.hide(); if (this.analyzeSrc) App.analyzeGame(this.analyzeSrc); };
  },

  /**
   * outcome: "win" | "loss" | "draw"
   * @param {GameBase} [source]   - verilirse "Maçı Analiz Et" butonu görünür
   * @param {boolean}  [rewarded] - false ise S verilmez (aynı cihazda oyun)
   */
  show(outcome, reason, onAgain, source, rewarded = true) {
    this.onAgain = onAgain;
    this.analyzeSrc = source || null;
    $("#goAnalyze").hidden = !(source && source.moveList().length);

    const cfg = {
      win:  { icon: "crown",      title: "Kazandın!", cls: "is-win" },
      loss: { icon: "face-frown", title: "Kaybettin", cls: "is-loss" },
      draw: { icon: "handshake",  title: "Berabere",  cls: "is-draw" }
    }[outcome];

    $("#goIcon").className = "modal__icon " + cfg.cls;
    $("#goIcon").innerHTML = `<i class="fa-solid fa-${cfg.icon}"></i>`;
    $("#goTitle").textContent = cfg.title;
    $("#goText").textContent = reason;

    // --- Derece (Elo) ---
    const eloKutu = $("#goEloBox");
    if (rewarded && source && source.rakipElo) {
      const oncekiElo = Store.data.rating.elo;
      const degisim = Rating.uygula(source.rakipElo, outcome);
      $("#goEloOld").textContent = oncekiElo;
      $("#goEloNew").textContent = Store.data.rating.elo;
      const d = $("#goEloDelta");
      d.textContent = (degisim >= 0 ? "+" : "") + degisim;
      d.className = "elo-delta " + (degisim > 0 ? "is-up" : degisim < 0 ? "is-down" : "");
      eloKutu.hidden = false;
      this._kaliteBonusu(source);          // arka planda ölçülür
    } else {
      eloKutu.hidden = true;
    }

    const rw = $("#goReward");
    if (rewarded) {
      const amount = Economy.award(outcome);
      rw.innerHTML = `<i class="fa-solid fa-coins"></i> +${amount} S`;
      rw.hidden = false;
    } else {
      // Aynı cihazda oynanan maçlarda S verilmez
      rw.innerHTML = `<i class="fa-solid fa-mobile-screen"></i> Aynı cihaz maçı — S verilmez`;
      rw.hidden = false;
      rw.classList.add("is-muted");
    }
    if (rewarded) rw.classList.remove("is-muted");

    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add("is-open"));
    Sfx.play(outcome === "win" ? "mate" : "coin");
  },

  /**
   * Maç bitince oyuncunun hamle kalitesini arka planda ölçer ve
   * küçük bir ek derece puanı verir. Pencere beklemez — sonuç
   * hazır olunca satır güncellenir.
   */
  async _kaliteBonusu(source) {
    const satir = $("#goBonusRow"), metin = $("#goBonusText"), delta = $("#goBonusDelta");
    const renk = source.playerColor || source.myColor;
    const hamleler = source.moveList ? source.moveList() : [];
    if (!renk || hamleler.length < 4) { satir.hidden = true; return; }

    satir.hidden = false;
    metin.textContent = "ölçülüyor…";
    delta.textContent = "";

    const ortKayip = await Rating.kaliteOlc(hamleler, renk);
    if (ortKayip == null) { satir.hidden = true; return; }

    const puan = Rating.bonusHesapla(ortKayip);
    Rating.bonusUygula(puan);

    const etiket = ortKayip <= 20 ? "kusursuza yakın" : ortKayip <= 40 ? "çok iyi"
                 : ortKayip <= 70 ? "iyi" : ortKayip <= 120 ? "orta" : "gelişmeli";
    metin.textContent = `${etiket} · ort. ${ortKayip} cp kayıp`;
    delta.textContent = puan > 0 ? "+" + puan : "0";
    delta.className = "elo-delta " + (puan > 0 ? "is-up" : "");

    // Toplam dereceyi tazele
    $("#goEloNew").textContent = Store.data.rating.elo;
    if (puan > 0) Sfx.play("coin");
  },

  hide() {
    this.el.classList.remove("is-open");
    setTimeout(() => { this.el.hidden = true; }, 220);
  }
};

/* ------------------------------------------------------------
   TEMA
   ------------------------------------------------------------ */
const Theme = {
  apply() {
    const root = document.documentElement;
    root.dataset.board  = Store.data.theme.board;
    root.dataset.pieces = Store.data.theme.pieces;
  },

  select(kind, id) {
    const invKey = kind === "board" ? "boards" : "pieces";
    if (!Store.data.inventory[invKey].includes(id)) {
      Toast.show("Bu tema kilitli — Market'ten satın al", "bad");
      Sfx.play("error");
      return false;
    }
    Store.data.theme[kind === "board" ? "board" : "pieces"] = id;
    Store.save();
    Theme.apply();
    App.renderSwatches();
    Haptics.tap();
    Sfx.play("tap");
    return true;
  }
};

/* ------------------------------------------------------------
   YÖNLENDİRİCİ
   ------------------------------------------------------------ */
const Router = {
  tabs: [], views: {}, indicator: null, current: "learn",

  init() {
    this.tabs = $$(".tab");
    this.indicator = $("#tabIndicator");
    $$(".view").forEach(v => { this.views[v.dataset.tab] = v; });

    this.tabs.forEach((btn, i) => {
      btn.addEventListener("click", () => { Haptics.tap(); Sfx.play("tap"); this.go(btn.dataset.tab, i); });
    });
    window.addEventListener("hashchange", () => this.fromHash());
    window.addEventListener("resize", () => this.moveIndicator(this.indexOf(this.current)));
    this.fromHash();
  },

  indexOf(tab) { return this.tabs.findIndex(t => t.dataset.tab === tab); },

  fromHash() {
    const tab = (location.hash || "").replace("#/", "") || "learn";
    const i = this.indexOf(tab);
    this.go(i >= 0 ? tab : "learn", i >= 0 ? i : 0, true);
  },

  go(tab, index, silent = false) {
    if (index == null) index = this.indexOf(tab);
    if (index < 0) return;
    this.current = tab;

    this.tabs.forEach((btn, i) => {
      const on = i === index;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    Object.entries(this.views).forEach(([k, v]) => v.classList.toggle("is-active", k === tab));
    this.views[tab].scrollTop = 0;
    this.moveIndicator(index);
    if (!silent) location.hash = "#/" + tab;
    document.dispatchEvent(new CustomEvent("tab:enter", { detail: { tab } }));
  },

  moveIndicator(i) { if (this.indicator && i >= 0) this.indicator.style.transform = `translateX(${i * 100}%)`; },

  /** Sekme içi alt ekran geçişi */
  screen(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const parent = el.closest(".view");
    $$(".screen", parent).forEach(s => s.classList.remove("is-active"));
    el.classList.add("is-active");
    parent.scrollTop = 0;
  }
};

/* ------------------------------------------------------------
   AÇILIŞ EKRANI
   ------------------------------------------------------------
   Motor yüklenirken gösterilir. Motor gelmese bile en fazla
   birkaç saniye sonra kapanır — uygulama asla kilitli kalmaz.
   ------------------------------------------------------------ */
const Splash = {
  el: null, bar: null, status: null, kapandi: false, MAX: 6000,

  init() {
    this.el = $("#splash");
    this.bar = $("#splashBar");
    this.status = $("#splashStatus");
    if (!this.el) return;
    // Güvenlik: ne olursa olsun kapan
    this._zamanlayici = setTimeout(() => this.kapat("zaman aşımı"), this.MAX);
    this.ilerlet(15);
  },

  ilerlet(yuzde, metin) {
    if (this.bar) this.bar.style.width = Math.min(100, yuzde) + "%";
    if (metin && this.status) this.status.textContent = metin;
  },

  kapat(sebep) {
    if (this.kapandi || !this.el) return;
    this.kapandi = true;
    clearTimeout(this._zamanlayici);
    this.ilerlet(100);
    // Son kare görünsün diye kısa bir bekleme
    setTimeout(() => {
      this.el.classList.add("is-done");
      setTimeout(() => { this.el.remove(); }, 500);
    }, 180);
    if (sebep) console.log("[Açılış] Kapandı:", sebep);
  }
};

/* ------------------------------------------------------------
   KAYDIRARAK SEKME GEÇİŞİ
   ------------------------------------------------------------
   Parmakla yatay sürükleyince sekmeler kayarak değişir.
   • Yalnızca yatay hareket baskınsa devreye girer (dikey kaydırma bozulmaz)
   • Tahta ve metin alanları hariç tutulur (yanlışlıkla geçişi önler)
   • Pencere açıkken kapalıdır
   ------------------------------------------------------------ */
const Swipe = {
  host: null, width: 0,
  startX: 0, startY: 0, dx: 0,
  active: false, locked: false, decided: false,
  from: null, to: null,

  /* Kaydırmayı engelleyen öğeler — DAR tutulmalı.
     Yalnızca dokunuşun anlamı değişen yerler: tahta (taş seçimi) ve
     metin alanları (imleç/seçim). Izgaralar ve listeler kaydırmayı
     geçirir; aksi halde ekranın çoğunda hareket ölü kalıyordu. */
  BLOCK: ".board, input, textarea, .pgn-box, .scan-view",

  init() {
    this.host = $("#views");

    /* Dokunmatik cihazda YALNIZCA touch olayları kullanılıyor; ikisi
       birden dinlenmiyor. Sebep cihazda ölçüldü:

         1169ms pointerdown
         1200ms pointercancel   ← dokunuştan 31 ms sonra
         1433ms touchend

       Parmak biraz da dikey hareket ettiğinde (gerçek parmakta hep öyle
       olur) Chrome yatay sürüklemeyi kendi dikey kaydırması sanıp pointer
       akışını kesiyor. O anda hareket ölüyor, görünüm de animasyonsuz
       yerine zıplıyordu — ekranda "kayıp geri sıçrama" olarak görünen
       şey buydu. Aynı harekette touch olayları hiç kesilmiyor ve iptal
       edilebilir kalıyor (ölçümde 23 olayın hepsi), bu yüzden sürükleme
       onların üzerinden yürütülüyor.

       Ayrıca ikisini birden dinlemek her hareketi iki kez işliyordu ve
       kopya örnek hız hesabını yarıya düşürüyordu. */
    this.dokunmatik = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    if (this.dokunmatik) {
      this.host.addEventListener("touchstart", e => {
        if (e.touches.length !== 1) return;
        this.onDown(this._touchOlay(e));
      }, { passive: true });
      this.host.addEventListener("touchmove", e => {
        if (!this.active || e.touches.length !== 1) return;
        this.onMove(this._touchOlay(e, true));
      }, { passive: false });
      this.host.addEventListener("touchend", () => this.onUp(), { passive: true });
      this.host.addEventListener("touchcancel", () => this.cancel(), { passive: true });
    } else {
      // Masaüstü (fare) — burada pointer akışı kesilmiyor
      this.host.addEventListener("pointerdown", e => this.onDown(e), { passive: true });
      this.host.addEventListener("pointermove", e => this.onMove(e), { passive: false });
      this.host.addEventListener("pointerup", e => this.onUp(e), { passive: true });
      this.host.addEventListener("pointercancel", () => this.cancel(), { passive: true });
    }
  },

  /** touch olayını pointer olayı gibi sarar. */
  _touchOlay(e, hareket) {
    const t = e.touches[0];
    return {
      clientX: t.clientX, clientY: t.clientY, target: e.target,
      preventDefault: () => { if (hareket && e.cancelable) e.preventDefault(); }
    };
  },

  /** Şu an kaydırmaya izin var mı? */
  _allowed(e) {
    if (this.active) return false;
    if (document.querySelector(".modal:not([hidden]), .promo-sheet:not([hidden])")) return false;
    if (e.target.closest(this.BLOCK)) return false;
    return true;
  },

  onDown(e) {
    if (!this._allowed(e)) return;
    // Ekran kenarları sistemin "geri" hareketine ait — oradan başlatma
    const p = this.kenarPayi || 0;
    if (p && (e.clientX < p || e.clientX > window.innerWidth - p)) return;
    this.startX = e.clientX; this.startY = e.clientY;
    this.dx = 0; this.active = true; this.decided = false; this.locked = false;
    this.width = this.host.clientWidth || 1;
    this.from = Router.current;
    this.baslangicAn = performance.now();      // hız hesabı için
    this.sonX = e.clientX; this.sonAn = this.baslangicAn; this.hiz = 0; this.hizOrneklendi = false;
  },

  onMove(e) {
    if (!this.active) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;

    /* Yön kararı: eskiden 10px ve 1.4 kat şartı vardı; hareket geç
       algılanıyor ve hafif eğik kaydırmalar dikey sayılıp kaçıyordu.
       Eşiği 6px'e, oranı 1.1'e çektik — çok daha erken ve kolay tutuyor. */
    if (!this.decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      this.decided = true;
      this.locked = Math.abs(dx) > Math.abs(dy) * 1.1;
      if (!this.locked) { this.active = false; return; }
      this._begin();
    }
    if (!this.locked) return;

    e.preventDefault();                                   // sayfa kaymasın

    /* Anlık hız (px/ms) — hızlı fiskede kısa mesafe de yetsin.

       İki tuzak vardı, ikisi de ölçümle yakalandı:
       1) Bu modül hem pointer hem touch dinliyor; cihaz ikisini birden
          gönderdiğinde aynı hareket iki kez işleniyor. Kopya, sıfıra
          yakın süre farkıyla gelip hızı yarıya düşürüyordu. 4 ms'den
          kısa aralıkları saymıyoruz.
       2) Yumuşatma sıfırdan başlıyordu; 6 örneklik kısa bir fiskede
          gerçek hızın ancak yarısına ulaşabiliyordu. Artık ilk örnek
          doğrudan başlangıç değeri oluyor. */
    const simdi = performance.now();
    const gecen = simdi - this.sonAn;
    if (gecen >= 4) {
      const anlik = (e.clientX - this.sonX) / gecen;
      this.hiz = this.hizOrneklendi ? this.hiz * 0.7 + anlik * 0.3 : anlik;
      this.hizOrneklendi = true;
      this.sonX = e.clientX; this.sonAn = simdi;
    }

    const i = Router.indexOf(this.from);
    const atStart = i === 0 && dx > 0;
    const atEnd   = i === Router.tabs.length - 1 && dx < 0;
    // Kenarlarda lastik etkisi
    this.dx = (atStart || atEnd) ? dx * 0.28 : dx;

    const next = this._neighbor();
    this._paint(next);
  },

  _neighbor() {
    const i = Router.indexOf(this.from);
    const j = this.dx < 0 ? i + 1 : i - 1;
    if (j < 0 || j >= Router.tabs.length) return null;
    return Router.tabs[j].dataset.tab;
  },

  _begin() {
    this.host.classList.add("is-swiping");
  },

  /** Aktif görünümü ve komşusunu parmakla birlikte taşır. */
  _paint(nextTab) {
    const cur = Router.views[this.from];
    cur.style.transform = `translateX(${this.dx}px)`;

    // Önceki komşu izlerini temizle
    Object.entries(Router.views).forEach(([k, v]) => {
      if (k !== this.from && k !== nextTab) { v.classList.remove("is-peek"); v.style.transform = ""; }
    });

    if (nextTab) {
      const nv = Router.views[nextTab];
      nv.classList.add("is-peek");
      const offset = this.dx < 0 ? this.width : -this.width;
      nv.style.transform = `translateX(${this.dx + offset}px)`;
    }
  },

  onUp() {
    // Aynı hareket için hem pointerup hem touchend gelebilir:
    // yerine oturma animasyonu sürerken ikinci çağrı onu bozmamalı.
    if (this.settling) return;
    if (!this.active) { this.cancel(); return; }
    this.active = false;
    if (!this.locked) return this.cancel();

    const next = this._neighbor();
    /* Geçiş kararı: yeterince uzağa çekildiyse VEYA hızlıca fiskelendiyse.
       Sadece mesafeye bakmak kısa ama hızlı hareketleri kaçırıyordu. */
    const mesafeYeter = Math.abs(this.dx) > Math.min(56, this.width * 0.16);

    /* Hareketin tamamının ortalama hızı, anlık hıza taban oluşturur.
       Yumuşatılmış değer az örnekte gerçeğin altında kalabiliyor;
       ortalama ise örnek sayısından etkilenmiyor. İkisinden büyüğü
       alınıyor, yön yine gerçek yer değişimiyle doğrulanıyor. */
    const toplamSure = performance.now() - this.baslangicAn;
    const ortHiz = toplamSure > 0 ? this.dx / toplamSure : 0;
    const enHizli = Math.max(Math.abs(this.hiz), Math.abs(ortHiz));
    const hizYeter = enHizli > 0.45 && Math.abs(this.dx) > 20
                     && Math.sign(ortHiz) === Math.sign(this.dx);
    this._settle(next && (mesafeYeter || hizYeter) ? next : null);
  },

  /** Bırakınca ya yeni sekmeye tamamlar ya da geri yaylanır. */
  _settle(target) {
    const cur = Router.views[this.from];
    this.settling = true;
    this.host.classList.remove("is-swiping");
    this.host.classList.add("is-settling");

    if (target) {
      const nv = Router.views[target];
      cur.style.transform = `translateX(${this.dx < 0 ? -this.width : this.width}px)`;
      nv.style.transform = "translateX(0px)";
      Haptics.tap(10);
    } else {
      cur.style.transform = "translateX(0px)";
      const n = this._neighbor();
      if (n) Router.views[n].style.transform = `translateX(${this.dx < 0 ? this.width : -this.width}px)`;
    }

    setTimeout(() => {
      /* Devir anı ANINDA olmalı.
         Aksi halde: kaydırma bitince eski görünümün konumu sıfırlanıp
         ortaya geri dönerken saydamlığı 0.26 sn boyunca azalıyor — yani
         iki sekme kısa süre üst üste görünüyordu. Bu kare boyunca tüm
         geçişleri kapatıp devri tek karede tamamlıyoruz. */
      this.host.classList.add("is-instant");
      this._clear();
      if (target) Router.go(target);
      void this.host.offsetWidth;                 // düzeni hemen uygula
      requestAnimationFrame(() => this.host.classList.remove("is-instant"));
    }, 220);
  },

  _clear() {
    this.host.classList.remove("is-swiping", "is-settling");
    Object.values(Router.views).forEach(v => { v.style.transform = ""; v.classList.remove("is-peek"); });
    this.dx = 0; this.locked = false; this.decided = false; this.settling = false; this.hiz = 0; this.hizOrneklendi = false;
  },

  /* İptal (tarayıcı hareketi devraldı, ikinci parmak değdi, pencere
     kaybedildi…). Görünür bir sürükleme varsa transformu ANINDA sıfırlamak
     ekranda sıçrama olarak görünüyor; onun yerine normal bırakma
     animasyonuyla yerine dönsün. */
  cancel() {
    if (this.settling) return;
    this.active = false;
    if (this.locked && Math.abs(this.dx) > 1) { this._settle(null); return; }
    this._clear();
  }
};

/* ------------------------------------------------------------
   UYGULAMA
   ------------------------------------------------------------ */
const App = {
  learn: null, bot: null, versus: null, lan: null,

  init() {
    Splash.init();
    const sv = $("#surumYazi");
    if (sv) sv.textContent = `Sürüm ${SURUM.ad} · ${SURUM.derleme}`;
    Store.load();
    Theme.apply();
    Promotion.init();
    GameOver.init();
    Confirm.init();
    Preview.init();
    Scanner.init();
    Secici.init();
    Router.init();
    Swipe.init();

    this.buildGames();
    this.bindSettings();
    this.bindBot();
    this.bindMulti();
    this.renderAll();

    // Motoru arka planda yükle, öğreticiyi hazırla
    Splash.ilerlet(45, "Motor indiriliyor…");
    Engine.load().then(ok => {
      if (!ok) {
        Toast.show("Motor yüklenemedi — internet bağlantısı gerekli", "bad", 4000);
        Splash.kapat("motor yok");
        return;
      }
      Splash.ilerlet(80, "Tahta hazırlanıyor…");
      this.learn.analyze();
      Splash.kapat("motor hazır");
      // Açılış ekranı kapandıktan sonra yarım maç varsa sor
      setTimeout(() => AktifMac.sor(), 700);
    });

    // İlk gerçek dokunuşta ses motorunu uyandır ve titreşimi etkinleştir
    // (her ikisi de tarayıcı tarafından kullanıcı hareketine bağlanmıştır)
    const wake = () => {
      Sfx._ensure();
      Haptics.arm();
      document.removeEventListener("pointerdown", wake);
    };
    document.addEventListener("pointerdown", wake);

    // Uygulama olarak çalışıyorsak native köprüyü devreye al
    Native.baslat().catch(e => console.warn("[Native] Başlatılamadı:", e));
    console.log("[Şahname] Hazır.");
  },

  /* --- Oyun örnekleri --- */
  buildGames() {
    this.learn = new LearnGame({
      board: $("#learnBoard"),
      status: $("#learnStatus"), turnDot: $("#learnTurnDot"), moves: $("#learnMoves"),
      evalChip: $("#learnEvalChip"), depth: $("#learnDepth"),
      bestMove: $("#learnBestMove"), spinner: $("#learnSpinner"),
      quality: $("#learnQuality"), qualityRow: $("#learnQualityRow"), qualityDot: $("#learnQualityDot"),
      why: $("#learnWhy"), whyRow: $("#learnWhyRow"),
      moveCount: $("#learnMoveCount"), pgn: $("#learnPgn"),
      stepper: $("#learnStepper"), stepLabel: $("#stepLabel"), stepVerdict: $("#stepVerdict"),
      stepPlay: $("#stepPlay"), stepEval: $("#stepEval"),
      scanBar: $("#scanBar"), scanFill: $("#scanFill"), toolbar: $("#learnToolbar"),
      topCaps: $("#learnTopCaps"), topAdv: $("#learnTopAdv"),
      botCaps: $("#learnBotCaps"), botAdv: $("#learnBotAdv")
    });
    this.learn.renderMoves();
    this.learn.updateStatus();
    this.learn.renderPlayerBars();

    $("#learnUndo").onclick = () => { this.learn.exitReview(); this.learn.undo(); };

    // Yeni oyun — yanlışlıkla basmayı önlemek için onay ister
    $("#learnNew").onclick = async () => {
      if (this.learn.chess.history().length) {
        const ok = await Confirm.ask({
          title: "Yeni oyun başlat?",
          text: "Şu anki tahtadaki hamleler silinecek.",
          icon: "repeat", tone: "is-draw", ok: "Evet, başlat"
        });
        if (!ok) return;
      }
      this.learn.exitReview();
      this.learn.reset(); this.learn.lastEval = null;
      $("#learnQualityRow").hidden = true;
      this.learn.analyze();
      Toast.show("Yeni oyun başladı", "info");
    };

    // Tahtayı çevir (öğreticide iki tarafı da sen oynuyorsun)
    $("#learnFlip").onclick = () => {
      this.learn.board.setFlipped(!this.learn.board.flipped);
      Haptics.tap(); Sfx.play("tap");
    };

    // İnceleme çubuğu
    $("#stepStart").onclick = () => { this.learn.stopSim(); this.learn.step("start"); };
    $("#stepPrev").onclick  = () => { this.learn.stopSim(); this.learn.step("prev"); };
    $("#stepNext").onclick  = () => { this.learn.stopSim(); this.learn.step("next"); };
    $("#stepEnd").onclick   = () => { this.learn.stopSim(); this.learn.step("end"); };
    $("#stepPlay").onclick  = () => {
      const running = this.learn.toggleSim();
      $("#stepPlay").innerHTML = running
        ? '<i class="fa-solid fa-pause"></i>'
        : '<i class="fa-solid fa-play"></i>';
    };
    $("#stepExit").onclick  = () => {
      this.learn.exitReview();
      this.learn.reset();
      this.learn.analyze();
      Toast.show("İnceleme kapatıldı — serbest oynayabilirsin", "info");
    };

    // PGN kopyalama & bota aktarma
    $("#learnCopyPgn").onclick = () => this.copyPgn(this.learn);
    $("#learnToBot").onclick = () => this.sendToBot(this.learn);

    // Serbest Oyun ⇄ Dersler geçişi (iki ekranda da aynı seçici var)
    const modDegistir = mod => {
      Router.screen(mod === "lessons" ? "learnLessons" : "learnPlay");
      if (mod === "lessons" && !Dersler.board) Dersler.kur({ board: $("#lessonBoard") });
      Haptics.tap(); Sfx.play("tap");
    };
    ["#learnModeSeg", "#learnModeSeg2"].forEach(sel => {
      $(sel).addEventListener("click", e => {
        const o = e.target.closest(".segmented__opt"); if (o) modDegistir(o.dataset.mode);
      });
    });
    $("#lessonTabs").addEventListener("click", e => {
      const b = e.target.closest(".lesson-tab"); if (b) Dersler.goster(+b.dataset.ders);
    });

    this.bot = new BotGame({
      board: $("#botBoard"),
      status: $("#botStatus"), turnDot: $("#botTurnDot"), moves: $("#botMoves"),
      spinner: $("#botSpinner"), levelLabel: $("#botLevelLabel"), botName: $("#botName"),
      moveCount: $("#botMoveCount"), pgn: $("#botPgn"),
      // alınan taşlar / puan farkı / profil
      topAvatar: $("#botTopAvatar"), topName: $("#botName"), topElo: $("#botTopElo"),
      topCaps: $("#botTopCaps"), topAdv: $("#botTopAdv"),
      botAvatar: $("#botPlayerAvatar"), botName2: $("#botPlayerName"), botElo: $("#botBotElo"),
      botCaps: $("#botBotCaps"), botAdv: $("#botBotAdv")
    });
    this.bot.renderMoves();

    $("#botCopyPgn").onclick = () => this.copyPgn(this.bot);
    $("#botAnalyze").onclick = () => this.analyzeGame(this.bot);

    this.versus = new VersusGame({
      board: $("#multiBoard"),
      status: $("#multiStatus"), turnDot: $("#multiTurnDot"), moves: $("#multiMoves"),
      title: $("#multiTitle"), sub: $("#multiSub"),
      topBadge: $("#multiTopBadge"), botBadge: $("#multiBotBadge"),
      undo: $("#multiUndo"), resign: $("#multiResign"), actions: $("#multiActions"),
      topAvatar: $("#multiTopAvatar"), topName: $("#multiTopName"), topElo: $("#multiTopElo"),
      topCaps: $("#multiTopCaps"), topAdv: $("#multiTopAdv"),
      botAvatar: $("#multiBotAvatar"), botName2: $("#multiBotName"), botElo: $("#multiBotElo"),
      botCaps: $("#multiBotCaps"), botAdv: $("#multiBotAdv")
    });
  },

  /** Teslim olmadan önce cesaretlendiren mesajlar. */
  PEP_TALKS: [
    "En büyük geri dönüşler, kaybedildiği sanılan konumlardan gelir.",
    "Rakibin de hata yapabilir — bir hamle her şeyi değiştirebilir.",
    "Kaybedilen bir oyun, öğrenilen bir derstir; ama önce sonuna kadar savaş.",
    "Hiç kimse teslim olan bir oyunu kazanmadı. Bir hamle daha dene.",
    "Zor konumlar en iyi savunmaları doğurur. Pes etmek için erken."
  ],

  /** Teslim olma onayı — motive edici bir sözle birlikte. */
  async confirmResign() {
    const quote = this.PEP_TALKS[Math.floor(Math.random() * this.PEP_TALKS.length)];
    return Confirm.ask({
      title: "Teslim olmak istiyor musun?",
      text: "Bu maçı kaybetmiş sayılacaksın.",
      quote, icon: "flag", tone: "is-loss",
      ok: "Teslim ol", cancel: "Devam et"
    });
  },

  /* --- Ayarlar sekmesi --- */
  bindSettings() {
    $("#appbarProfile").onclick = () => Router.go("settings");

    const nameInput = $("#nameInput");
    nameInput.addEventListener("input", e => {
      const v = (e.target.value.trim() || "Misafir").slice(0, Store.AD_SINIRI);
      Store.data.profile.name = v;
      Store.save();
      // Ad birden çok yerde görünüyor (üst bar, oyuncu çubukları, eşleşme
      // kartı) — tek tek yazmak yerine profilin tamamı tazeleniyor.
      this.renderProfile();
    });

    // Profil fotoğrafı
    const file = $("#avatarFile");
    const pick = () => file.click();
    $("#avatarBtn").onclick = pick;
    $("#profileAvatar").onclick = pick;

    file.addEventListener("change", async e => {
      const f = e.target.files[0];
      file.value = "";
      if (!f) return;
      if (!/^image\//.test(f.type)) { Toast.show("Lütfen bir resim dosyası seç", "bad"); return; }
      if (f.size > 12 * 1024 * 1024) { Toast.show("Fotoğraf çok büyük (max 12 MB)", "bad"); return; }
      try {
        const kucuk = await this.avatarKucult(f);
        this.setAvatar(kucuk);
        Toast.show("Profil fotoğrafı güncellendi", "good");
      } catch (err) {
        console.warn("[Profil] Fotoğraf işlenemedi:", err);
        Toast.show("Fotoğraf okunamadı", "bad");
      }
    });

    $("#avatarClear").onclick = () => { this.setAvatar(null); Toast.show("Fotoğraf kaldırıldı", "info"); };

    // Tercih anahtarları
    const bindToggle = (id, key, after) => {
      const el = $(id);
      el.checked = Store.data.settings[key];
      el.addEventListener("change", () => {
        Store.data.settings[key] = el.checked;
        Store.save();
        Haptics.tap(12); Sfx.play("tap");
        if (after) after(el.checked);
      });
    };
    bindToggle("#soundToggle", "sound");
    bindToggle("#vibrateToggle", "vibrate");
    bindToggle("#hintToggle", "hints", on => { if (!on) this.learn.board.clearArrows(); else this.learn.analyze(); });
    bindToggle("#flipToggle", "autoFlip", () => {
      // Kapatılınca tahta beyaz tarafına dönsün, açık maç yamuk kalmasın
      if (this.versus && this.versus.mode === "pass") this.versus.board.setFlipped(false);
      if (this.versus) this.versus.updatePlayerBars();
    });

    GeriBildirim.kur();

    /* --- Promosyon kodu ---
       Cihaz kimliği bilerek ekranda GÖSTERİLMEZ; yalnızca geri bildirim
       mailinde geliyor. Böylece kullanıcı kendi kimliğini bilmediği için
       kod üretmeye çalışmak daha da zor. */
    $("#promoBtn").onclick = async () => {
      const btn = $("#promoBtn"), giris = $("#promoInput");
      btn.disabled = true;
      try {
        const s = await Promosyon.kullan(giris.value);
        if (s.ok) {
          giris.value = "";
          Toast.show(s.mesaj, "good", 4500);
          Sfx.play("coin"); Haptics.tap([12, 30, 12]);
        } else {
          Toast.show(s.mesaj, "bad");
          Sfx.play("error"); Haptics.tap([20, 40, 20]);
        }
      } catch (e) {
        console.warn("[Promosyon] Doğrulanamadı:", e);
        Toast.show("Kod doğrulanamadı", "bad");
      }
      btn.disabled = false;
    };
    // Yazarken otomatik gruplama: XXXX-XXXX-XXXX-XXXX-XXXX
    $("#promoInput").addEventListener("input", e => {
      const ham = Promosyon._sadelestir(e.target.value).slice(0, 20);
      e.target.value = (ham.match(/.{1,4}/g) || []).join("-");
    });

    $("#resetBtn").onclick = async () => {
      const d = Store.data;
      const ok = await Confirm.ask({
        title: "Tüm verilerin silinsin mi?",
        text: "Bu işlem geri alınamaz. Şunların tamamı kalıcı olarak silinecek:",
        list: [
          `${d.wallet.coins} S bakiyen`,
          `Satın aldığın ${d.inventory.boards.length - 2 + (d.inventory.pieces.length - 1)} tema/taş seti`,
          `İstatistiklerin (${d.stats.wins}G ${d.stats.losses}M ${d.stats.draws}B)`,
          `Kayıtlı ${d.history.length} maç analizi`,
          `Profil adın ve fotoğrafın`
        ],
        icon: "triangle-exclamation", tone: "is-loss",
        ok: "Evet, hepsini sil", cancel: "Vazgeç"
      });
      if (!ok) return;
      Store.reset();
      Theme.apply();
      this.learn.exitReview();
      this.renderAll();
      $("#nameInput").value = Store.data.profile.name;
      Toast.show("Tüm veriler sıfırlandı", "info");
    };

    // Tema seçicileri (olay delegasyonu)
    $("#boardSwatches").addEventListener("click", e => {
      const sw = e.target.closest(".swatch"); if (sw) Theme.select("board", sw.dataset.id);
    });
    $("#pieceSwatches").addEventListener("click", e => {
      const sw = e.target.closest(".swatch"); if (sw) Theme.select("pieces", sw.dataset.id);
    });
  },

  /**
   * Fotoğrafı kareye kırpıp 256px'e küçültür ve JPEG'e çevirir.
   * Depolama kotası kısıtlı olduğu için ham dosya asla saklanmaz
   * (3–4 MB'lık bir dataURL mobilde kotayı doldurup TÜM kaydı bozabilir).
   */
  avatarKucult(file, boyut = 256) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const kenar = Math.min(img.width, img.height);       // merkezden kare kırp
          const sx = (img.width - kenar) / 2, sy = (img.height - kenar) / 2;
          const c = document.createElement("canvas");
          c.width = c.height = boyut;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, sx, sy, kenar, kenar, 0, 0, boyut, boyut);
          resolve(c.toDataURL("image/jpeg", 0.82));            // ~15–25 KB
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("resim çözülemedi")); };
      img.src = url;
    });
  },

  setAvatar(dataUrl) {
    Store.data.profile.avatar = dataUrl ? guvenliResimUrl(dataUrl) : null;
    Store.save();
    this.renderAvatar();
  },

  renderAvatar() {
    // Depodaki değer kurcalanmış olabilir: biçimi doğrulanır ve
    // src öznitelik olarak değil, özellik olarak atanır.
    const url = guvenliResimUrl(Store.data.profile.avatar);
    [["#appbarAvatar", "fa-user"], ["#profileAvatar", "fa-user"], ["#botPlayerAvatar", "fa-user"],
     ["#hsMeAvatar", "fa-user"]].forEach(([sel, icon]) => {
      const el = $(sel); if (!el) return;
      el.textContent = "";
      if (url) {
        const img = document.createElement("img");
        img.alt = ""; img.src = url;
        el.appendChild(img);
      } else {
        const i = document.createElement("i");
        i.className = "fa-solid " + icon;
        el.appendChild(i);
      }
    });
  },

  /* --- Bot sekmesi --- */
  bindBot() {
    $("#levelGrid").addEventListener("click", e => {
      const lv = e.target.closest(".level"); if (!lv) return;
      $$("#levelGrid .level").forEach(x => x.classList.remove("is-active"));
      lv.classList.add("is-active");
      Haptics.tap(); Sfx.play("tap");
    });

    $("#colorSeg").addEventListener("click", e => {
      const o = e.target.closest(".segmented__opt"); if (!o) return;
      $$("#colorSeg .segmented__opt").forEach(x => x.classList.remove("is-active"));
      o.classList.add("is-active");
      Haptics.tap(); Sfx.play("tap");
    });

    $("#botStart").onclick = () => this.startBotFromSetup();
    $("#botExit").onclick = () => { Engine.clearQueue(); Router.screen("botSetup"); };
    $("#botUndo").onclick = () => this.bot.undo();
    $("#botResign").onclick = async () => { if (await this.confirmResign()) this.bot.resign(); };

    // Maç sürerken yeni maç istemek onay ister; bitmişse doğrudan başlar
    $("#botNew").onclick = async () => {
      if (!this.bot.over && this.bot.chess.history().length >= 2) {
        const ok = await Confirm.ask({
          title: "Yeni maça geçilsin mi?",
          text: "Devam eden maç yarıda kalacak ve mağlubiyet sayılacak.",
          icon: "repeat", tone: "is-loss", ok: "Evet, yeni maç", cancel: "Vazgeç"
        });
        if (!ok) return;
        this.bot.resign();
        GameOver.hide();
      }
      this.startBotFromSetup();
    };
  },

  startBotFromSetup() {
    // Biten maçın kalite taraması motoru meşgul etmesin
    Engine.clearQueue();
    const lv = $("#levelGrid .level.is-active");
    const col = $("#colorSeg .segmented__opt.is-active");
    Router.go("bot");
    Router.screen("botGame");
    this.bot.start({ color: col.dataset.color, levelName: lv.dataset.name });
  },

  /* --- Çok oyunculu sekmesi --- */
  bindMulti() {
    $("#btnPassPlay").onclick = () => {
      Router.screen("multiGame");
      this.versus.startPassPlay();
    };

    $("#btnLanOpen").onclick = () => {
      Router.screen("multiLan");
      // WebRTC ve kamera bu ortamda var mı?
      const av = Scanner.availability();
      const note = $("#scanNote");
      const uygun = P2PTransport.destekleniyorMu() && av.ok;
      $("#btnHost").disabled = !uygun;
      $("#btnGuest").disabled = !uygun;
      if (uygun) note.hidden = true;
      else {
        note.hidden = false;
        note.textContent = !P2PTransport.destekleniyorMu()
          ? "Bu tarayıcı doğrudan bağlantıyı (WebRTC) desteklemiyor."
          : av.reason;
      }
    };

    // --- Davet eden taraf (ev sahibi) ---
    $("#btnHost").onclick = () => this.p2pDavetEt();
    // --- Daveti okutan taraf (rakip) ---
    $("#btnGuest").onclick = () => this.p2pDaveteKatil();

    $$("[data-back]").forEach(b => b.onclick = () => Router.screen(b.dataset.back));

    $("#lanLeave").onclick = () => { this.closeLan(); Router.screen("multiLan"); };
    $("#multiExit").onclick = () => { this.closeLan(); Router.screen("multiMenu"); };
    $("#multiUndo").onclick = () => this.versus.undo();
    $("#multiResign").onclick = async () => { if (await this.confirmResign()) this.versus.resign(); };

    // Aynı cihazda yeni maç; ağ oyununda menüye döner (yeni eşleşme gerekir)
    $("#multiNew").onclick = async () => {
      if (this.versus.mode === "net") {
        const ok = await Confirm.ask({
          title: "Bağlantı kapatılsın mı?",
          text: "Yeni maç için rakiple yeniden eşleşmen gerekir.",
          icon: "wifi", tone: "is-draw", ok: "Kapat", cancel: "Vazgeç"
        });
        if (!ok) return;
        if (!this.versus.over) this.versus.resign();
        GameOver.hide(); this.closeLan(); Router.screen("multiMenu");
        return;
      }
      Engine.clearQueue();
      GameOver.hide();
      this.versus.startPassPlay();
    };

    // Geçmiş analizler listesi
    $("#historyList").addEventListener("click", e => {
      const row = e.target.closest("[data-hist]");
      if (!row) return;
      const entry = Store.data.history.find(h => String(h.id) === row.dataset.hist);
      if (!entry) return;
      Router.go("learn");
      this.learn.loadReview(entry.moves);
      this.learn.board.setFlipped(entry.color === "b");
      Toast.show(`${entry.moves.length} hamle yüklendi — ▶ ile simülasyonu başlat`, "good");
    });
  },

  /**
   * (QR çizimi qrCiz() içinde yapılır — bkz. doğrudan bağlantı bölümü.)
   */
  _loadQrLib() {
    if (window.QRCode) return Promise.resolve();
    if (this._qrPromise) return this._qrPromise;
    this._qrPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/qrcode.min.js";      // uygulamanın içinde
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("QR kütüphanesi yüklenemedi"));
      document.head.appendChild(s);
    });
    return this._qrPromise;
  },

  /* --- Render --- */
  renderAll() {
    this.renderWallet();
    this.renderProfile();
    this.renderSwatches();
    this.renderShop();
    this.renderStats();
    this.renderHistory();
  },

  renderProfile() {
    const p = Store.data.profile;
    $("#appbarName").textContent = p.name;
    $("#nameInput").value = p.name;
    $("#botPlayerName").textContent = p.name;
    // Yerel ağ eşleşme ekranındaki "Sen" kartı
    const hsAd = $("#hsMeName"); if (hsAd) hsAd.textContent = p.name;
    const hsElo = $("#hsMeElo"); if (hsElo) hsElo.textContent = Store.data.rating.elo + " Elo";
    this.renderAvatar();

    // Derece: satranç usulü Elo puanı
    const rt = Store.data.rating;
    $("#appbarRank").textContent = rt.elo + " Elo";

    // Derece kartı
    const yaz = (sel, v) => { const e = $(sel); if (e) e.textContent = v; };
    yaz("#statElo", rt.elo);
    yaz("#statPeak", rt.peak);
    yaz("#statGames", rt.games);
  },

  renderWallet(bump = false) {
    $("#coinValue").textContent = Store.data.wallet.coins;
    if (bump) {
      const pill = $("#coinPill");
      pill.classList.remove("is-bump");
      void pill.offsetWidth;                 // animasyonu yeniden tetikle
      pill.classList.add("is-bump");
    }
    this.renderShop();
    this.renderStats();
    this.renderProfile();
  },

  renderStats() {
    const s = Store.data.stats;
    $("#statWins").textContent = s.wins;
    $("#statLosses").textContent = s.losses;
    $("#statDraws").textContent = s.draws;
  },

  renderSwatches() {
    const mk = (kind, list, ownedList, active, host) => {
      host.innerHTML = list.map(item => {
        const owned = ownedList.includes(item.id);
        const isActive = item.id === active;
        const preview = kind === "boards"
          ? `<span class="swatch__preview swatch--${item.id}"></span>`
          : `<span class="swatch__preview swatch__preview--piece pc-${item.id}">♞</span>`;
        return `<button class="swatch ${isActive ? "is-active" : ""} ${owned ? "" : "is-locked"}" type="button" data-id="${item.id}">
                  ${preview}<span class="swatch__name">${item.name}</span>
                  ${owned ? "" : '<i class="fa-solid fa-lock swatch__lock"></i>'}
                </button>`;
      }).join("");
    };
    mk("boards", Catalog.sirali("boards"), Store.data.inventory.boards, Store.data.theme.board,  $("#boardSwatches"));
    mk("pieces", Catalog.sirali("pieces"), Store.data.inventory.pieces, Store.data.theme.pieces, $("#pieceSwatches"));
  },

  renderShop() {
    const build = (kind, host) => {
      const owned = Store.data.inventory[kind];
      // Kademe sırası: önce yaygın, en sonda efsanevi
      host.innerHTML = Catalog.sirali(kind).filter(i => !i.free).map(item => {
        const has = owned.includes(item.id);
        const afford = Economy.canAfford(item.price);
        const nad = Nadirlik.bilgi(item.r);
        const art = kind === "boards"
          ? `<div class="shop-card__art swatch--${item.id}"></div>`
          : `<div class="shop-card__art shop-card__art--piece pc-${item.id}">♞</div>`;
        const btn = has
          ? `<button class="btn btn--ghost btn--sm btn--block" data-use="${kind}" data-id="${item.id}">
               <i class="fa-solid fa-check"></i> Kullan</button>`
          : `<button class="btn ${afford ? "btn--primary" : "btn--ghost"} btn--sm btn--block" data-buy="${kind}" data-id="${item.id}">
               ${afford ? "Satın Al" : "Yetersiz"}</button>`;
        return `<article class="shop-card ${has ? "is-owned" : ""}" data-r="${item.r}">
                  <button class="shop-card__preview" data-preview="${kind}" data-id="${item.id}" aria-label="${item.name} önizle">
                    ${art}
                    <span class="rarity rarity--${item.r}"><i class="fa-solid ${nad.ikon}"></i> ${nad.ad}</span>
                    <span class="shop-card__eye"><i class="fa-solid fa-eye"></i> Önizle</span>
                  </button>
                  <div class="shop-card__info">
                    <h5 class="shop-card__title">${item.name}</h5>
                    <span class="shop-card__price">
                      ${has ? '<i class="fa-solid fa-circle-check"></i> Sahipsin'
                            : `<i class="fa-solid fa-coins"></i> ${item.price} S`}
                    </span>
                  </div>${btn}
                </article>`;
      }).join("");
    };
    build("boards", $("#shopBoards"));
    build("pieces", $("#shopPieces"));
    this.renderCoinPacks();
  },

  /** S-Coin paketleri (gerçek para). */
  renderCoinPacks() {
    const host = $("#coinPacks");
    if (!host) return;
    host.innerHTML = Kasa.PAKETLER.map(p => `
      <button class="pack" type="button" data-pack="${p.id}">
        ${p.bonus ? `<span class="pack__bonus">+%${p.bonus} bonus</span>` : ""}
        <i class="fa-solid ${p.ikon} pack__ico"></i>
        <span class="pack__coin"><i class="fa-solid fa-coins"></i> ${p.coin.toLocaleString("tr-TR")}</span>
        <span class="pack__name">${p.ad}</span>
        <span class="pack__price">${p.fiyat}</span>
      </button>`).join("");

    // Ödüllü reklam kartı: kalan hak yazılır
    const odulSub = $("#odulSub"), odulMik = $("#odulMiktar");
    if (odulSub) {
      odulMik.textContent = Reklam.ODUL;
      const kalan = Reklam.kalanHak();
      odulSub.textContent = Reklam.kullanilabilir()
        ? (kalan > 0 ? `Bugün ${kalan} hakkın kaldı` : "Bugünlük hakkın doldu, yarın tekrar gel")
        : "Yalnızca Android uygulamasında";
      $("#odulBtn").classList.toggle("is-bitti", Reklam.kullanilabilir() && kalan <= 0);
    }

    const not = $("#coinNote");
    if (not) {
      const d = Odeme.durum();
      not.hidden = d.ok;
      if (!d.ok) {
        $("#coinNoteText").textContent = d.sebep === "tarayici"
          ? "Satın alma yalnızca Android uygulamasında çalışır."
          : "Satın alma Google Play gerektirir; bu sürüm APK ile kurulduğu için kapalı. Tüm ürünler maç kazanarak da açılıyor.";
      }
    }
  },

  /** Son 5 maçı listeler. */
  renderHistory() {
    const host = $("#historyList");
    if (!host) return;
    const list = Store.data.history;
    if (!list.length) {
      host.innerHTML = '<p class="muted-text">Henüz kayıtlı maç yok. Bot veya yerel ağ maçı oynadığında burada birikir.</p>';
      return;
    }
    const badge = { win: ["is-win", "Galibiyet"], loss: ["is-loss", "Mağlubiyet"], draw: ["is-draw", "Berabere"] };
    // Kayıtlar depodan geliyor; her alan kaçışlanır.
    host.innerHTML = list.map(h => {
      const [cls, label] = badge[h.outcome] || badge.draw;
      const d = new Date(h.date);
      const gecerli = !isNaN(d);
      const when = gecerli
        ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
        : "—";
      const sayi = Array.isArray(h.moves) ? h.moves.length : 0;
      return `<button class="hist-row" data-hist="${esc(h.id)}">
                <span class="hist-badge ${cls}">${label}</span>
                <span class="hist-body">
                  <span class="hist-title">${esc(h.label)}</span>
                  <span class="hist-meta">${sayi} hamle · ${esc(h.reason)} · ${when}</span>
                </span>
                <i class="fa-solid fa-magnifying-glass-chart hist-ico"></i>
              </button>`;
    }).join("");
  },

  /** Satın alma akışı (market kartı ve önizleme penceresi ortak kullanır). */
  buyItem(kind, id) {
    const res = Economy.buy(kind, id);
    if (res.ok) {
      Toast.show(`${res.item.name} satın alındı!`, "good");
      Sfx.play("coin"); Haptics.tap([12, 30, 12]);
      Theme.select(kind === "boards" ? "board" : "pieces", id);
      this.renderSwatches();
    } else {
      Toast.show(res.error, "bad");
      Sfx.play("error"); Haptics.tap([20, 40, 20]);
    }
  },

  /* --- Maç kaydı aktarımları --- */

  /** PGN'i panoya kopyalar; pano yoksa metni seçili bırakır. */
  async copyPgn(game) {
    const pgn = game.buildPgn();
    if (!pgn) { Toast.show("Henüz hamle yok", "info"); return; }
    try {
      await navigator.clipboard.writeText(pgn);
      Toast.show("Maç kaydı kopyalandı", "good");
      Sfx.play("coin"); Haptics.tap(12);
    } catch {
      // Pano izni yoksa kullanıcı elle kopyalayabilsin
      const box = game.refs.pgn;
      if (box) { box.focus(); box.select(); }
      Toast.show("Kutudaki metni elle kopyala", "info");
    }
  },

  /** Bir maçı Öğretici sekmesinde inceleme moduna yükler. */
  analyzeGame(game) {
    const moves = game.moveList();
    if (!moves.length) { Toast.show("Analiz edilecek hamle yok", "info"); return; }
    Router.go("learn");
    const n = this.learn.loadReview(moves);
    // Tahtayı oyuncunun tarafından göster
    const side = game === this.bot ? this.bot.playerColor : "w";
    this.learn.board.setFlipped(side === "b");
    $$("#learnSideSeg .segmented__opt").forEach(x =>
      x.classList.toggle("is-active", x.dataset.side === side));
    Toast.show(`${n} hamle analiz için yüklendi — oklarla gez`, "good");
  },

  /** Öğreticideki mevcut hamleleri Bot sekmesine taşır ve maçı sürdürür. */
  sendToBot(game) {
    const moves = game.moveList();
    if (!moves.length) { Toast.show("Aktarılacak hamle yok", "info"); return; }
    const lv = $("#levelGrid .level.is-active");
    Router.go("bot");
    Router.screen("botGame");
    // Sıradaki tarafı oyuncuya ver ki hemen oynayabilsin
    const probe = new Chess();
    moves.forEach(m => probe.move(m));
    this.bot.start({ color: probe.turn(), levelName: lv.dataset.name });
    this.bot.loadMoves(moves);
    Toast.show(`Pozisyon bota aktarıldı (${moves.length} hamle)`, "good");
  },

  /* ------------------------------------------------------------
     DOĞRUDAN BAĞLANTI (WebRTC) — iki QR ile el sıkışma
     ------------------------------------------------------------ */

  /** Bağlantı kurulduğunda iki tarafta da çalışır. */
  _p2pBaglandi(renk) {
    Toast.show("Bağlantı kuruldu!", "good");
    Sfx.play("coin"); Haptics.tap([15, 40, 15]);
    Router.screen("multiGame");
    this.versus.startNet(this.lan, renk);
  },

  /** Bağlantı koparsa kullanıcıyı bilgilendir ve menüye dön. */
  _p2pKopma(sebep) {
    console.warn("[P2P] Bağlantı koptu:", sebep);
    Toast.show("Rakiple bağlantı koptu", "bad", 4000);
    this.closeLan();
    Router.screen("multiMenu");
  },

  /** EV SAHİBİ: davet QR'ı üretir, sonra rakibin cevabını okutur. */
  async p2pDavetEt() {
    this.closeLan();
    Router.screen("multiWait");
    $("#hsTitle").textContent = "Davet";
    $("#hsSub").textContent = "1/2 — Rakibin bu kodu okutsun";
    $("#hsHint").textContent = "Kod hazırlanıyor…";
    $("#qrBox").innerHTML = "";
    $("#btnScanPeer").hidden = true;
    $("#hsWaiting").hidden = true;

    try {
      this.lan = new P2PTransport();
      this.lan.onPeerJoin = () => this._p2pBaglandi("w");
      this.lan.onKopma = s => this._p2pKopma(s);

      const teklif = await this.lan.teklifUret();
      await this.qrCiz(teklif);
      $("#hsHint").textContent = "Rakip okuttuktan sonra aşağıdaki düğmeye bas";
      $("#scanPeerLabel").textContent = "Rakibin Kodunu Okut";
      $("#btnScanPeer").hidden = false;
      $("#btnScanPeer").onclick = () => {
        Scanner.open(async metin => {
          try {
            $("#hsWaiting").hidden = false;
            $("#waitText").textContent = "Bağlanılıyor…";
            await this.lan.cevabiUygula(metin);
          } catch (e) {
            $("#hsWaiting").hidden = true;
            Toast.show("Kod okunamadı: " + e.message, "bad");
            Sfx.play("error");
          }
        }, { ham: true });
      };
    } catch (err) {
      Toast.show("Davet oluşturulamadı: " + err.message, "bad");
      Router.screen("multiLan");
    }
  },

  /** RAKİP: daveti okutur, kendi cevap QR'ını gösterir. */
  p2pDaveteKatil() {
    this.closeLan();
    Scanner.open(async metin => {
      Router.screen("multiWait");
      $("#hsTitle").textContent = "Cevabın";
      $("#hsSub").textContent = "2/2 — Bu kodu karşı cihaz okutsun";
      $("#hsHint").textContent = "Cevap hazırlanıyor…";
      $("#qrBox").innerHTML = "";
      $("#btnScanPeer").hidden = true;
      $("#hsWaiting").hidden = false;
      $("#waitText").textContent = "Rakibin okutması bekleniyor…";

      try {
        this.lan = new P2PTransport();
        this.lan.onPeerJoin = () => this._p2pBaglandi("b");
        this.lan.onKopma = s => this._p2pKopma(s);

        const cevap = await this.lan.cevapUret(metin);
        await this.qrCiz(cevap);
        $("#hsHint").textContent = "Karşı cihaz bu kodu okutunca oyun başlar";
      } catch (err) {
        Toast.show("Davet çözülemedi: " + err.message, "bad");
        Sfx.play("error");
        Router.screen("multiLan");
      }
    }, { ham: true });
  },

  /** Verilen metni QR olarak çizer (uzun yükler için hata düzeltmesi düşük tutulur). */
  async qrCiz(metin) {
    const box = $("#qrBox");
    box.innerHTML = "";
    try {
      await this._loadQrLib();
      const holder = document.createElement("div");
      holder.className = "qr-canvas";
      box.appendChild(holder);
      new QRCode(holder, {
        text: metin,
        width: 236, height: 236,
        colorDark: "#0a0c10", colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L      // uzun metin sığsın diye
      });
    } catch (_) {
      // QR çizilemezse metni elle paylaşılabilir şekilde göster
      const ta = document.createElement("textarea");
      ta.className = "pgn-box"; ta.readOnly = true; ta.rows = 4; ta.value = metin;
      box.appendChild(ta);
    }
  },

  /** Açık ağ bağlantısını ve yoklamasını tamamen kapatır. */
  closeLan() {
    if (this.lan) { this.lan.close(); this.lan = null; }
    if (this.versus) this.versus.net = null;
  },

  /** Sekme + alt ekrana birlikte git */
  goto(tab, screen) { Router.go(tab); if (screen) Router.screen(screen); }
};

/* Market etkileşimleri — kartlar yeniden çizildiği için olay delegasyonu */
document.addEventListener("click", e => {
  const preview = e.target.closest("[data-preview]");
  if (preview) { Preview.show(preview.dataset.preview, preview.dataset.id); Sfx.play("tap"); return; }

  const use = e.target.closest("[data-use]");
  if (use) { Theme.select(use.dataset.use === "boards" ? "board" : "pieces", use.dataset.id);
             Toast.show("Tema uygulandı", "good"); return; }

  const buy = e.target.closest("[data-buy]");
  if (buy) { App.buyItem(buy.dataset.buy, buy.dataset.id); return; }

  const pack = e.target.closest("[data-pack]");
  if (pack) { Sfx.play("tap"); Odeme.satinAl(pack.dataset.pack); return; }

  if (e.target.closest("#odulBtn")) { Sfx.play("tap"); Reklam.odulluIzle(); }
});

/* Açılış: önce cihazın yerel deposu okunur (uygulamada), sonra arayüz kurulur.
   Eklenti yoksa hydrate() anında döner ve web akışı hiç yavaşlamaz. */
document.addEventListener("DOMContentLoaded", async () => {
  try { await Persist.hydrate(); }
  catch (e) { console.warn("[Depolama] Yerel depo okunamadı, localStorage ile devam.", e); }
  App.init();
  /* Mağaza bağlıysa paket fiyatları kullanıcının para biriminde gösterilir.
     Bağlı değilse sessizce döner — açılışı geciktirmesin diye beklenmiyor. */
  Odeme.fiyatlariTazele();
  Reklam.baslat();
});
