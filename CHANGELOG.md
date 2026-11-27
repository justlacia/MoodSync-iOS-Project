# Değişiklikler (Changelog)

## v3.0.0 — 27 Kasım 2026 / November 27, 2026

### 🇹🇷 Türkçe — Neler Yeni?

#### ☁️ Azure Bulut Mimarisi & iOS Senkronizasyonu (`cloud-api/`, `cloudConfig.ts`, `cloudApi.ts`, `iosDatabase.ts`, `App.tsx`)
- **Tam Bulut Senkronizasyonu:** Hesaplar, biyometrik (Face ID) token eşleştirmeleri, tarama oturumları, günlük notları/etiketleri, mod stratejileri, favoriler, beğenilmeyen parçalar ("Bir Daha Önerme") ve özel çalma listeleri artık Azure PostgreSQL Flexible Server (10 tablo: `users`, `biometric_tokens`, `tracks`, `favorites`, `disliked_tracks`, `scan_sessions`, `scan_session_tracks`, `playlists`, `playlist_tracks`, `user_settings`) üzerinde tutuluyor.
- **Özel Azure Blob Fotoğraf Depolama (`blobStorage.ts`):** Tarama fotoğrafları herkese kapalı `snapshots` konteynerine yüklenip 24 saatlik imzalı SAS URL'leriyle güvenli biçimde sunuluyor.
- **Hibrit Gizlilik & Bulut Auth:** Duygu analizi (AffectNet EfficientNet-B2 ONNX + Apple Vision) cihaz içinde kalırken, iOS uygulaması JWT oturumları ve SHA-256 özetli Face ID token doğrulamasıyla doğrudan Azure App Service API'sine (`https://moodsync-api-haluk.azurewebsites.net`) bağlanır (`AdminPanelScreen.tsx`, `LibraryScreen.tsx`, `SettingsScreen.tsx`).

#### 🎵 3.055+ Doğrulanmış Bulut Şarkı Kataloğu & Duygu Denetimi (`musicCatalog.ts`, `seedCatalogCli.ts`, `server.ts`)
- **Merkezi Bulut Kataloğu:** Kullanıcıların cihazlarında tek tek şarkı çekmesine gerek kalmadan Türkçe ve global iTunes/Deezer şarkıları bulutta merkezi olarak barındırılır.
- **Tam Katalog Duygu/Enerji Denetimi:** 3.129 şarkının tamamı analiz edilerek yanlış sınıflandırılan **822 şarkının** `mood` ve `energy_tag` değerleri düzeltildi (ör. hüzünlü pop baladlarının `positive/upbeat` yerine `negative/emotional` alınması, sinematik parçaların `neutral/chill`, protest rock parçalarının `negative/angry-rock`, hareketli parçaların `positive/upbeat` / `positive/energetic` işaretlenmesi).
- **Kirlilik ve Tekrar Temizliği:** Şarkı olmayan skit kayıtları, karma aramalardan sızan sahte piyano/koro cover uyarlamaları, karaoke, KIDZ BOP, Nightcore ve yinelenen kopyalar dahil **74 kayıt** temizlenerek **3.055** temiz parçaya ulaşıldı.
- **Kalıcı Katalog Koruması & Admin API'leri:** Sanatçı keşif listeleri ayrıştırıldı, karma arama terimleri temizlendi, `isJunkTrack` filtresi hem iTunes hem Deezer çekimlerine eklendi; işlemli toplu güncelleme (`PATCH /api/admin/tracks/bulk`) ve tekil şarkı düzenleme (`PATCH /api/admin/tracks/:trackId`) uç noktaları eklendi.

