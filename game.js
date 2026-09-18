/* ============================================================
   ŞAH — Tahta görünümü ve oyun modları
   ------------------------------------------------------------
   BoardView   : etkileşimli tahta (render, seçim, ok, terfi)
   GameBase    : ortak oyun mantığı (hamle, ses, bitiş tespiti)
   LearnGame   : öğretici/analiz modu
   BotGame     : Stockfish'e karşı
   VersusGame  : aynı cihaz + yerel ağ
   LanTransport: yerel ağ taşıma katmanı (relay veya BroadcastChannel)
   ============================================================ */
"use strict";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

/* ------------------------------------------------------------
   TAHTA GÖRÜNÜMÜ
   ------------------------------------------------------------ */
class BoardView {
  constructor({ boardEl, arrowsEl, onMove }) {
    this.el = boardEl;
    this.arrows = arrowsEl;
    this.onMove = onMove || (() => {});
    this.chess = null;
    this.flipped = false;
    this.selected = null;
    this.legalTargets = [];
    this.locked = false;
    this.lastMove = null;
    this._squares = new Map();
    this._build();
  }

  /** 64 kareyi bir kez oluşturur; sonraki render'lar sadece içerik günceller. */
  _build() {
    this.el.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const d = document.createElement("div");
        d.className = "sq";
        d.addEventListener("click", () => this._onSquareClick(d.dataset.sq));
        frag.appendChild(d);
      }
    }
    this.el.appendChild(frag);
    this._cells = Array.from(this.el.children);
  }

  setGame(chess) { this.chess = chess; this.selected = null; this.render(); }
  setFlipped(v) { this.flipped = !!v; this.selected = null; this.render(); }
  lock(v = true) { this.locked = v; if (v) { this.selected = null; this.render(); } }

  /** Ekrandaki i. hücreye karşılık gelen kare adı (a1..h8). */
  _sqNameAt(i) {
    const row = Math.floor(i / 8), col = i % 8;
    const rank = this.flipped ? row + 1 : 8 - row;
    const file = this.flipped ? FILES[7 - col] : FILES[col];
    return file + rank;
  }

  render() {
    if (!this.chess) return;
    const board = this.chess.board();          // [rank8..rank1][a..h]
    const inCheck = this.chess.in_check();
    const turn = this.chess.turn();
    let checkSq = null;

    this._cells.forEach((cell, i) => {
      const name = this._sqNameAt(i);
      cell.dataset.sq = name;
      this._squares.set(name, cell);

      const fileIdx = FILES.indexOf(name[0]);
      const rankIdx = +name[1] - 1;
      const light = (fileIdx + rankIdx) % 2 === 1;

      // Sınıfları sıfırla
      cell.className = "sq " + (light ? "sq--l" : "sq--d");

      const piece = board[8 - (rankIdx + 1)][fileIdx];
      cell.innerHTML = "";

      if (piece) {
        const sp = document.createElement("span");
        sp.className = "pc " + (piece.color === "w" ? "pc--w" : "pc--b");
        sp.textContent = PIECE_GLYPH[piece.type];
        cell.appendChild(sp);
        if (piece.type === "k" && piece.color === turn && inCheck) checkSq = name;
      }

      // Vurgular
      if (this.lastMove && (name === this.lastMove.from || name === this.lastMove.to)) {
        cell.classList.add("is-last");
      }
      if (name === this.selected) cell.classList.add("is-sel");
      if (this.legalTargets.includes(name)) {
        const dot = document.createElement("span");
        dot.className = "dot" + (piece ? " dot--cap" : "");
        cell.appendChild(dot);
      }
      // Koordinat etiketleri (kenarlarda)
      const lastRow = Math.floor(i / 8) === 7, firstCol = i % 8 === 0;
      if (lastRow) { const c = document.createElement("span"); c.className = "coord coord--f"; c.textContent = name[0]; cell.appendChild(c); }
      if (firstCol) { const c = document.createElement("span"); c.className = "coord coord--r"; c.textContent = name[1]; cell.appendChild(c); }
    });

    if (checkSq) this._squares.get(checkSq)?.classList.add("is-check");
    this._restoreHints();
  }

  _onSquareClick(name) {
    if (this.locked || !this.chess) return;

    // Hedefe tıklandıysa hamleyi yap
    if (this.selected && this.legalTargets.includes(name)) {
      const opts = this.chess.moves({ square: this.selected, verbose: true })
        .filter(m => m.to === name);
      const needsPromo = opts.some(m => m.promotion);
      const from = this.selected;
      this.selected = null; this.legalTargets = [];

      if (needsPromo) {
        Promotion.ask(this.chess.turn(), piece => {
          if (piece) this.onMove({ from, to: name, promotion: piece });
          else this.render();
        });
      } else {
        this.onMove({ from, to: name });
      }
      return;
    }

    // Taş seçimi
    const piece = this.chess.get(name);
    if (piece && piece.color === this.chess.turn()) {
      this.selected = name;
      this.legalTargets = this.chess.moves({ square: name, verbose: true }).map(m => m.to);
      if (typeof Haptics !== "undefined") Haptics.tap(6);
    } else {
      this.selected = null;
      this.legalTargets = [];
    }
    this.render();
  }

  setLastMove(mv) { this.lastMove = mv ? { from: mv.from, to: mv.to } : null; }

  /* --- İpucu vurgusu (ok yok: kaynak ve hedef kareler yanar) --- */
  clearArrows() {
    this.hintSquares = null;
    this._cells.forEach(c => c.classList.remove("is-hint-from", "is-hint-to"));
  }

  /**
   * En iyi hamleyi gösterir: oynanacak taşın karesi ve gideceği kare yanar.
   * Ok kullanılmaz — vurgu daha okunaklı ve tahtayı kapatmıyor.
   */
  drawArrow(from, to, tone = "best") {
    this.hintSquares = { from, to, tone };
    this._squares.get(from)?.classList.add("is-hint-from");
    this._squares.get(to)?.classList.add("is-hint-to");
  }

  /** Render sonrası ipucu vurgularını geri koyar. */
  _restoreHints() {
    if (!this.hintSquares) return;
    this._squares.get(this.hintSquares.from)?.classList.add("is-hint-from");
    this._squares.get(this.hintSquares.to)?.classList.add("is-hint-to");
  }
}

/* ------------------------------------------------------------
   TERFİ SEÇİCİ
   ------------------------------------------------------------ */
