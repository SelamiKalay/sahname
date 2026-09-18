/* ============================================================
   ŞAHNAME — Native köprü (yalnızca uygulama içinde çalışır)
   ------------------------------------------------------------
   Tarayıcıda hiçbir şey yapmaz; Capacitor varsa devreye girer:
     • Android geri tuşu → uygulamadan çıkmak yerine geri gitmek
     • Titreşim → native Haptics (WebView'de navigator.vibrate zayıf)
     • Durum çubuğu rengi
     • Native açılış ekranını web hazır olunca kapatmak
   ============================================================ */
"use strict";

const Native = {
  var: false,
  eklenti: {},

  async baslat() {
    const C = window.Capacitor;
    this.var = !!(C && C.isNativePlatform && C.isNativePlatform());
    if (!this.var) return false;

    this.eklenti = C.Plugins || {};
    document.documentElement.classList.add("is-native");

    await this._durumCubugu();
    this._geriTusu();
    this._titresim();
    this._kenarPayi();
    this._arkaPlanKaydi();
    await this._acilisKapat();

    console.log("[Native] Uygulama modu etkin.");
    return true;
  },

  async _durumCubugu() {
    const sb = this.eklenti.StatusBar;
    if (!sb) return;
    try {
      await sb.setStyle({ style: "DARK" });          // açık ikonlar, koyu zemin
      await sb.setBackgroundColor({ color: "#0d0f14" });
      await sb.setOverlaysWebView({ overlay: false });
    } catch (e) { console.warn("[Native] Durum çubuğu ayarlanamadı:", e); }
  },

  /**
   * Android geri tuşu: uygulamadan çıkmak yerine bir adım geri gider.
   * Sıra: açık pencere → alt ekran → sekme → ikinci basışta çıkış.
   */
  _geriTusu() {
    const App = this.eklenti.App;
    if (!App) return;
    let cikisIcinBekliyor = false;

    App.addListener("backButton", () => {
      // 1) Açık bir pencere varsa onu kapat
      const pencere = document.querySelector(
        "#scanModal:not([hidden]), #previewModal:not([hidden]), #confirmModal:not([hidden]), " +
        "#gameOverModal:not([hidden]), .promo-sheet:not([hidden])");
      if (pencere) {
        if (pencere.id === "scanModal") Scanner.close();
        else if (pencere.id === "previewModal") Preview.hide();
        else if (pencere.id === "confirmModal") document.getElementById("cfCancel").click();
        else if (pencere.id === "gameOverModal") GameOver.hide();
        else Promotion._done(null);
        return;
      }

      // 2) Sekme içinde bir alt ekrandaysak menüye dön
      const aktifGorunum = document.querySelector(".view.is-active");
      const altEkran = aktifGorunum && aktifGorunum.querySelector(".screen.is-active");
      if (altEkran && !altEkran.matches("#multiMenu, #botSetup")) {
        if (altEkran.id === "botGame") { Engine.clearQueue(); Router.screen("botSetup"); }
        else { App.closeLan(); Router.screen("multiMenu"); }
        return;
      }

      // 3) Öğretici dışındaysak ana sekmeye dön
      if (Router.current !== "learn") { Router.go("learn"); return; }

      // 4) Öğreticideysek: iki saniye içinde ikinci basış çıkarır
      if (cikisIcinBekliyor) { App.exitApp(); return; }
      cikisIcinBekliyor = true;
      Toast.show("Çıkmak için tekrar bas", "info", 2000);
      setTimeout(() => { cikisIcinBekliyor = false; }, 2000);
    });
  },

  /** Titreşimi native Haptics'e yönlendirir (WebView'de daha güvenilir). */
  _titresim() {
    const H = this.eklenti.Haptics;
    if (!H) return;
    const eski = Haptics.tap.bind(Haptics);
    Haptics.tap = (desen = 8) => {
      if (!Store.data || !Store.data.settings.vibrate) return;
      try {
        const sure = Array.isArray(desen) ? desen.reduce((a, b) => a + b, 0) : desen;
        if (sure <= 12)      H.impact({ style: "LIGHT" });
        else if (sure <= 40) H.impact({ style: "MEDIUM" });
        else                 H.impact({ style: "HEAVY" });
      } catch (_) { eski(desen); }
    };
    Haptics.userReady = true;   // native tarafta kullanıcı hareketi şartı yok
  },

  /**
   * Android'in kenar "geri" hareketi, ekranın sol/sağ kenarından başlayan
   * yatay kaydırmaları yutar. Bu yüzden sekme geçişi kenardan başlatıldığında
   * çalışmaz. Kenarlarda küçük bir ölü bölge bırakıp kullanıcıyı ortadan
   * kaydırmaya yönlendiriyoruz (uygulama içi hareket orada sorunsuz çalışır).
   */
  _kenarPayi() {
    document.documentElement.style.setProperty("--kenar-payi", "24px");
    if (typeof Swipe !== "undefined") Swipe.kenarPayi = 24;
  },

  /**
   * Uygulama arka plana atıldığı anda süren maçı kaydeder.
   * Sistem uygulamayı bellekten atarsa bile maç kaybolmaz ve
   * bir sonraki açılışta "devam et / teslim ol" olarak sunulur.
   */
  _arkaPlanKaydi() {
    const A = this.eklenti.App;
    if (!A) return;
    A.addListener("appStateChange", ({ isActive }) => {
      if (isActive) return;
      try {
        /* App bir `const` olduğu için window üzerinden erişilmez —
           aynı betik kapsamındaki adı doğrudan kullanıyoruz. */
        const oyun = Router.current === "bot" ? App.bot : App.versus;
        if (oyun && !oyun.over && oyun.chess.history().length) AktifMac.kaydet(oyun);
      } catch (e) { console.warn("[Native] Arka plan kaydı başarısız:", e); }
    });
  },

  /** Web arayüzü hazır olunca native açılış ekranını kapatır. */
  async _acilisKapat() {
    const S = this.eklenti.SplashScreen;
    if (!S) return;
    try { await S.hide({ fadeOutDuration: 250 }); }
    catch (e) { console.warn("[Native] Açılış ekranı kapatılamadı:", e); }
  }
};