#### 🌐 Responsive Web & Görsel Admin Portalı (`cloud-api/public/`, `server.ts`, `blobStorage.ts`)
- **Tek Sunucu Web Portalı (`/` ve `/admin`):** Doğrudan `cloud-api` üzerinden sunulan OLED Koyu + Aydınlık Liquid Glass temalı web arayüzü eklendi; hem kullanıcı ekranları (**Taramalarım**, **Şarkılar**, **Listelerim**) hem sıfır-SQL görsel admin panelleri tek yerden erişilebilir.
- **Görsel Admin & Veri Araçları:** **Genel Bakış** KPI'ları, **Hesaplar** (kullanıcı oluşturma, rol ve şifre yönetimi), **Tüm Taramalar**, Lightbox büyütmeli **Fotoğraf Galerisi (Blob)** (`GET /api/admin/blobs`) ve hassas hash sütunları (`password_hash`, `token_hash`) maskelenmiş tıklanabilir 10 tablolu Excel benzeri **Tablo Gezgini** (+ isteğe bağlı salt-okunur SQL çekmecesi).

#### 🔊 Gelişmiş Web Ses Oynatıcısı (`index.html`, `styles.css`, `app.js`)
- `GET /api/tracks/:trackId/preview` üzerinden akış çalan kalıcı alt oynatıcıya **%0–%100 ses seviyesi kaydırıcısı**, anlık yüzde göstergesi (`localStorage` kalıcılığı), dinamik ikonlu **sessize alma/açma (`🔇/🔈/🔉/🔊`)**, ses kutusu üzerinde **fare tekerleğiyle %5 adımlı ayar**, **tekrar çalma (`🔁`)**, klavye kısayolları (**`M`** sessize alma, **`Space`** oynat/duraklat), canlı satır senkronizasyonu ve mobil/tablet uyumlu düzen eklendi.

#### 🛡️ Güvenlik & Depo Hijyeni (`.gitignore`, `auth.ts`, `server.ts`)
- Tek yönlü `bcrypt` şifre özetleme, `SHA-256` biyometrik token saklama, admin tablo sorgularında hash maskeleme ve `.gitignore` üzerinden `.env*`, `deploy.zip`, `dist/` ve `node_modules/` dışlamaları yapılandırıldı.

---

### 🇬🇧 English — What's New?

#### ☁️ Azure Cloud Backend & iOS Sync (`cloud-api/`, `cloudConfig.ts`, `cloudApi.ts`, `iosDatabase.ts`, `App.tsx`)
- **Cloud-Backed Persistence:** Migrated accounts, Face ID biometric token bindings, scan sessions, journals/tags, mood strategies, favorites, disliked tracks, and custom playlists to **Azure PostgreSQL Flexible Server** (10 tables: `users`, `biometric_tokens`, `tracks`, `favorites`, `disliked_tracks`, `scan_sessions`, `scan_session_tracks`, `playlists`, `playlist_tracks`, `user_settings`).
- **Private Azure Blob Photo Storage (`blobStorage.ts`):** Scan snapshots are stored in a private `snapshots` container and served securely via short-lived 24h signed SAS URLs.
- **Hybrid On-Device AI + Cloud Auth:** Facial emotion inference (AffectNet ONNX + Apple Vision) stays strictly on-device while iOS syncs via JWT auth and SHA-256 Face ID tokens against the Azure App Service API (`AdminPanelScreen.tsx`, `LibraryScreen.tsx`, `SettingsScreen.tsx`).

#### 🎵 3,055+ Curated Cloud Track Catalog & Mood Audit (`musicCatalog.ts`, `seedCatalogCli.ts`, `server.ts`)
- **Centralized Cloud Catalog:** Thousands of Turkish and global songs (iTunes & Deezer) are hosted centrally in the cloud instead of relying on device-side scraping.
- **Full-Catalog Mood & Energy Audit:** Audited all 3,129 tracks, reclassifying **822 mislabeled songs** across accurate `mood` and `energy_tag` buckets and removing **74** non-song skits, knockoff piano/choir covers, KIDZ BOP, Nightcore, karaoke, and duplicate tracks (**3,055 curated tracks**).
- **Long-Term Catalog Safeguards & Endpoints:** Separated artist discovery keyword banks, removed spam-prone compound queries, added shared `isJunkTrack` filtering for both iTunes and Deezer fetchers, and added transactional `PATCH /api/admin/tracks/bulk` & `PATCH /api/admin/tracks/:trackId` admin endpoints.