const Promotion = {
  sheet: null, opts: null, cb: null,

  init() {
    this.sheet = document.getElementById("promoSheet");
    this.opts = document.getElementById("promoOpts");
    this.sheet.addEventListener("click", e => {
      if (e.target === this.sheet) this._done(null);
    });
  },

  ask(color, cb) {
    this.cb = cb;
    this.opts.innerHTML = "";
    [["q", "Vezir"], ["r", "Kale"], ["b", "Fil"], ["n", "At"]].forEach(([t, label]) => {
      const b = document.createElement("button");
      b.className = "promo-opt";
      b.innerHTML = `<span class="promo-opt__pc ${color === "w" ? "pc--w" : "pc--b"}">${PIECE_GLYPH[t]}</span>
                     <span class="promo-opt__label">${label}</span>`;
      b.onclick = () => this._done(t);
      this.opts.appendChild(b);
    });
    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add("is-open"));
  },

  _done(piece) {
    this.sheet.classList.remove("is-open");
    setTimeout(() => { this.sheet.hidden = true; }, 200);
    const cb = this.cb; this.cb = null;
    if (cb) cb(piece);
  }
};

/* ------------------------------------------------------------
   MATERYAL — alınan taşlar ve puan farkı
   ------------------------------------------------------------
   İki ayrı soru, iki ayrı kaynak:

   • ALINAN TAŞLAR hamle geçmişinden çıkarılır. Tahtadaki eksikliğe
     bakmak yanıltıcı olurdu: piyon vezire çıkınca siyahın 2 veziri
     8 yerine 7 piyonu olur; sayım "bir piyon alınmış" der ama
     alınmamıştır. Geçmişteki `captured` alanı kesin bilgidir.

   • PUAN FARKI tahtadaki taşların değerinden hesaplanır. Terfi de
     doğru şekilde yansısın diye: vezire çıkan piyon artık 9 puandır.

   Şah puanlamaya girmez.
   ------------------------------------------------------------ */
const Materyal = {
  DEGER: { p: 1, n: 3, b: 3, r: 5, q: 9 },
  // Vitrinde değerli taş önce görünsün
  SIRA: ["q", "r", "b", "n", "p"],
  GLIF: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" },

  /**
   * @returns {{ w:{alinan:Object, puan:number}, b:{...}, fark:number }}
   *          `fark` beyazın lehine artı, siyahın lehine eksidir.
   *          `alinan` o rengin RAKİPTEN aldığı taşları sayar.
   */
  hesapla(chess) {
    const alinan = { w: {}, b: {} };
    for (const h of chess.history({ verbose: true })) {
      if (!h.captured) continue;
      const alan = h.color;                       // taşı alan renk
      alinan[alan][h.captured] = (alinan[alan][h.captured] || 0) + 1;
    }

    const puan = { w: 0, b: 0 };
    for (const satir of chess.board()) {
      for (const kare of satir) {
        if (!kare || kare.type === "k") continue;
        puan[kare.color] += this.DEGER[kare.type] || 0;
      }
    }

    return {
      w: { alinan: alinan.w, puan: puan.w },
      b: { alinan: alinan.b, puan: puan.b },
      fark: puan.w - puan.b
    };
  },

  /** Alınan taşları küçük simgeler hâlinde yazar (3+ aynı taş "×3" olur). */
  simgeler(alinan) {
    let html = "";
    for (const tip of this.SIRA) {
      const n = alinan[tip] || 0;
      if (!n) continue;
      if (n <= 2) html += `<i class="cap-pc">${this.GLIF[tip]}</i>`.repeat(n);
      else html += `<i class="cap-pc">${this.GLIF[tip]}</i><i class="cap-x">×${n}</i>`;
    }
    return html;
  }
};

/* ------------------------------------------------------------
   ORTAK OYUN TABANI
   ------------------------------------------------------------ */
class GameBase {
  constructor(refs) {
    this.chess = new Chess();
    this.refs = refs;
    this.board = new BoardView({
      boardEl: refs.board,
      arrowsEl: refs.arrows,
      onMove: mv => this.handleMove(mv)
    });
    this.board.setGame(this.chess);
    this.over = false;
  }

  reset() {
    this.chess.reset();
    this.over = false;
    this.board.setLastMove(null);
    this.board.clearArrows();
    this.board.setGame(this.chess);
    /* ZORUNLU: maç bitince finishIfOver() tahtayı kilitliyor. Burada
       açılmazsa yeni maçta hiçbir taş oynatılamıyor — oyuncu beyazsa
       bot hiç hamle yapmadığı için kilidi açacak kimse olmuyordu. */
    this.board.lock(false);
    this.renderMoves();
    this.updateStatus();
    this.renderPlayerBars();
  }

  /* Çubuklarda kim görünecek? Alt sınıflar kendi bilgilerini verir.
     Dönen nesne: { w:{ad, avatar, elo}, b:{...} } — alanlar isteğe bağlı. */
  oyuncuBilgisi() { return { w: {}, b: {} }; }

  /** Alınan taşları, puan farkını ve (varsa) profil bilgisini çizer. */
  renderPlayerBars() {
    const r = this.refs;
    if (!r.topCaps && !r.botCaps) return;          // bu ekranda çubuk yok

    const m = Materyal.hesapla(this.chess);
    const ustRenk = this.board.flipped ? "w" : "b";
    const altRenk = ustRenk === "w" ? "b" : "w";
    const bilgi = this.oyuncuBilgisi();

    const yaz = (renk, capsEl, advEl, adEl, avatarEl, eloEl) => {
      // Bu rengin ALDIĞI taşlar kendi çubuğunda görünür
      if (capsEl) capsEl.innerHTML = Materyal.simgeler(m[renk].alinan);

      // Puan farkı yalnızca ÖNDE olan tarafta yazar
      if (advEl) {
        const fark = renk === "w" ? m.fark : -m.fark;
        advEl.textContent = fark > 0 ? "+" + fark : "";
        advEl.hidden = fark <= 0;
      }

      const b = bilgi[renk] || {};
      if (adEl && b.ad) adEl.textContent = b.ad;
      if (eloEl) {
        const varMi = Number.isFinite(b.elo);
        eloEl.textContent = varMi ? b.elo + " Elo" : "";
        eloEl.hidden = !varMi;
      }
      if (avatarEl && b.avatar !== undefined) {
        avatarEl.textContent = "";
        const url = typeof guvenliResimUrl === "function" ? guvenliResimUrl(b.avatar) : null;
        if (url) {
          const img = document.createElement("img");
          img.alt = ""; img.src = url;
          avatarEl.appendChild(img);
        } else {
          const i = document.createElement("i");
          i.className = "fa-solid " + (b.ikon || "fa-user");
          avatarEl.appendChild(i);
        }
      }
    };

    yaz(ustRenk, r.topCaps, r.topAdv, r.topName, r.topAvatar, r.topElo);
    yaz(altRenk, r.botCaps, r.botAdv, r.botName2, r.botAvatar, r.botElo);
  }

  /** Hamleyi uygular; geçersizse false döner. */
  applyMove(mv) {
    const res = this.chess.move(mv);
    if (!res) return null;
    this.board.setLastMove(res);
    this.board.render();
    this.playMoveFx(res);
    this.renderMoves();
    this.updateStatus();
    this.renderPlayerBars();
    // Dereceli maçlar her hamlede kaydedilir (uygulama kapanırsa kaybolmasın)
    if (typeof AktifMac !== "undefined") AktifMac.kaydet(this);
    return res;
  }

