/* ============================================================
   ŞAHNAME — Doğrudan cihazdan cihaza bağlantı (WebRTC)
   ------------------------------------------------------------
   Sunucu YOK. İki telefon aynı Wi-Fi ağındayken doğrudan
   birbirine bağlanır; el sıkışma QR kodlarıyla yapılır.

   Akış:
     1) Ev sahibi teklif (offer) üretir  → QR olarak gösterir
     2) Rakip bu QR'ı okutur, cevap (answer) üretir → QR gösterir
     3) Ev sahibi cevabı okutur → bağlantı kurulur

   SDP metni QR'a sığsın diye gzip + base64url ile sıkıştırılır
   (tipik 1.3 KB → ~600 karakter).

   Not: Sadece yerel ağ hedeflendiği için STUN/TURN kullanılmaz;
   yalnızca "host" adayları toplanır. Bu hem daha küçük hem daha hızlı.
   ============================================================ */
"use strict";

const P2P = {
  /* ---------- Sıkıştırma ---------- */

  async _gzip(metin) {
    if (typeof CompressionStream !== "function") return null;
    const cs = new CompressionStream("gzip");
    const yazici = cs.writable.getWriter();
    yazici.write(new TextEncoder().encode(metin));
    yazici.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  },

  async _gunzip(bayt) {
    const ds = new DecompressionStream("gzip");
    const yazici = ds.writable.getWriter();
    yazici.write(bayt);
    yazici.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  },

  _b64url(bayt) {
    let s = "";
    for (const b of bayt) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },

  _b64urlCoz(s) {
    const d = s.replace(/-/g, "+").replace(/_/g, "/");
    const ham = atob(d + "=".repeat((4 - d.length % 4) % 4));
    const out = new Uint8Array(ham.length);
    for (let i = 0; i < ham.length; i++) out[i] = ham.charCodeAt(i);
    return out;
  },

  /** SDP'den yerel ağda gereksiz satırları atar (QR'ı küçültür). */
  _sadelestir(sdp) {
    return sdp.split("\r\n")
      .filter(l => !/^a=candidate:.* typ (srflx|relay|prflx)/.test(l))
      .filter(l => !/^a=(extmap|rtcp-fb|ssrc|msid|rtpmap|fmtp)/.test(l))
      .join("\r\n");
  },

  async paketle(desc) {
    const yuk = this._sadelestir(desc.sdp);
    const gz = await this._gzip(yuk);
    if (gz) return (desc.type === "offer" ? "O." : "A.") + this._b64url(gz);
    // Sıkıştırma yoksa düz base64 (QR daha büyük olur ama çalışır)
    return (desc.type === "offer" ? "o." : "a.") + this._b64url(new TextEncoder().encode(yuk));
  },

  async ac(metin) {
    const s = String(metin || "").trim();
    const tip = /^[OoAa]\./.test(s) ? (s[0].toLowerCase() === "o" ? "offer" : "answer") : null;
    if (!tip) throw new Error("Tanınmayan bağlantı kodu");
    const bayt = this._b64urlCoz(s.slice(2));
    const sdp = /^[OA]\./.test(s) ? await this._gunzip(bayt) : new TextDecoder().decode(bayt);
    return { type: tip, sdp: sdp.endsWith("\r\n") ? sdp : sdp + "\r\n" };
  }
};

/* ------------------------------------------------------------
   EŞLER ARASI TAŞIMA KATMANI
   LanTransport ile aynı arayüz: send / close / onMessage / onPeerJoin
   ------------------------------------------------------------ */
class P2PTransport {
  constructor() {
    this.pc = null;
    this.kanal = null;
    this.rol = null;              // "host" | "guest"
    this.bagli = false;
    this.onMessage = () => {};
    this.onPeerJoin = () => {};
    this.onDurum = () => {};      // arayüze durum bildirir
    this.onKopma = () => {};
    this._kapandi = false;
  }

