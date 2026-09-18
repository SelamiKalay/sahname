/* ============================================================
   ŞAH — Motor Katmanı (Stockfish sarmalayıcı)
   ------------------------------------------------------------
   Stockfish.js CDN'den metin olarak çekilir ve Blob Worker olarak
   çalıştırılır. (Doğrudan `new Worker(cdnUrl)` CORS'a takılır.)
   Birden fazla CDN denenir; hepsi başarısız olursa motor "yok"
   moduna düşer ve uygulama motorsuz çalışmaya devam eder.
   ============================================================ */
"use strict";

const Engine = {
  worker: null,
  ready: false,
  failed: false,
  _loading: null,
  _queue: [],          // bekleyen istekler
  _current: null,      // {resolve, info}
  _listeners: [],

  // Önce uygulamanın içindeki kopya denenir (çevrimdışı çalışsın diye).
  // İnternet varsa ve yerel dosya bulunamazsa CDN'ler yedek kalır.
  // Not: tek dosyalık asm.js derlemesi gerekir — stockfish@11+ WASM sürümleri
  // Blob Worker içinde yanındaki .wasm dosyasını çözemediği için kullanılamaz.
  CDNS: [
    "vendor/stockfish.js",
    "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
    "https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js"
  ],

  /** Motoru bir kez yükler; tekrar çağrılırsa aynı sözü döndürür. */
  load() {
    if (this._loading) return this._loading;

    this._loading = (async () => {
      for (const url of this.CDNS) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const src = await res.text();
          const blob = new Blob([src], { type: "application/javascript" });
          const w = new Worker(URL.createObjectURL(blob));

          // Motorun hazır olmasını bekle
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("zaman aşımı")), 20000);
            w.onmessage = e => {
              const line = String(e.data);
              if (line.includes("uciok")) w.postMessage("isready");
              if (line.includes("readyok")) { clearTimeout(timer); resolve(); }
            };
            w.onerror = err => { clearTimeout(timer); reject(err); };
            w.postMessage("uci");
          });

          this.worker = w;
          this.ready = true;
          w.onmessage = e => this._onLine(String(e.data));
          w.onerror = () => { this.ready = false; this.failed = true; };
          console.log("[Motor] Stockfish hazır:", url);
          return true;
        } catch (err) {
          console.warn("[Motor] Yüklenemedi:", url, err.message);
        }
      }
      this.failed = true;
      console.error("[Motor] Hiçbir CDN'den yüklenemedi — motor devre dışı.");
      return false;
    })();

    return this._loading;
  },

  /** Worker'dan gelen her UCI satırını işler. */
  _onLine(line) {
    this._listeners.forEach(fn => fn(line));
    if (!this._current) return;

    // Analiz bilgisi: derinlik, skor, varyasyon
    if (line.startsWith("info ") && line.includes(" pv ")) {
      const depth = /\bdepth (\d+)/.exec(line);
      const cp    = /score cp (-?\d+)/.exec(line);
      const mate  = /score mate (-?\d+)/.exec(line);
      const pv    = / pv (.+)$/.exec(line);
      const multi = /multipv (\d+)/.exec(line);
      const sira  = multi ? +multi[1] : 1;

      if (sira === 1) {
        if (depth) this._current.info.depth = +depth[1];
        if (cp)    { this._current.info.cp = +cp[1]; this._current.info.mate = null; }
        if (mate)  { this._current.info.mate = +mate[1]; this._current.info.cp = null; }
        if (pv)    this._current.info.pv = pv[1].trim().split(/\s+/);
      }
      /* Alternatif varyasyonlar: en iyi hamlenin rakiplerinden ne kadar
         iyi olduğunu ölçmek için (açıklama motoru bunu kullanıyor). */
      if (pv) {
        const hamleler = pv[1].trim().split(/\s+/);
        this._current.info.altlar[sira - 1] = {
          sira,
          bestmove: hamleler[0],
          pv: hamleler,
          cp: cp ? +cp[1] : null,
          mate: mate ? +mate[1] : null
        };
      }
    }

    // ÖNEMLİ: Mat/pat konumlarında Stockfish yalnızca
    // "info depth 0 score mate 0" yazar ve HİÇ "bestmove" göndermez.
    // Bu satırı beklemezsek kuyruk kalıcı olarak kilitlenir.
    if (/^info depth 0 score mate 0/.test(line)) {
      this._current.info.mate = 0;
      this._current.info.cp = null;
      return this._finish(null);
    }

    if (line.startsWith("bestmove")) {
      const m = /^bestmove (\S+)/.exec(line);
      this._finish(m && m[1] !== "(none)" ? m[1] : null);
    }
  },

  /** Yürüyen işi sonlandırıp sıradakine geçer. */
  _finish(bestmove) {
    if (!this._current) return;
    clearTimeout(this._watchdog);
    const cur = this._current;
    this._current = null;
    cur.info.bestmove = bestmove;
    cur.resolve(cur.info);
    this._next();
  },

  _send(cmd) { if (this.worker) this.worker.postMessage(cmd); },

  _next() {
    if (this._current || !this._queue.length || !this.ready) return;
    const job = this._queue.shift();
    this._current = { resolve: job.resolve,
                      info: { depth: 0, cp: 0, mate: null, pv: [], bestmove: null, altlar: [] } };
    job.run();

    // Bekçi: motor beklenmedik bir şekilde yanıtsız kalırsa kuyruğu serbest bırak.
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      if (!this._current) return;
      console.warn("[Motor] Yanıt gecikti, iş serbest bırakılıyor.");
      this._send("stop");
      this._finish(this._current.info.pv[0] || null);
    }, (job.budget || 3000) + 7000);
  },

  /**
   * Bir pozisyonu analiz eder.
   * @param {string} fen
   * @param {{depth?:number, movetime?:number, skill?:number}} opts
   * @returns {Promise<{bestmove, cp, mate, pv, depth}>}
   */
  analyze(fen, opts = {}) {
    return new Promise(async resolve => {
      // Biten konumlarda (mat/pat) motora hiç sormaya gerek yok — üstelik
      // Stockfish bu konumlarda "bestmove" göndermediği için boşa beklenir.
      try {
        if (typeof Chess === "function") {
          const probe = new Chess(fen);
          if (probe.game_over()) {
            const mated = probe.in_checkmate();
            return resolve({
              bestmove: null, cp: mated ? -12000 : 0,
              mate: mated ? 0 : null, pv: [], depth: 0, terminal: true
            });
          }
        }
      } catch (_) { /* FEN çözülemezse normal akışa devam */ }

      const ok = await this.load();
      if (!ok) return resolve({ bestmove: null, cp: 0, mate: null, pv: [], depth: 0, unavailable: true });

      const run = () => {
        // Zorluk: Skill Level 0-20
        if (typeof opts.skill === "number") {
          this._send("setoption name Skill Level value " + Math.max(0, Math.min(20, opts.skill)));
        }
        // Alternatif hamleler (açıklama için). İstenmezse 1'e döndürülür
        // ki bot maçları ve kalite taraması yavaşlamasın.
        const cok = Math.max(1, Math.min(5, opts.multipv || 1));
        if (cok !== this._sonMultipv) { this._send("setoption name MultiPV value " + cok); this._sonMultipv = cok; }
        this._send("position fen " + fen);
        if (opts.movetime) this._send("go movetime " + opts.movetime);
        else               this._send("go depth " + (opts.depth || 12));
      };

      const budget = opts.movetime || (opts.depth || 12) * 400;
      this._queue.push({ resolve, run, budget });
      this._next();
    });
  },

  /** Devam eden aramayı iptal eder. */
  stop() { if (this.ready) this._send("stop"); },

  /** Bekleyen tüm işleri temizler (mod değiştirirken). */
  clearQueue() {
    this._queue.length = 0;
    this.stop();
  }
};