  playMoveFx(res) {
    const rok = res.flags && /[kq]/.test(res.flags);   // kısa/uzun rok
    if (this.chess.in_checkmate())  { Sfx.play("mate");    Haptics.tap([30, 60, 30]); }
    else if (this.chess.in_check()) { Sfx.play("check");   Haptics.tap([15, 40]); }
    else if (res.captured)          { Sfx.play("capture"); Haptics.tap(14); }
    else if (rok)                   { Sfx.play("castle");  Haptics.tap([8, 40, 8]); }
    else                            { Sfx.play("move");    Haptics.tap(8); }
  }

  /** Oyun bitti mi? Bittiyse {result, reason} döner. */
  checkEnd() {
    if (!this.chess.game_over()) return null;
    if (this.chess.in_checkmate()) {
      const loser = this.chess.turn();               // mat olan taraf
      return { winner: loser === "w" ? "b" : "w", reason: "Şah mat" };
    }
    let reason = "Beraberlik";
    if (this.chess.in_stalemate())         reason = "Pat";
    else if (this.chess.in_threefold_repetition()) reason = "Üçlü tekrar";
    else if (this.chess.insufficient_material())   reason = "Yetersiz materyal";
    else if (this.chess.in_draw())         reason = "50 hamle kuralı";
    return { winner: null, reason };
  }

  /**
   * Hamle listesini çizer; ayrıca PGN kutusunu ve sayacı günceller.
   * @param {number} [highlight] - vurgulanacak yarım hamle indeksi (inceleme modu)
   */
  renderMoves(highlight = -1) {
    const el = this.refs.moves;
    const hist = this.chess.history();

    if (el) {
      if (!hist.length) el.innerHTML = '<span class="movelist__empty">Henüz hamle yok</span>';
      else {
        let html = "";
        for (let i = 0; i < hist.length; i += 2) {
          const a = hist[i] ? `<span class="mv ${i === highlight ? "is-current" : ""}">${hist[i]}</span>` : '<span class="mv"></span>';
          const b = hist[i + 1] ? `<span class="mv ${i + 1 === highlight ? "is-current" : ""}">${hist[i + 1]}</span>` : '<span class="mv"></span>';
          html += `<div class="mv-row"><span class="mv-no">${i / 2 + 1}.</span>${a}${b}</div>`;
        }
        el.innerHTML = html;
        el.scrollTop = el.scrollHeight;
      }
    }

    if (this.refs.moveCount) this.refs.moveCount.textContent = hist.length + " hamle";
    if (this.refs.pgn) this.refs.pgn.value = this.buildPgn();
  }

  /** Tarih/sonuç başlıklı, standart PGN metni üretir. */
  buildPgn() {
    const hist = this.chess.history();
    if (!hist.length) return "";
    let body = "";
    for (let i = 0; i < hist.length; i += 2) {
      body += `${i / 2 + 1}. ${hist[i]}${hist[i + 1] ? " " + hist[i + 1] : ""} `;
    }
    let result = "*";
    if (this.chess.in_checkmate()) result = this.chess.turn() === "w" ? "0-1" : "1-0";
    else if (this.chess.game_over()) result = "1/2-1/2";

    const d = new Date();
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    return `[Event "Şah"]\n[Date "${date}"]\n[Result "${result}"]\n\n${body.trim()} ${result}`;
  }

  /** Sadece SAN dizisini döndürür (sekmeler arası aktarım için). */
  moveList() { return this.chess.history(); }

  turnText() { return this.chess.turn() === "w" ? "Beyaz" : "Siyah"; }

  /**
   * Son hamleyi GÖSTERİR — konumu kalıcı olarak değiştirmez.
   * Tahta kısa süre bir önceki konuma sarılır, hamlenin geldiği ve gittiği
   * kareler vurgulanır, sonra oyun olduğu yerden devam eder.
   */
  peekLastMove(ms = 1500) {
    if (this._peeking) return;
    // İnceleme modunda konumu adım çubuğu yönetir; buradan oynamak bozar
    if (this.review) { Toast.show("İnceleme açık — adım oklarını kullan", "info"); return; }
    const verbose = this.chess.history({ verbose: true });
    if (!verbose.length) { Toast.show("Henüz hamle yapılmadı", "info"); return; }

    const last = verbose[verbose.length - 1];
    this._peeking = true;
    const wasLocked = this.board.locked;

    // Bir hamle geri sar (yalnızca görüntü için)
    this.chess.undo();
    const prev = this.chess.history({ verbose: true });
    this.board.setLastMove(prev[prev.length - 1] || null);
    this.board.setGame(this.chess);
    this.board.lock(true);
    this.board._squares.get(last.from)?.classList.add("is-peek-from");
    this.board._squares.get(last.to)?.classList.add("is-peek-to");

    const who = last.color === "w" ? "Beyaz" : "Siyah";
    Toast.show(`Son hamle — ${who}: ${last.san}`, "info", ms);
    Sfx.play("tap");

    // Konumu aynen geri koy
    setTimeout(() => {
      this.chess.move({ from: last.from, to: last.to, promotion: last.promotion });
      this.board.setLastMove(last);
      this.board.setGame(this.chess);
      this.board.lock(wasLocked);
      this._peeking = false;
      this.renderMoves();
      this.updateStatus();
    }, ms);
  }

  updateStatus() {
    const { status, turnDot } = this.refs;
    if (turnDot) turnDot.className = "turn-dot " + (this.chess.turn() === "w" ? "turn-dot--white" : "turn-dot--black");
    if (!status) return;
    const end = this.checkEnd();
    if (end) {
      status.innerHTML = end.winner
        ? `<strong>${end.winner === "w" ? "Beyaz" : "Siyah"}</strong> kazandı — ${end.reason}`
        : `<strong>Berabere</strong> — ${end.reason}`;
    } else {
      status.innerHTML = `Sıra: <strong>${this.turnText()}</strong>` + (this.chess.in_check() ? " — Şah!" : "");
    }
  }

  handleMove() { /* alt sınıflar doldurur */ }
}

/* ------------------------------------------------------------
   1) ÖĞRETİCİ MODU
   ------------------------------------------------------------ */
class LearnGame extends GameBase {
  constructor(refs) {
    super(refs);
    this.analyzing = false;
    this.lastEval = null;    // önceki pozisyonun motor değerlendirmesi (kalite için)
    this.reqId = 0;
  }

  handleMove(mv) {
    const before = this.lastEval;
    const res = this.applyMove(mv);
    if (!res) return;
    this.judgeMove(before, res);
    this.analyze();
  }

