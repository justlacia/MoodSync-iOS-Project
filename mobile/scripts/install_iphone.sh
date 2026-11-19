#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${MOBILE_DIR}"

echo "================================================================"
echo "  MoodSync Standalone iOS — MacBook -> iPhone 16 Pro Kurulumu"
echo "================================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "HATA: Node.js kurulu değil. Lütfen https://nodejs.org veya 'brew install node' ile kurun."
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "HATA: Xcode kurulu değil. App Store'dan Xcode'u indirip bir kez açın."
  exit 1
fi

echo "[1/3] Bağımlılıklar yükleniyor (npm install)..."
npm install

echo "[2/3] Native iOS Xcode projesi oluşturuluyor (expo prebuild --platform ios)..."
npx expo prebuild --platform ios

echo "[3/3] Xcode çalışma alanı açılıyor..."
echo ""
echo "SON ADIM (Xcode içinde):"
echo "  1. iPhone 16 Pro'nuzu USB-C kablo ile MacBook'a bağlayın (Geliştirici Modu açık olsun)."
echo "  2. Sol panelden 'MoodSync' projesine -> 'Signing & Capabilities' sekmesine tıklayın."
echo "  3. 'Automatically manage signing' işaretli olsun ve 'Team' kısmından kendi Apple ID'nizi seçin."
echo "     (Bundle Identifier çakışırsa com.justlacia.moodsync.personal gibi benzersiz bir ad verin.)"
echo "  4. Üst menüden Product -> Scheme -> Edit Scheme -> Run -> Build Configuration: 'Release' seçin!"
echo "     (Release seçimi sayesinde uygulama kabloyu çektiğinizde bilgisayarsız %100 bağımsız çalışır.)"
echo "  5. Üstten cihaz olarak iPhone 16 Pro'nuzu seçip ▶ (Run) butonuna basın."
echo ""

if [ -d "${MOBILE_DIR}/ios/MoodSync.xcworkspace" ]; then
  open "${MOBILE_DIR}/ios/MoodSync.xcworkspace"
else
  echo "Xcode projesi hazır. Doğrudan terminalden kurmak için:"
  echo "  npx expo run:ios --device --configuration Release"
fi