  /**
   * Tarayıcı, gizlilik için yerel IP'leri "xxxx.local" (mDNS) adlarıyla gizler.
   * İki AYRI cihaz arasında bu adların çözülmesi garanti değildir; bağlantı
   * kurulamayabilir. Kamera izni verildiğinde tarayıcı gerçek yerel IP'leri
   * açığa çıkarır — QR okuma için zaten kamera izni gerektiğinden, izni
   * el sıkışmadan ÖNCE alıp güvenilir adaylar toplarız.
   */
  static async yerelIpKilidiAc() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
      const akis = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      akis.getTracks().forEach(t => t.stop());   // izin yeter, görüntü gerekmiyor
      return true;
    } catch (e) {
      console.warn("[P2P] Kamera izni yok — mDNS adaylarıyla denenecek:", e.name);
      return false;
    }
  }

  _pcKur() {
    // Yerel ağ: dış sunucu yok, yalnızca "host" adayları toplanır
    const pc = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });

    pc.onconnectionstatechange = () => {
      const d = pc.connectionState;
      this.onDurum(d);
      if (d === "connected" && !this.bagli) { this.bagli = true; this.onPeerJoin(); }
      if ((d === "failed" || d === "disconnected" || d === "closed") && this.bagli && !this._kapandi) {
        this.onKopma(d);
      }
    };
    this.pc = pc;
    return pc;
  }

  _kanalBagla(kanal) {
    this.kanal = kanal;
    kanal.onopen = () => { if (!this.bagli) { this.bagli = true; this.onPeerJoin(); } };
    kanal.onmessage = e => {
      try { this.onMessage(JSON.parse(e.data)); }
      catch (err) { console.warn("[P2P] Bozuk mesaj yok sayıldı:", err); }
    };
    kanal.onclose = () => { if (this.bagli && !this._kapandi) this.onKopma("kanal kapandı"); };
  }

  /** ICE aday toplama bitene kadar bekler (trickle yok — tek QR yeterli olsun). */
  _adaylarHazir(pc, sureSiniri = 4000) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === "complete") return resolve();
      const bitir = () => { pc.removeEventListener("icegatheringstatechange", kontrol); clearTimeout(zaman); resolve(); };
      const kontrol = () => { if (pc.iceGatheringState === "complete") bitir(); };
      pc.addEventListener("icegatheringstatechange", kontrol);
      // Bazı ortamlarda "complete" hiç gelmez; toplanan kadarıyla devam et
      const zaman = setTimeout(bitir, sureSiniri);
    });
  }

  /** EV SAHİBİ: teklif üretir, QR'a yazılacak metni döndürür. */
  async teklifUret() {
    this.rol = "host";
    await P2PTransport.yerelIpKilidiAc();     // gerçek IP adayları için
    const pc = this._pcKur();
    this._kanalBagla(pc.createDataChannel("sah", { ordered: true }));
    const teklif = await pc.createOffer();
    await pc.setLocalDescription(teklif);
    await this._adaylarHazir(pc);
    return P2P.paketle(pc.localDescription);
  }

  /** EV SAHİBİ: rakipten okuttuğu cevabı uygular. */
  async cevabiUygula(metin) {
    const desc = await P2P.ac(metin);
    if (desc.type !== "answer") throw new Error("Bu bir cevap kodu değil");
    await this.pc.setRemoteDescription(desc);
  }

  /** RAKİP: teklifi okur, cevap üretir ve QR'a yazılacak metni döndürür. */
  async cevapUret(teklifMetni) {
    this.rol = "guest";
    const desc = await P2P.ac(teklifMetni);
    if (desc.type !== "offer") throw new Error("Bu bir davet kodu değil");

    await P2PTransport.yerelIpKilidiAc();     // gerçek IP adayları için
    const pc = this._pcKur();
    pc.ondatachannel = e => this._kanalBagla(e.channel);
    await pc.setRemoteDescription(desc);
    const cevap = await pc.createAnswer();
    await pc.setLocalDescription(cevap);
    await this._adaylarHazir(pc);
    return P2P.paketle(pc.localDescription);
  }

  send(msg) {
    if (this.kanal && this.kanal.readyState === "open") {
      try { this.kanal.send(JSON.stringify(msg)); }
      catch (e) { console.warn("[P2P] Gönderilemedi:", e); }
    }
  }

  close() {
    this._kapandi = true;
    try { this.kanal && this.kanal.close(); } catch (_) {}
    try { this.pc && this.pc.close(); } catch (_) {}
    this.kanal = null; this.pc = null; this.bagli = false;
  }

  /** Ortam WebRTC destekliyor mu? */
  static destekleniyorMu() {
    return typeof RTCPeerConnection === "function";
  }
}