  /** Oynanan hamleyi motorun önerisiyle kıyaslayıp etiketler. */
  judgeMove(before, res) {
    const row = this.refs.qualityRow, out = this.refs.quality, dot = this.refs.qualityDot;
    if (!row || !before || !before.bestmove) { if (row) row.hidden = true; return; }

    const played = res.from + res.to + (res.promotion || "");
    row.hidden = false;

    if (played === before.bestmove) {
      out.textContent = `${res.san} — En iyi hamle!`;
      dot.className = "hint-dot hint-dot--best";
      return;
    }
    // Kayıp = önceki en iyi skor − şu anki skor (aynı taraf açısından)
    this._pendingJudge = { before, res, played };
    out.textContent = `${res.san} — değerlendiriliyor…`;
    dot.className = "hint-dot hint-dot--alt";
  }

  async analyze() {
    const id = ++this.reqId;
    const spinner = this.refs.spinner;
    if (spinner) spinner.hidden = false;
    this.analyzing = true;
    this.board.clearArrows();

    // multipv: alternatif hamleler açıklama motoruna "tek hamle mi" bilgisi verir
    const info = await Engine.analyze(this.chess.fen(), { depth: 14, multipv: 3 });
    if (id !== this.reqId) return;             // bayat sonuç
    this.analyzing = false;
    if (spinner) spinner.hidden = true;

    if (info.unavailable) {
      this.refs.bestMove.textContent = "Motor yüklenemedi (internet gerekli)";
      this.refs.pv.textContent = "—";
      return;
    }

    // Bekleyen hamle kalitesi kıyaslaması
    if (this._pendingJudge) {
      const { before } = this._pendingJudge;
      // Skorlar sıradaki oyuncu açısından; taraf değiştiği için işaret çevrilir
      const prevBest = before.mate != null ? (before.mate > 0 ? 10000 : -10000) : before.cp;
      const nowScore = info.mate != null ? (info.mate > 0 ? 10000 : -10000) : info.cp;
      const loss = Math.max(0, prevBest - (-nowScore));
      const { label, cls } = this.qualityLabel(loss);
      this.refs.quality.textContent = `${this._pendingJudge.res.san} — ${label} (${loss} cp)`;
      this.refs.qualityDot.className = "hint-dot " + cls;
      this._pendingJudge = null;
    }

    this.lastEval = info;
    this.showAnalysis(info);
  }

  qualityLabel(loss) {
    if (loss <= 10)  return { label: "Mükemmel", cls: "hint-dot--best" };
    if (loss <= 30)  return { label: "İyi", cls: "hint-dot--best" };
    if (loss <= 80)  return { label: "Yanlışlık", cls: "hint-dot--warn" };
    if (loss <= 200) return { label: "Hata", cls: "hint-dot--warn" };
    return { label: "Büyük hata", cls: "hint-dot--bad" };
  }

