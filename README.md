# MoodSync iOS 🎵🎭
> **On-Device Facial Emotion Recognition & AI Music Recommendation App for iOS**
> *(Apple Vision & AffectNet ONNX Deep Learning • Native iOS React Native / Expo SDK 58 • SQLite • iTunes & Deezer API)*

<p align="center">
  <img src="docs/moodsync-ios-oled.png" alt="MoodSync iOS — OLED Simsiyah Tema" width="46%" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/moodsync-ios-light.png" alt="MoodSync iOS — Klasik Fildişi Tema" width="46%" />
</p>
<p align="center">
  <em>Sol: <b>OLED Simsiyah (#000000)</b> Tema • Sağ: <b>Klasik Fildişi</b> Tema (iPhone 16 Pro)</em>
</p>

---

## 🌟 Proje Hakkında / Overview

**MoodSync**, kullanıcının anlık yüz ifadesini derin öğrenme ve bilgisayarlı görü modelleri (**YOLOv8** & **AffectNet EfficientNet-B2**) ile gerçek zamanlı analiz edip, tespit edilen duygu durumuna en uygun müzikleri (**Apple iTunes** ve **Deezer** API entegrasyonuyla) öneren çok platformlu bir yapay zeka uygulamasıdır.

- **iPhone 16 Pro (ProMotion 120Hz) Native iOS Uygulaması:** OLED Simsiyah dahil 4 özel tema, akıcı 120Hz animasyonlar ve 30 saniyelik uygulama içi ses önizleme çaları.
- **Derin Öğrenme Motoru (YOLOv8 + AffectNet 7-Duygu):** Yüz tespiti ve 5 temel duygu sınıfı (`Mutlu`, `Heyecanlı`, `Dingin`, `Üzgün`, `Kızgın`) yüksek doğrulukla analiz edilir.
- **Esnek Çalışma Mimarisi:** Hem yerel ağ üzerinden Python AI sunucusuyla (`main`), hem de bilgisayardan %100 bağımsız olarak doğrudan iPhone işlemcisinde On-Device ONNX Runtime & SQLite ile (`standalone-ios`) çalışabilir.

---

## 🚀 Öne Çıkan Özellikler / Key Features

- 🎭 **5 Duygu Durumu Canlı Analizi:**
  - 🟠 **Mutlu (Happy):** Yüksek enerjili, pozitif Pop ve Dans parçaları.
  - 🟣 **Heyecanlı (Excited):** Yüksek tempolu parti, elektronik ve ritmik müzikler.
  - 🟢 **Dingin (Calm):** Akustik, Ambient, Lo-Fi ve odaklanmaya yardımcı melodiler.
  - 🔵 **Üzgün (Sad):** Melankolik, slow, indie ve derin duygusal parçalar.
  - 🔴 **Kızgın (Angry):** Rock, Metal, Rap ve yüksek tempo deşarj şarkıları.
- 📱 **Native iOS Deneyimi (React Native & Expo SDK 58):**
  - `expo-camera` (`CameraView`) ile canlı yüz takip kadrajı, ayna görüntüsü (mirror) koruması ve sağ üst canlı duygu rozeti.
  - `expo-audio` ile sessiz modda bile çalışan 30 saniyelik yüksek kaliteli şarkı önizleme çaları.
  - **OLED Simsiyah (`#000000`)**, **Obsidyen Karbon**, **Gece İndigo** ve **Klasik Fildişi** temaları.
  - 120Hz ProMotion uyumlu kademeli (staggered cascade) şarkı listesi geçiş animasyonları.
- ⚡ **YOLOv8 & AffectNet Derin Öğrenme Motoru:**
  - Yüz локаlizasyonu ve AffectNet EfficientNet-B2 (`affectnet_b2_7.onnx`) 7-sınıf duygu sınıflandırması ~50-80 ms gecikmeyle işlenir.
- 🗄️ **SQLite Veritabanı & Canlı Müzik Kataloğu:**
  - Kullanıcı hesapları (`SHA-256` parola özeti), favori şarkılar, geçmiş tarama oturumları ve Apple iTunes / Deezer API senkronizasyonu.

---

## 🏗️ Proje Mimarisi / Architecture

```text
MoodSync-iOS-Project/
├── mobile/                     # React Native / Expo Native iOS Uygulaması
│   ├── src/
│   │   ├── screens/            # CameraStudioScreen, HistoryScreen, LibraryScreen, LoginScreen
│   │   ├── components/         # AnimatedSplashScreen, MiniAudioPlayer, TrackRow
│   │   ├── services/           # moodAiService, onlineMusicService
│   │   ├── database/           # iosDatabase (SQLite & Session Yönetimi)
│   │   └── theme/              # OLED & Koyu Tema Sistemi (ThemeContext, colors)
│   ├── app.json
│   └── metro.config.js         # Port :8081 -> :8000 AI Reverse Proxy
├── webapp/                     # Python FastAPI AI & Veritabanı Sunucusu
│   ├── app.py                  # REST API Sunucusu
│   ├── detector_service.py     # YOLOv8 & AffectNet Yüz/Duygu Modeli
│   ├── database.py             # SQLite Veritabanı Katmanı
│   ├── music_service.py        # iTunes & Deezer Müzik Öneri Motoru
│   └── requirements.txt
├── src/MoodSync/               # C# .NET 8 Masaüstü Uygulaması
├── yoloModels/                 # Eğitilmiş YOLOv8 Model Ağırlıkları
├── start_ios.py                # Tek Komutla Birleşik Başlatıcı (macOS / Windows / Linux)
└── start_ios.bat               # Tek Tıkla Hızlı Başlatıcı (Windows)
```

---

## 🛠️ Kurulum ve Çalıştırma / Getting Started

### Gereksinimler
- **Python 3.10+**
- **Node.js 18+** & npm
- **iPhone** (Expo Go veya Xcode ile doğrudan cihaz kurulumu)

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/justlacia/MoodSync-iOS-Project.git
cd MoodSync-iOS-Project
```

### 2. Bağımlılıkları Kurun
```bash
python -m venv .venv
# Windows:
.venv\Scripts\pip install -r webapp/requirements.txt
# macOS / Linux:
.venv/bin/pip install -r webapp/requirements.txt

cd mobile
npm install
cd ..
```

### 3. Başlatın
- **macOS / Linux:** `python start_ios.py`
- **Windows:** `start_ios.bat` dosyasına çift tıklayın.
- **Bağımsız (On-Device) Xcode Kurulumu:** `git checkout standalone-ios && ./mobile/scripts/install_iphone.sh`

---

## 📄 Lisans / License

Bu proje [MIT Lisansı](mobile/LICENSE) altında lisanslanmıştır.