#### 🌐 Responsive Web & Visual Admin Portal (`cloud-api/public/`, `server.ts`, `blobStorage.ts`)
- **Built-In Web App (`/` & `/admin`):** OLED Dark + Light Liquid Glass responsive SPA served directly from `cloud-api`, providing user views (**My Scans**, **Tracks**, **Playlists**) and zero-SQL visual admin dashboards (**Overview**, **Accounts**, **All Scans**, Lightbox **Blob Photo Gallery** via `GET /api/admin/blobs`, clickable 10-table Explorer with masked password/token hashes, and an optional read-only SQL drawer).

#### 🔊 Enhanced Web Audio Player (`index.html`, `styles.css`, `app.js`)
- Persistent bottom bar featuring track preview streaming (`GET /api/tracks/:trackId/preview`), **0–100% volume slider** with `localStorage` persistence, **mute/unmute toggle** with dynamic icons, **mouse-wheel 5% volume adjustment**, **loop toggle**, keyboard shortcuts (**`M`** mute, **`Space`** play/pause), track-row playback state sync, and mobile/tablet responsive player controls.

#### 🛡️ Security & Repository Hygiene (`.gitignore`, `auth.ts`, `server.ts`)
- Enforced one-way `bcrypt` password hashing, `SHA-256` biometric token hashing, admin hash masking, and `.gitignore` exclusions for `.env*`, `deploy.zip`, `dist/`, and `node_modules/`.

---

## v2.2.0 — 23 Kasım 2026

### Genişleyebilir Liquid Glass Mini & Tam Ekran Müzik Oynatıcı (`ExpandableAudioPlayer.tsx`, `MoodSyncVisionModule.swift`)
- **Tek Kapsül Morph Animasyonu:** Alt mini çubuktan yukarıya doğrudan büyüyen ve küçülen kesintisiz oynatıcı geçişi eklendi; tek dokunuşla açılma ve parmak hızı/ivmesine duyarlı 120Hz kapatma desteği sağlandı.
- **Kesintisiz Etkileşim & Optimizasyon:** Animasyon tamamlanmadan parmakla yakalayıp geri küçültme/büyütme etkileşimi düzeltildi; animasyon sırasındaki gereksiz arka plan yuvarlak efekti ve takılmalar kaldırıldı.
- **Tam Ekran Kontroller & Kilit Ekranı:** Sarma çubuğu (scrubbing), tek parça tekrar modu, çalma sırası yönetimi ve `MPRemoteCommandCenter` üzerinden iOS Kilit Ekranı / Denetim Merkezi ileri-geri parça kontrolleri eklendi.

### Hesaba Bağlı Face ID & Güvenlik (`MoodSyncVisionModule.swift`, `LoginScreen.tsx`, `SettingsScreen.tsx`)
- **Keychain Tabanlı Biyometrik Giriş:** `LocalAuthentication` + iOS Keychain (`.biometryCurrentSet`) ile seçili hesaba özel şifresiz Face ID girişi eklendi; cihaza yeni yüz eklendiğinde güvenlik gereği eşleştirme otomatik sıfırlanır.
- **Hesap Güvenliği Yönetimi:** Ayarlar ekranından Face ID eşleştirme, kaldırma ve admin hesaba devralma kontrolleri (`NSFaceIDUsageDescription`) eklendi.