  showAnalysis(info) {
    // Skor daima beyaz açısından gösterilir
    const white = this.chess.turn() === "w" ? 1 : -1;
    let text;
    if (info.mate != null) {
      const m = info.mate * white;
      text = (m > 0 ? "+M" : "-M") + Math.abs(info.mate);
    } else {
      const cp = info.cp * white;
      text = (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
    }
    if (this.refs.evalChip) this.refs.evalChip.textContent = text;
    if (this.refs.depth) this.refs.depth.textContent = "d" + info.depth;

    if (!info.bestmove) { this.refs.bestMove.textContent = "—"; return; }

    // En iyi hamleyi SAN'a çevir (hangi taşın oynadığı da yazılır)
    const probe = new Chess(this.chess.fen());
    const mv = probe.move({ from: info.bestmove.slice(0, 2), to: info.bestmove.slice(2, 4), promotion: info.bestmove[4] || "q" });
    if (mv) {
      const PIECE_TR = { p: "Piyon", n: "At", b: "Fil", r: "Kale", q: "Vezir", k: "Şah" };
      this.refs.bestMove.textContent = `${mv.san}  ·  ${PIECE_TR[mv.piece]} ${mv.from}→${mv.to}`;
    } else {
      this.refs.bestMove.textContent = info.bestmove;
    }

    // Kare vurgusu: oynanacak taş + gideceği kare
    if (Store.data.settings.hints) {
      this.board.clearArrows();
      this.board.drawArrow(info.bestmove.slice(0, 2), info.bestmove.slice(2, 4));
    }

    // Bu hamle neden en iyi? — öğretici açıklama
    if (this.refs.whyRow && this.refs.why) {
      const gerekceler = Aciklayici.acikla(this.chess.fen(), info.bestmove, info);
      if (gerekceler.length) {
        this.refs.why.textContent = gerekceler.join(" ");
        this.refs.whyRow.hidden = false;
      } else {
        this.refs.whyRow.hidden = true;
      }
    }
  }

  /** Öğreticide de geri alma yok — son hamle yalnızca gösterilir. */
  undo() { this.peekLastMove(); }

  hint() {
    if (this.lastEval && this.lastEval.bestmove) {
      this.board.clearArrows();
      this.board.drawArrow(this.lastEval.bestmove.slice(0, 2), this.lastEval.bestmove.slice(2, 4), "#d9a94c");
      Sfx.play("coin");
    } else {
      Toast.show("Motor henüz hazır değil", "info");
    }
  }

  /* ---------- İNCELEME MODU ----------
     Kaydedilmiş bir maçın hamleleri yüklenir ve ileri/geri gezilir.
     Her konumda motor otomatik analiz eder. ------------------------ */

  /** SAN dizisini yükleyip inceleme moduna geçer. */
  loadReview(sanMoves) {
    this.stopSim();
    this.review = { moves: sanMoves.slice(), index: 0, quality: [], scanned: false };
    this.refs.qualityRow.hidden = true;
    this.syncReview();
    this.scanReview();               // arka planda hamle kalitelerini çıkar
    return this.review.moves.length;
  }

  exitReview() {
    this.stopSim();
    this.review = null;
    if (this.refs.stepper) this.refs.stepper.hidden = true;
    if (this.refs.scanBar) this.refs.scanBar.hidden = true;
    if (this.refs.toolbar) this.refs.toolbar.hidden = false;
    this.board.lock(false);
    this.board.clearArrows();
  }

  /**
   * Maçtaki her hamlenin kalitesini hesaplar.
   * Her konum motorla değerlendirilir; oynanan hamlenin santipiyon kaybı
   * bir sonraki konumun skoruyla karşılaştırılarak bulunur.
   */
  async scanReview() {
    const rev = this.review;
    if (!rev || rev.scanned) return;
    const bar = this.refs.scanBar, fill = this.refs.scanFill;
    if (bar) bar.hidden = false;

    const probe = new Chess();
    const evals = [], bests = [];
    const token = ++this.reqId;      // yeni bir yükleme olursa taramayı iptal et

    for (let i = 0; i <= rev.moves.length; i++) {
      if (!this.review || this.review !== rev || token !== this.reqId) { if (bar) bar.hidden = true; return; }
      const info = await Engine.analyze(probe.fen(), { movetime: 220 });
      if (info.unavailable) { if (bar) bar.hidden = true; return; }
      evals.push(info.mate != null ? (info.mate > 0 ? 12000 : -12000) : info.cp);
      bests.push(info.bestmove);
      if (fill) fill.style.width = Math.round((i / rev.moves.length) * 100) + "%";
      if (i < rev.moves.length) probe.move(rev.moves[i]);
    }

    // Kayıp = oynayan tarafın hamle öncesi skoru + hamle sonrası skoru
    const q = [];
    const walk = new Chess();
    for (let i = 0; i < rev.moves.length; i++) {
      const before = evals[i], after = evals[i + 1];
      const played = walk.move(rev.moves[i]);
      const uci = played ? played.from + played.to + (played.promotion || "") : "";
      const wasBest = bests[i] && uci === bests[i];
      const loss = wasBest ? 0 : Math.max(0, before + after);
      q.push({ loss, wasBest, san: rev.moves[i], color: played ? played.color : "w", best: bests[i] });
    }
    rev.quality = q;
    rev.evals = evals;      // her konumun skoru (sıradaki oyuncu açısından)
    rev.bests = bests;      // her konumun en iyi hamlesi
    rev.scanned = true;
    if (bar) bar.hidden = true;
    this.renderReviewList();
    this.showVerdict();
  }

  /** Kayba göre etiket ve renk sınıfı. */
  static verdictOf(loss, wasBest) {
    if (wasBest || loss <= 10) return { label: "Mükemmel", cls: "q-best", icon: "star" };
    if (loss <= 30)  return { label: "İyi",         cls: "q-good",  icon: "thumbs-up" };
    if (loss <= 80)  return { label: "Yanlışlık",   cls: "q-inacc", icon: "circle-exclamation" };
    if (loss <= 200) return { label: "Hata",        cls: "q-mist",  icon: "triangle-exclamation" };
    return              { label: "Büyük hata",  cls: "q-blun",  icon: "bomb" };
  }

  /** Hamle listesini kalite renkleriyle çizer. */
  renderReviewList() {
    const rev = this.review, el = this.refs.moves;
    if (!rev || !el) return;
    const q = rev.quality;
    let html = "";
    for (let i = 0; i < rev.moves.length; i += 2) {
      const cell = k => {
        if (k >= rev.moves.length) return '<span class="mv"></span>';
        const v = q[k] ? LearnGame.verdictOf(q[k].loss, q[k].wasBest) : null;
        // Hamleler depodan yüklenmiş olabilir → kaçışlanır
        return `<span class="mv ${v ? v.cls : ""} ${k === rev.index - 1 ? "is-current" : ""}"
                      data-ply="${k}">${esc(rev.moves[k])}</span>`;
      };
      html += `<div class="mv-row"><span class="mv-no">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</div>`;
    }
    el.innerHTML = html;
    if (this.refs.moveCount) this.refs.moveCount.textContent = rev.moves.length + " hamle";
  }

  /** Bulunulan hamlenin kalite yargısını ve konumun motor bilgisini tazeler. */
  showVerdict() {
    const rev = this.review;
    const out = this.refs.stepVerdict;
    if (!rev || !out) return;
    const i = rev.index - 1;
    const q = rev.quality[i];

    // Bu konumun skoru ve en iyi hamlesi (tarama verisinden — motoru tekrar yormaz)
    if (rev.scanned && rev.evals) {
      const walk = new Chess();
      for (let k = 0; k < rev.index; k++) walk.move(rev.moves[k]);
      const white = walk.turn() === "w" ? 1 : -1;
      const raw = rev.evals[rev.index];
      if (raw != null) {
        const s = raw * white;
        const txt = Math.abs(s) >= 11000
          ? (s > 0 ? "+M" : "-M")
          : (s >= 0 ? "+" : "") + (s / 100).toFixed(2);
        if (this.refs.evalChip) this.refs.evalChip.textContent = txt;
        if (this.refs.stepEval) this.refs.stepEval.textContent = txt;
      }
      const bm = rev.bests[rev.index];
      if (this.refs.bestMove) {
        if (bm) {
          const probe = new Chess(walk.fen());
          const mv = probe.move({ from: bm.slice(0, 2), to: bm.slice(2, 4), promotion: bm[4] || "q" });
          const TR = { p: "Piyon", n: "At", b: "Fil", r: "Kale", q: "Vezir", k: "Şah" };
          this.refs.bestMove.textContent = mv ? `${mv.san}  ·  ${TR[mv.piece]} ${mv.from}→${mv.to}` : bm;
        } else {
          this.refs.bestMove.textContent = "Oyun bitti";
        }
      }
      // Bu konumda oynanabilecek en iyi hamleyi tahtada göster
      this.board.clearArrows();
      if (bm && Store.data.settings.hints) this.board.drawArrow(bm.slice(0, 2), bm.slice(2, 4));
    }

    if (i < 0 || !q) {
      out.textContent = rev.scanned ? "Başlangıç konumu" : "hamleler taranıyor…";
      out.className = "stepper__verdict";
      return;
    }
    const v = LearnGame.verdictOf(q.loss, q.wasBest);
    const who = q.color === "w" ? "Beyaz" : "Siyah";
    const kayip = Number.isFinite(q.loss) ? Math.round(q.loss) : 0;
    out.innerHTML = `<i class="fa-solid fa-${v.icon}"></i> ${who}: ${esc(q.san)} — ${v.label}` +
                    (kayip > 10 && kayip < 11000 ? ` <span class="loss">(−${kayip} cp)</span>` : "");
    out.className = "stepper__verdict " + v.cls;
  }

  /* --- Simülasyon: maçı otomatik oynat --- */
  toggleSim() {
    if (this._sim) { this.stopSim(); return false; }
    if (!this.review) return false;
    if (this.review.index >= this.review.moves.length) this.review.index = 0;
    this._sim = setInterval(() => {
      if (!this.review || this.review.index >= this.review.moves.length) { this.stopSim(); return; }
      this.step("next");
    }, 1400);
    this.syncReview();
    return true;
  }

  stopSim() {
    if (this._sim) { clearInterval(this._sim); this._sim = null; }
    const b = this.refs.stepPlay;
    if (b) b.innerHTML = '<i class="fa-solid fa-play"></i>';
  }

  get inReview() { return !!this.review; }

  /** İnceleme konumunu değiştirir. where: "start"|"prev"|"next"|"end" */
  step(where) {
    if (!this.review) return;
    const n = this.review.moves.length;
    let i = this.review.index;
    if (where === "start") i = 0;
    else if (where === "prev") i = Math.max(0, i - 1);
    else if (where === "next") i = Math.min(n, i + 1);
    else if (where === "end") i = n;
    this.review.index = i;
    this.syncReview();
    Sfx.play("tap");
  }

  /** Tahtayı ve paneli inceleme konumuna göre tazeler. */
  syncReview() {
    const { moves, index } = this.review;
    this.chess.reset();
    let last = null;
    for (let k = 0; k < index; k++) last = this.chess.move(moves[k]);

    this.board.setLastMove(last);
    this.board.clearArrows();
    this.board.setGame(this.chess);
    this.board.lock(true);          // incelemede tahta salt-okunur

    if (this.refs.stepper) {
      this.refs.stepper.hidden = false;
      this.refs.stepLabel.textContent = `${index} / ${moves.length}`;
    }
    // İncelemede kontrol adım çubuğundadır; oyun araç çubuğu gizlenir
    if (this.refs.toolbar) this.refs.toolbar.hidden = true;
    this.renderReviewList();
    this.showVerdict();
    this.updateStatus();

    // Tarama bittiyse motoru tekrar meşgul etme; skoru kalite verisinden göster
    if (!this.review.scanned) this.analyze();
  }
}

/* ------------------------------------------------------------
   2) BOT MODU
   ------------------------------------------------------------ */
class BotGame extends GameBase {
  /* Zorluk ayarları.
     hata : bilerek rastgele hamle oynama olasılığı (insan gibi hata)
     aday : motorun kaç önerisi arasından rastgele seçileceği (1 = hep en iyi)
     skill: Stockfish Skill Level (0–20)
     sure : hamle başına düşünme süresi (ms)

     `aday` güçlü bir zayıflatıcı: 2 bile, ikinci en iyi hamlenin
     yarı yarıya oynanması demek. Bu yüzden yalnızca alt üç seviyede
     kullanılıyor — üst seviyelerde bot her zaman en iyisini oynar,
     zorluk farkı skill ve düşünme süresinden gelir. */
  static ZORLUK = {
    "Acemi": { hata: 0.55, aday: 5, skill: 0,  sure: 120,  elo: 400  },
    "Kolay": { hata: 0.30, aday: 4, skill: 0,  sure: 200,  elo: 700  },
    "Orta":  { hata: 0.10, aday: 3, skill: 3,  sure: 400,  elo: 1100 },
    "Zor":   { hata: 0,    aday: 1, skill: 12, sure: 1000, elo: 1600 },
    "Usta":  { hata: 0,    aday: 1, skill: 20, sure: 2000, elo: 2200 }
  };

