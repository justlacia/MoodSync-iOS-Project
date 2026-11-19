# Değişiklikler (Changelog)

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
