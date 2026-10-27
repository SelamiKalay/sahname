# Şahname — Satranç Antrenörü

[English](README.md) | **Türkçe**

<p align="center"><img src="docs/ekran-goruntusu.jpeg" alt="Şahname ekran görüntüsü" width="320"></p>

Satrancı öğrenmek ve oynamak için geliştirilmiş, internet olmadan oynanabilen bir
mobil satranç uygulaması. Web teknolojileriyle yazılıp Capacitor ile Android'e
paketlenmiştir.

## Özellikler

- **Öğren** — taşların hareketlerini tahta üzerinde gösteren interaktif dersler
- **Bota karşı** — tarayıcıda çalışan Stockfish motoruna karşı ayarlanabilir
  zorlukta oyun; hamleleri Türkçe açıklayan analiz yardımcısı
- **İki kişilik** — aynı Wi-Fi ağındaki iki telefon arasında **sunucusuz** oyun:
  WebRTC bağlantısı QR kodlarıyla kurulur (SDP, QR'a sığması için gzip +
  base64url ile sıkıştırılır)
- **Mağaza** — tahta ve taş temaları, nadirlik seviyeleri, oyun içi coin ekonomisi
- **Profil ve derece** — oyuncu profili, maç geçmişi, derece sistemi
- **Promosyon kodları** — HMAC-SHA256 ile imzalanan, istenirse cihaza bağlanabilen kodlar
- **Geri bildirim formu**, titreşim, ses efektleri, açık/koyu tema
- Tüm oyun verileri cihazda saklanır; oyun internet olmadan oynanır. İnternet
  yalnızca reklamlar (AdMob) ve geri bildirim formu için kullanılır

## Teknolojiler

HTML · CSS · JavaScript · Capacitor 6 · Stockfish (WebAssembly) · chess.js ·
WebRTC · jsQR / qrcodejs · AdMob

## Proje Yapısı

```
index.html, style.css      Arayüz
app.js                     Uygulama mantığı (profil, mağaza, dersler, ekonomi, yönlendirme)
game.js                    Oyun tahtası ve maç akışı
engine.js                  Stockfish ile iletişim
p2p.js                     WebRTC + QR ile cihazdan cihaza bağlantı
native.js                  Capacitor eklentileri (titreşim, durum çubuğu, depolama)
tools/dev-server.js        Yalnızca geliştirme: yerel ağda test sunucusu ve oda rölesi (pakete girmez)
build.js                   Paketlenecek dosyaları www/ klasörüne toplar
vendor/                    Gömülü kütüphaneler (çevrimdışı çalışma için)
android/                   Capacitor Android projesi
```

## Geliştirme

```bash
npm install
npm run sunucu        # http://localhost:5173 — aynı Wi-Fi'deki cihazlardan da açılabilir
npm test              # geliştirme sunucusu duman testleri (GitHub Actions her push'ta çalıştırır)
```

## Android Derlemesi

JDK 17 ve Android SDK gerekir.

```bash
npm run senkron       # node build.js + npx cap sync android
cd android
gradlew assembleDebug
```

Play Store yayın adımları için bkz. [YAYIN.md](YAYIN.md).

## Yapılandırma

Aşağıdaki değerler güvenlik nedeniyle depoya konmamıştır; `app.js` içinde
kendi değerlerinizle doldurun:

| Sabit | Açıklama |
|---|---|
| `Promosyon.GIZLI` | Promosyon kodlarını imzalayan gizli anahtar |
| `GeriBildirim.ANAHTAR` | [Web3Forms](https://web3forms.com) erişim anahtarı |
| `GeriBildirim.MAIL` | Form çalışmazsa kullanılacak yedek e-posta adresi |

> **Promosyon kodlarının sınırı:** Kodlar uygulama içinde doğrulandığı için
> `Promosyon.GIZLI` yayın paketine (APK) gömülür. İmza, kodların tahmin edilmesini
> ve elle üretilmesini zorlaştırır; ancak APK'yı açabilen biri anahtarı bulup
> kendi kodunu üretebilir. Bu yüzden kodlar yalnızca oyun içi kozmetik ödüller
> içindir; gerçek değeri olan ödüller için doğrulamanın sunucuda yapılması gerekir.

Yayın imzası (`*.jks`, `keystore.properties`) da `.gitignore` ile dışarıda tutulur.

## Lisans

Bu proje **GNU GPL v3** ile lisanslanmıştır; çünkü GPLv3 lisanslı
[Stockfish](https://github.com/official-stockfish/Stockfish) motorunun JavaScript
derlemesini ([stockfish.js](https://github.com/niklasf/stockfish.js)) içerir.