  constructor(refs) { super(refs); this.playerColor = "w"; this.levelName = "Kolay"; this.thinking = false; }

  oyuncuBilgisi() {
    const p = Store.data.profile;
    const ben = { ad: p.name, avatar: p.avatar, elo: Store.data.rating.elo };
    const bot = { ad: "Bot · " + this.levelName, avatar: null, ikon: "fa-robot",
                  elo: BotGame.ZORLUK[this.levelName] ? BotGame.ZORLUK[this.levelName].elo : null };
    return this.playerColor === "w" ? { w: ben, b: bot } : { w: bot, b: ben };
  }

  start({ color, levelName }) {
    this.playerColor = color === "r" ? (Math.random() < 0.5 ? "w" : "b") : color;
    this.levelName = BotGame.ZORLUK[levelName] ? levelName : "Kolay";
    this.rakipElo = BotGame.ZORLUK[this.levelName].elo;     // derece hesabı için
    this.reset();
    this.board.setFlipped(this.playerColor === "b");
    this.refs.levelLabel.textContent = this.levelName;
    this.refs.botName.textContent = `Bot · ${this.levelName} (${this.rakipElo})`;
    AktifMac.basla(this, "bot", { seviye: this.levelName });   // yarıda bırakma takibi
    if (this.chess.turn() !== this.playerColor) this.botMove();
  }

  /** Hazır bir hamle dizisini yükler (Öğreticiden aktarım için). */
  loadMoves(sanMoves) {
    this.chess.reset();
    let last = null;
    sanMoves.forEach(san => { const r = this.chess.move(san); if (r) last = r; });
    this.board.setLastMove(last);
    this.board.setGame(this.chess);
    this.renderMoves();
    this.updateStatus();
    if (this.chess.turn() !== this.playerColor && !this.chess.game_over()) this.botMove();
  }

  handleMove(mv) {
    if (this.over || this.thinking) return;
    if (this.chess.turn() !== this.playerColor) return;
    const res = this.applyMove(mv);
    if (!res) return;
    if (this.finishIfOver()) return;
    this.botMove();
  }

  async botMove() {
    if (this.over) return;
    this.thinking = true;
    this.board.lock(true);
    if (this.refs.spinner) this.refs.spinner.hidden = false;

    const a = BotGame.ZORLUK[this.levelName] || BotGame.ZORLUK["Orta"];
    let secilen = null;

    /* 1) Kasıtlı hata: Stockfish'in en zayıf ayarı bile (Skill 0)
       yaklaşık 1000 Elo oynuyor — gerçek bir acemi için fazla güçlü.
       Alt seviyelerde belirli bir olasılıkla bilerek rastgele hamle
       oynatıyoruz ki insan gibi hata yapsın. */
    if (a.hata > 0 && Math.random() < a.hata) {
      const legal = this.chess.moves({ verbose: true });
      if (legal.length) {
        const m = legal[Math.floor(Math.random() * legal.length)];
        secilen = m.from + m.to + (m.promotion || "");
      }
    }

    if (!secilen) {
      const info = await Engine.analyze(this.chess.fen(), {
        skill: a.skill, movetime: a.sure, multipv: a.aday
      });
      if (this.over) { this._dusunmeBitti(); return; }
      if (!info.bestmove) {
        this._dusunmeBitti();
        if (info.unavailable) Toast.show("Motor yüklenemedi", "bad");
        return;
      }
      secilen = info.bestmove;

      /* 2) En iyiyi her zaman oynamasın: alt seviyelerde motorun
         önerdiği ilk birkaç aday arasından rastgele seçiyoruz.
         Bu, oyunu "biraz zayıf" değil "insan gibi" hissettiriyor. */
      const adaylar = (info.altlar || []).filter(Boolean);
      if (a.aday > 1 && adaylar.length > 1) {
        const kac = Math.min(adaylar.length, a.aday);
        const sec = adaylar[Math.floor(Math.random() * kac)];
        if (sec && sec.bestmove) secilen = sec.bestmove;
      }
    }

    this._dusunmeBitti();
    if (this.over || !secilen) return;

    this.applyMove({ from: secilen.slice(0, 2), to: secilen.slice(2, 4), promotion: secilen[4] || "q" });
    this.finishIfOver();
  }

  _dusunmeBitti() {
    if (this.refs.spinner) this.refs.spinner.hidden = true;
    this.thinking = false;
    this.board.lock(false);
  }