### Özel Çalma Listeleri, Mod Stratejisi & Tarama Günlüğü (`LibraryScreen.tsx`, `EmotionBreakdownCard.tsx`, `ScanJournalCard.tsx`, `TrackActionSheetModal.tsx`)
- **Özel Çalma Listeleri:** `Şarkılar` / `Listelerim` geçişi, liste oluşturma, yeniden adlandırma, silme, 4'lü mozaik kapak görünümü ve liste paylaşımı (`PlaylistPickerModal.tsx`) eklendi.
- **Mod Stratejisi & Çoklu Duygu Analizi:** *Moduma Eşlik Et* / *Modumu Yükselt* seçimi, duygu olasılık çubuğu ve manuel duygu düzeltme desteği hem canlı taramaya hem geçmiş detayına eklendi.
- **Tarama Günlüğü & Parça Aksiyonları:** Taramalara not ve hızlı bağlam etiketleri ekleme (`ScanJournalCard`), parçaları Apple Music / Spotify / YouTube Music’te açma, *"Bir Daha Önerme"* ile gizleme/geri alma ve kişiselleştirilmiş öneri sıralaması getirildi.

### Müzik Veritabanı & Dil Sınıflandırma İyileştirmeleri (`onlineMusicService.ts`, `iosDatabase.ts`, `LibraryScreen.tsx`)
- **Katı Türkçe / Yabancı Ayrımı:** Türkçe listede ADÉLA gibi yabancı sanatçıların görünmesine yol açan sınıflandırma hatası `classifyTrackLanguage` ile giderildi; açılışta `repairTrackLanguagesInDatabase` ile mevcut SQLite veritabanı otomatik onarılıyor.
- **30'lu Sayfalandırma & Arka Plan Zenginleştirme:** Kütüphanede sayfa başına 30 şarkı gösterimi, sayfalar arası geçiş ve `ensureRichCatalogSeeded` ile katalog doldurma eklendi.

### Animasyon, Dokunma & Performans Düzeltmeleri (`MotionPrimitives.tsx`, `TrackRow.tsx`, `App.tsx`, `HistoryScreen.tsx`)
- **Sekme Geçişi Çift Animasyon & Race Düzeltmesi:** Çakışan dış sekme animasyonu kaldırıldı, `HistoryScreen` senkron `ScrollView`’a taşındı ve `StaggeredEntry` tek `progress` `Animated.Value` + `delay: 0` gömülü eğri + `queueMicrotask` sıfırlama korumasıyla güncellenerek hızlı sekme geçişlerindeki çift tetiklenme tamamen giderildi.
- **Tam Kart Dokunma Alanı:** `TrackRow` kartı köşeler ve kenar boşlukları dahil tek `Pressable` haline getirildi; aksiyon butonlarına `e.stopPropagation()` ve `FlatList`’e `keyboardShouldPersistTaps="handled"` eklendi.
- **Kararlılık Düzeltmeleri:** `AnimatedSplashScreen`, `AnimatedSegmentedControl`, `AnimatedProgressBar` ve `CameraStudioScreen` üzerindeki yeniden tetiklenme ve gereksiz render sorunları giderildi.

---

## v2.1.0 — 21 Kasım 2026

### Hız & Doğruluk İyileştirmeleri (`MoodSyncVisionModule.swift`)
- **CoreML / Apple Neural Engine (ANE) Hızlandırması:** `ORTCoreMLExecutionProviderOptions` (`MLProgram`, statik giriş şekilleri, subgraph desteği), `.all` graph optimizasyonu ve uygulama açılışında arka plan `warmup()` ön-derlemesi eklendi.
- **Zero-Copy Yönlendirme & Hızlı Tensör Hazırlama:** Tam çözünürlükte yeniden çizim kaldırılarak `CGImagePropertyOrientation` ve `CIImage.oriented(...)` ile doğrudan kırpmaya geçildi; `makeNormalizedCHWData` doğrusal işaretçi döngüsüyle hızlandırıldı.
- **Gelişmiş Yüz & Duygu Doğruluk Hattı:** `VNFaceObservation.roll` açısına göre baş hizalama, oran koruyan kare yüz kırpması, `CIAreaAverage` tabanlı düşük/yüksek ışık adaptif pozlama dengelemesi ve son çekimde yatay ayna (horizontal-flip) TTA logit ortalaması eklendi.

