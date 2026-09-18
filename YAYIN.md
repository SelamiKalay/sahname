# Şahname — Play Store yayın adımları

Bu dosya, uygulamayı Google Play'e çıkarmak için **senin yapman gereken**
işleri sırayla anlatır. Kod tarafındaki hazırlıklar tamamlandı.

---

## 1. Yayın imzası (ilk ve en kritik adım)

Play, uygulamayı kalıcı bir anahtarla imzalamanı ister. **Bu anahtarı
kaybedersen uygulamanın güncellemesini bir daha yayınlayamazsın** — yeni
anahtarla yüklenen paket Play tarafından farklı bir uygulama sayılır.

Anahtarı sen üretmelisin (parolayı ben bilmemeliyim). Proje klasöründe:

```bash
keytool -genkeypair -v -keystore sahname-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias sahname
```

Komut sırayla parola ve kimlik bilgilerini soracak. Sonra proje kökünde
`keystore.properties` dosyasını oluştur:

```
storeFile=C:/GuvenliKlasor/sahname-release.jks
storePassword=belirlediğin-parola
keyAlias=sahname
keyPassword=belirlediğin-parola
```

**Yedekle:** `.jks` dosyasını ve parolayı en az iki ayrı güvenli yerde sakla
(şifre yöneticisi + harici disk). `.gitignore` bunları dışarıda tutuyor,
yani yanlışlıkla paylaşılmazlar.

Bunlar hazır olunca yayın paketi:

```bash
node build.js && npx cap sync android && cd android && ./gradlew bundleRelease
```

Çıktı: `android/app/build/outputs/bundle/release/app-release.aab` — Play'e
yüklenecek dosya budur (APK değil, AAB).

---

## 2. AdMob gerçek kimlikleri

Şu an **Google'ın resmi test kimlikleri** kullanılıyor. Test reklamı
gösterirler, gelir getirmezler ve hesabı riske atmazlar. Gerçek reklam için:

1. [admob.google.com](https://admob.google.com) üzerinden hesap aç
2. Uygulamayı ekle, iki reklam birimi oluştur: **ödüllü** ve **geçiş**
3. Şu iki yeri birlikte güncelle:
   - `android/app/src/main/AndroidManifest.xml` → `APPLICATION_ID`
   - `app.js` → `Reklam.BIRIM` ve `Reklam.TEST_KIMLIGI = false`
4. AdMob panelinde **Gizlilik ve mesajlaşma → AB kullanıcı rızası** mesajını
   tanımla (kod tarafındaki rıza akışı bunu çağırıyor, mesaj tanımlanmazsa
   AB'de reklam sunulmaz)

**Uyarı:** kimlikleri değiştirmeden kendi reklamlarına tıklamak hesabın
kalıcı kapanmasına yol açar.

---

## 3. Uygulama içi satın alma (S-Coin paketleri)

Kod hazır ama **eklenti kurulu değil**. Etkinleştirmek için:

1. Play Console'da uygulamayı yayınla (kapalı test bile yeterli)
2. **Ürünler → Uygulama içi ürünler** altında dört tüketilebilir ürün aç.
   Kimlikler `app.js` içindeki `Kasa.PAKETLER` ile birebir aynı olmalı:
   `sahname_coin_500`, `sahname_coin_1200`, `sahname_coin_2600`,
   `sahname_coin_7000`
3. Bir faturalandırma eklentisi kur (örn. `@capacitor-community/in-app-purchases`)

`Odeme` katmanı eklentiyi kendiliğinden bulur; arayüz kodu değişmez.

**Not:** Faturalandırma yalnızca uygulama **Play Store'dan kurulduğunda**
çalışır. APK ile dağıtılan sürümde satın alma kapalı kalır ve kullanıcıya
sebebi açıkça yazılır.

---

## 4. Play Console'da doldurulacaklar

**Gizlilik politikası (zorunlu).** Kamera izni, reklam kimliği ve geri
bildirim formu yüzünden isteniyor. İçermesi gerekenler:

- Oyun verilerinin **cihazda** tutulduğu, sunucuya gönderilmediği
- Kameranın **yalnızca QR okuma** için kullanıldığı, görüntünün
  kaydedilmediği ve gönderilmediği
- Geri bildirim gönderilirse eklenen bilgiler: ad, cihaz kimliği, derece,
  bakiye, uygulama sürümü (fotoğraf gönderilmez)
- AdMob'un reklam kimliği kullandığı

**Veri güvenliği formu.** Beyan edilecekler:
- Reklam kimliği → toplanıyor (AdMob)
- E-posta adresi → yalnızca kullanıcı geri bildirimde isteyerek verirse
- Kamera → cihazda işleniyor, gönderilmiyor

**İçerik derecelendirmesi.** Satranç, şiddet içermez. Reklam içerdiği ve
uygulama içi satın alma bulunduğu işaretlenmeli.

**Mağaza kaydı.** Ekran görüntüleri (en az 2), 512×512 ikon, 1024×500
öne çıkan görsel, kısa ve uzun açıklama.

---

## 5. Sürüm numarası

`build.js` her çalıştığında `versionCode`'u bir artırır ve `app.js`
içindeki derleme damgasını günceller. **`versionName`'i elle yönetiyorsun:**
`app.js` içindeki `SURUM.ad` değerini değiştir, `build.js` onu gradle'a
taşır. Play aynı `versionCode`'u iki kez kabul etmez.

---

## 6. Yayın öncesi son kontrol

```bash
cd android && ./gradlew bundleRelease
```

- [ ] `keystore.properties` yerinde, paket imzalı çıkıyor
- [ ] AdMob kimlikleri gerçek, `TEST_KIMLIGI = false`
- [ ] Gizlilik politikası bağlantısı Play Console'da girildi
- [ ] Veri güvenliği formu dolduruldu
- [ ] Kapalı testte en az bir cihazda kurulup denendi