  finishIfOver() {
    const end = this.checkEnd();
    if (!end) return false;
    this.over = true;
    this.board.lock(true);
    let outcome;
    if (!end.winner) outcome = "draw";
    else outcome = end.winner === this.playerColor ? "win" : "loss";
    AktifMac.temizle();          // maç normal bitti, yarım kalmış sayılmaz
    History.save(this, outcome, end.reason, "Bot · " + (this.levelName || ""));
    /* Geçiş reklamı YALNIZCA burada — bot maçı bittikten sonra, birkaç
       maçta bir. Oyun sırasında hiçbir yerde reklam gösterilmiyor. */
    if (typeof Reklam !== "undefined") Reklam.macBitti();
    GameOver.show(outcome, end.reason, () => App.startBotFromSetup(), this, true);
    return true;
  }

  resign() {
    if (this.over) return;
    this.over = true;
    this.board.lock(true);
    AktifMac.temizle();
    History.save(this, "loss", "Teslim oldun", "Bot · " + (this.levelName || ""));
    GameOver.show("loss", "Teslim oldun", () => App.startBotFromSetup(), this, true);
  }

  /** Bot maçında da geri alma yok — yalnızca son hamle gösterilir. */
  undo() {
    if (this.thinking) { Toast.show("Bot düşünüyor…", "info"); return; }
    this.peekLastMove();
  }
}

/* ------------------------------------------------------------
   3) KARŞILIKLI MOD (aynı cihaz + yerel ağ)
   ------------------------------------------------------------ */
class VersusGame extends GameBase {
  constructor(refs) { super(refs); this.mode = "pass"; this.myColor = "w"; this.net = null; }

  /**
   * Ağdan gelen hamleyi katı biçimde doğrular.
   * Yalnızca a1–h8 kare adları ve q/r/b/n terfisi kabul edilir.
   * @returns {{from,to,promotion?}|null}
   */
  temizHamle(m) {
    if (!m || typeof m !== "object") return null;
    const kare = /^[a-h][1-8]$/;
    const from = String(m.from ?? ""), to = String(m.to ?? "");
    if (!kare.test(from) || !kare.test(to)) return null;
    const out = { from, to };
    if (m.promotion != null) {
      const p = String(m.promotion).toLowerCase();
      if (!/^[qrbn]$/.test(p)) return null;
      out.promotion = p;
    }
    return out;
  }

  startPassPlay() {
    this.mode = "pass"; this.myColor = null; this.net = null;
    AktifMac.temizle();          // aynı cihaz maçı dereceli değil
    this.reset();
    this.board.setFlipped(false);
    this.refs.title.textContent = "Aynı Cihazda";
    this.refs.sub.textContent = "Sırayla oynayın";
    this.refs.undo.hidden = false;
    // Aynı cihazda teslim olmanın anlamı yok — buton gizlenir
    if (this.refs.resign) this.refs.resign.hidden = true;
    this.refs.actions?.classList.add("btn-row--1");
    this.updatePlayerBars();
  }

  startNet(transport, color) {
    this.mode = "net"; this.net = transport; this.myColor = color;
    this.rakipElo = null;                 // rakip kendini tanıtınca dolar
    this.rakipAd = null; this.rakipAvatar = null;
    this.reset();
    this.board.setFlipped(color === "b");
    this.refs.title.textContent = "Yerel Ağ";
    this.refs.sub.textContent = color === "w" ? "Beyaz oynuyorsun" : "Siyah oynuyorsun";
    this.refs.undo.hidden = false;         // gösterim amaçlı "Son Hamle" burada da var
    if (this.refs.resign) this.refs.resign.hidden = false;
    AktifMac.basla(this, "net");           // yarıda bırakma takibi
    this.refs.actions?.classList.remove("btn-row--1");
    this.updatePlayerBars();

    /* Ağdan gelen her şey GÜVENİLMEZDİR: biçimi doğrulanır, sırası
       denetlenir ve hata çıkarsa oyun çökmeden devam eder. */
    // Kendini tanıt: ad ve derece karşılıklı bildirilir
    /* Kendini tanıt. Fotoğraf küçültülmüş hâliyle gider: depodaki 256
       piksellik kare ~20 KB, veri kanalı için gereksiz büyük. */
    Profil.kucukAvatar().then(avatar => {
      transport.send({
        type: "hello",
        name: String(Store.data.profile.name || "Rakip").slice(0, 18),
        elo: Store.data.rating.elo,
        avatar
      });
    });

    transport.onMessage = msg => {
      try {
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "hello") {
          const e = Number(msg.elo);
          this.rakipElo = Number.isFinite(e) ? Math.min(4000, Math.max(100, Math.round(e))) : 1000;
          this.rakipAd = String(msg.name || "Rakip").slice(0, 18);
          /* Ağdan gelen resim GÜVENİLMEZ: yalnızca data:image/(png|jpeg|webp)
             biçimi ve boyut sınırı geçerse kabul edilir. */
          this.rakipAvatar = Profil.agdanGelenAvatar(msg.avatar);
          this.updatePlayerBars();
          return;
        }
        if (this.over) return;

        if (msg.type === "move") {
          const m = this.temizHamle(msg.move);
          if (!m) { console.warn("[Ağ] Geçersiz hamle yok sayıldı:", msg.move); return; }
          // Rakip yalnızca KENDİ sırasında oynayabilir
          if (this.chess.turn() === this.myColor) {
            console.warn("[Ağ] Sıra bizdeyken gelen hamle reddedildi.");
            Toast.show("Rakipten sıra dışı hamle geldi, yok sayıldı", "bad");
            return;
          }
          if (!this.applyMove(m)) { console.warn("[Ağ] Kural dışı hamle reddedildi:", m); return; }
          this.finishIfOver();

        } else if (msg.type === "resign") {
          this.over = true; this.board.lock(true);
          AktifMac.temizle();
          History.save(this, "win", "Rakip teslim oldu", "Yerel Ağ");
          this.closeNet();
          GameOver.show("win", "Rakip teslim oldu", () => App.goto("multi", "multiMenu"), this, true);
        }
      } catch (err) {
        console.warn("[Ağ] Mesaj işlenemedi, yok sayıldı:", err);
      }
    };
  }

  handleMove(mv) {
    if (this.over) return;
    if (this.mode === "net" && this.chess.turn() !== this.myColor) return;
    const res = this.applyMove(mv);
    if (!res) return;

    if (this.mode === "net" && this.net) {
      this.net.send({ type: "move", move: { from: res.from, to: res.to, promotion: res.promotion } });
    }
    // Pass & play: tahtayı sıradaki oyuncuya çevir
    if (this.mode === "pass" && Store.data.settings.autoFlip !== false) {
      this.board.setFlipped(this.chess.turn() === "b");
    }
    this.updatePlayerBars();
    this.finishIfOver();
  }