### Saf iOS Depo Temizliği
- Kullanılmayan legacy YOLO, C# masaüstü ve Python web/LAN backend dosyaları kaldırıldı (`Controllers/`, `Models/`, `Views/`, `src/`, `webapp/`, `yoloModels/`, `yolo_detect.py`, `run.py`, `start_ios.*`).
- `mobile/metro.config.js` ve `mobile/src/services/moodAiService.ts` üzerindeki eski `/api/` proxy ve uzak sunucu fallback kodları temizlendi.

---

## v2.0.0 — 19 Kasım 2026

### Yeni Özellikler
- **iOS 26/27 Native Liquid Glass Arayüz (`MoodSyncVisionModule.swift`):**
  - 120Hz `CADisplayLink` fizik motorlu, tek katmanlı `UIGlassEffect` alt sekme çubuğu (`MoodSyncLiquidTabBarView`).
  - Kısmi renk maskeleme (`CAShapeLayer`), prizmatik kenar parıltısı, dengeli dokunma/sürükleme fiziği ve ortalanmış kompakt kapsül tasarımı.
  - Gerçek `UIGlassEffect` + analitik `shadowPath` destekli kapsül `MiniAudioPlayer`.
- **Geçmiş Taramaya Özel Detay Ekranı (`ScanDetailScreen`):**
  - Geçmiş sekmesindeki fotoğraf veya karta tıklandığında kameraya dönmek yerine taramaya özel detay ekranı açılır; fotoğraf tam ekran büyütülebilir.
- **Kalıcı Şarkı Genişletme (`expandScanSessionTracks`):**
  - Hem aktif taramada hem geçmiş tarama detayında `+5`, `+10`, `+15` (ve hızlı `+8`) yeni şarkı eklenip SQLite `scan_session_tracks` tablosuna kalıcı kaydedilir.
- **Gizlilik Odaklı İsteğe Bağlı Kamera & Anında Çekim:**
  - Ana sayfada kamera varsayılan olarak kapalı başlar; çekim sonrası, sekme değişiminde, arka planda ve 45 sn hareketsizlikte otomatik kapanır.
  - Canlı yüz kilidini beklemeden anında fotoğraf çekimi ve arka planda duygu analizi + şarkı listesi oluşturma.
- **Ayarlar Sekmesi & Admin Paneli (`SettingsScreen`, `AdminPanelScreen`):**
  - `haluk` hesabı için otomatik `admin` rolü, kullanıcı yönetimi, tüm taramaları inceleme, canlı SQLite tablo gezgini ve salt-okunur SQL konsolu.
- **Dark & Tinted iOS Ana Ekran İkonları:**
  - Karanlık mod uygulama içi logosu (`logo-dark.png`) ve iOS karanlık/renkli ana ekran ikonları (`icon-dark.png`, `icon-tinted.png`).

### Hata Düzeltmeleri & İyileştirmeler
- Şarkılar sekmesindeki filtre geçişlerinde oluşan çift animasyon ve kardeş satır flash sorunları giderildi.
- Admin panelinde ilk açılış çift sorgusu ve tablo geçiş yarış durumları düzeltildi.
- Önizleme URL'si olmayan şarkılarda `MiniAudioPlayer` senkronizasyon hatası giderildi.
- Ana sayfa karşılama başlığı tek satıra sığacak şekilde düzenlendi.

---

## 5 Eylül 2026

- Yenilenen .NET 8 uygulaması `src/MoodSync` klasörüne eklendi.
- Türkçe arayüz, fotoğraf önizlemesi, müzik koleksiyonu ve misafir modu eklendi.
- C#–Python iletişimi JSON'a taşındı; bekleme ve hata yönetimi düzeltildi.
- Veritabanı bağlantıları ve parola saklama düzenlendi.
- Kurulum notları, testler ve arayüz görseli eklendi.
- Eski kaynaklar ve model korundu.