  oyuncuBilgisi() {
    if (this.mode === "net") {
      const p = Store.data.profile;
      const ben = { ad: p.name, avatar: p.avatar, elo: Store.data.rating.elo };
      const rakip = { ad: this.rakipAd || "Rakip", avatar: this.rakipAvatar || null,
                      elo: Number.isFinite(this.rakipElo) ? this.rakipElo : null };
      return this.myColor === "w" ? { w: ben, b: rakip } : { w: rakip, b: ben };
    }
    // Aynı cihazda: iki taraf da bu cihazın sahibi değil, renk adı yazılır
    return { w: { ad: "Beyaz", avatar: null }, b: { ad: "Siyah", avatar: null } };
  }

  updatePlayerBars() {
    const t = this.chess.turn();
    /* Çubuklar tahtanın yönüne göre doldurulur. Aynı cihazda oynarken
       tahta her hamlede döndüğü için "sırada" rozeti de yer değiştirmeli;
       eskiden rozet ve isimler sabit kalıp yanlış tarafı gösteriyordu. */
    const ustRenk = this.board.flipped ? "w" : "b";
    this.refs.topBadge.textContent = t === ustRenk ? "sırada" : "";
    this.refs.botBadge.textContent = t === ustRenk ? "" : "sırada";
    this.renderPlayerBars();
    // Ağ oyununda rakibin adı ve derecesi alt başlıkta görünsün
    if (this.mode === "net" && this.rakipAd && this.refs.sub) {
      const ben = this.myColor === "w" ? "Beyaz" : "Siyah";
      this.refs.sub.textContent = `${ben} oynuyorsun · Rakip: ${this.rakipAd} (${this.rakipElo})`;
    }
  }

  finishIfOver() {
    const end = this.checkEnd();
    if (!end) return false;
    this.over = true;
    this.board.lock(true);

    // Aynı cihazda oynanan maçlar S kazandırmaz (yalnızca yerel ağ kazandırır)
    const rewarded = this.mode === "net";
    let outcome;
    if (!end.winner) outcome = "draw";
    else if (this.mode === "net") outcome = end.winner === this.myColor ? "win" : "loss";
    else outcome = "win";

    AktifMac.temizle();
    if (rewarded) History.save(this, outcome, end.reason, "Yerel Ağ");
    this.closeNet();
    GameOver.show(outcome, end.reason, () => App.goto("multi", "multiMenu"), this, rewarded);
    return true;
  }

  resign() {
    if (this.over) return;
    this.over = true; this.board.lock(true);
    const rewarded = this.mode === "net";
    if (this.mode === "net" && this.net) this.net.send({ type: "resign" });
    AktifMac.temizle();
    if (rewarded) History.save(this, "loss", "Teslim oldun", "Yerel Ağ");
    // Mesajın karşıya ulaşması için kısa gecikmeyle bağlantıyı kapat
    setTimeout(() => this.closeNet(), 1200);
    GameOver.show("loss", "Teslim oldun", () => App.goto("multi", "multiMenu"), this, rewarded);
  }

  /** Ağ bağlantısını kapatır — yoklamanın sonsuza dek sürmesini önler. */
  closeNet() {
    if (this.net) { this.net.close(); this.net = null; }
    if (App.lan) App.lan = null;
  }

  /** Karşılıklı oyunda geri alma yok — yalnızca son hamle gösterilir. */
  undo() { this.peekLastMove(); }
}

/* ------------------------------------------------------------
   YEREL AĞ TAŞIMA KATMANI
   ------------------------------------------------------------
   İki arka uç:
   • relay        — server.js üzerindeki HTTP oda röle servisi
                    (aynı Wi-Fi'daki FARKLI cihazlar arasında çalışır)
   • broadcast    — BroadcastChannel (aynı tarayıcıdaki farklı sekmeler)
   ------------------------------------------------------------ */
class LanTransport {
  constructor() {
    this.kind = null;
    this.code = null;
    // Sunucu 4–40 karakter, [A-Za-z0-9_-] bekliyor; tahmin edilemez olmalı
    this.playerId = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "")
                                       : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 32);
    this.token = null;
    this.onMessage = () => {};
    this.onPeerJoin = () => {};
    this._since = 0;
    this._poll = null;
    this._bc = null;
  }

  /** Röle servisi var mı? (server.js çalışıyorsa evet) */
  static async detect() {
    try {
      const r = await fetch("/api/ping", { cache: "no-store" });
      if (r.ok) return "relay";
    } catch (_) {}
    return typeof BroadcastChannel !== "undefined" ? "broadcast" : null;
  }

  async create() {
    this.kind = await LanTransport.detect();
    if (this.kind === "relay") {
      const r = await fetch("/api/room/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: this.playerId })
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Oda kurulamadı");
      this.code = j.code;
      this.token = j.token;          // odaya erişim jetonu
      this._startPoll();
    } else {
      this.code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
      this._openChannel();
    }
    this.color = "w";
    return this.code;
  }

  async join(code) {
    this.kind = await LanTransport.detect();
    this.code = code.toUpperCase();
    if (this.kind === "relay") {
      const r = await fetch("/api/room/join", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: this.code, playerId: this.playerId })
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Oda bulunamadı");
      this.token = j.token;
      this._startPoll();
    } else {
      this._openChannel();
      this._bc.postMessage({ __join: true, from: this.playerId });
    }
    this.color = "b";
    return true;
  }

  _openChannel() {
    this._bc = new BroadcastChannel("sah-room-" + this.code);
    this._bc.onmessage = e => {
      const d = e.data;
      if (d.from === this.playerId) return;
      if (d.__join) { this.onPeerJoin(); this._bc.postMessage({ __ack: true, from: this.playerId }); return; }
      if (d.__ack)  { this.onPeerJoin(); return; }
      this.onMessage(d);
    };
  }

  _startPoll() {
    clearInterval(this._poll);
    this._misses = 0;
    this._poll = setInterval(async () => {
      try {
        const q = new URLSearchParams({ code: this.code, since: String(this._since),
                                        playerId: this.playerId, token: this.token || "" });
        const r = await fetch("/api/room/state?" + q, { cache: "no-store" });
        if (!r.ok) {
          // Oda kaybolduysa (sunucu yeniden başladı, süre doldu) yoklamayı bırak
          if (++this._misses >= 5) { console.warn("[Ağ] Oda bulunamadı, yoklama durduruldu."); this.close(); }
          return;
        }
        this._misses = 0;
        const j = await r.json();
        if (j.players >= 2 && !this._peerSeen) { this._peerSeen = true; this.onPeerJoin(); }
        (j.events || []).forEach(ev => { this._since = Math.max(this._since, ev.seq); this.onMessage(ev.data); });
      } catch (_) {
        if (++this._misses >= 10) this.close();
      }
    }, 700);
  }

  send(msg) {
    if (this.kind === "relay") {
      fetch("/api/room/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: this.code, playerId: this.playerId, token: this.token, data: msg })
      }).catch(() => {});
    } else if (this._bc) {
      this._bc.postMessage({ ...msg, from: this.playerId });
    }
  }

  close() {
    clearInterval(this._poll);
    if (this._bc) { this._bc.close(); this._bc = null; }
  }
}
