#!/usr/bin/env python3
"""
MoodSync Native iOS (Expo Go) + Python YOLOv8 + AffectNet 7-Emotion Unified Launcher.

Starts:
  1. Python YOLOv8 + AffectNet 7-Emotion AI Backend on 0.0.0.0:8000 (/api/detect/mobile)
  2. Expo Metro Bundler in ./mobile (with built-in /api/* proxy on :8081 so Windows Firewall never blocks!)
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MOBILE_DIR = ROOT / "mobile"
REQUIREMENTS_FILE = ROOT / "webapp" / "requirements.txt"
ENDPOINTS_FILE = MOBILE_DIR / "src" / "config" / "serverEndpoints.json"

REQUIRED_PY_MODULES = ("uvicorn", "fastapi", "PIL", "requests", "multipart", "ultralytics", "onnxruntime", "numpy")


def _ensure_windows_node_path() -> None:
    if os.name != "nt":
        return
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "nodejs",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "nodejs",
        Path(os.environ.get("APPDATA", "")) / "npm",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs",
    ]
    current_path = os.environ.get("PATH", "")
    extra = [str(p) for p in candidates if p.is_dir() and str(p) not in current_path]
    if extra:
        os.environ["PATH"] = os.pathsep.join([*extra, current_path])


def _discover_lan_ips() -> list[str]:
    ips: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            primary = s.getsockname()[0]
            if primary and not primary.startswith("127."):
                ips.append(primary)
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addr = info[4][0]
            if addr and not addr.startswith("127.") and not addr.startswith("169.254.") and addr not in ips:
                ips.append(addr)
    except Exception:
        pass
    return ips


def _write_lan_endpoints() -> list[str]:
    ips = _discover_lan_ips()
    urls = [f"http://{ip}:8000" for ip in ips]
    ENDPOINTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ENDPOINTS_FILE.write_text(json.dumps({"urls": urls}, indent=2), encoding="utf-8")
    return urls


def _ensure_windows_firewall_rule() -> None:
    if os.name != "nt":
        return
    try:
        subprocess.run(
            [
                "netsh",
                "advfirewall",
                "firewall",
                "add",
                "rule",
                "name=MoodSync AI Server (8000)",
                "dir=in",
                "action=allow",
                "protocol=TCP",
                "localport=8000",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass


def ensure_python_dependencies() -> bool:
    missing = [mod for mod in REQUIRED_PY_MODULES if importlib.util.find_spec(mod) is None]
    if not missing:
        return True

    print(f"[1/2] Eksik Python paketleri tespit edildi ({', '.join(missing)}).")
    print("      Otomatik kurulum başlatılıyor...\n")
    subprocess.call([sys.executable, "-m", "pip", "install", "--upgrade", "pip"])
    rc = subprocess.call([sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)])
    if rc != 0:
        print("\nHATA: Python paketleri kurulurken bir sorun oluştu.")
        print(f'Lütfen terminalde şu komutu çalıştırın: "{sys.executable}" -m pip install -r webapp/requirements.txt')
        return False
    return True


def ensure_mobile_dependencies() -> tuple[bool, str]:
    _ensure_windows_node_path()
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    npx_cmd = "npx.cmd" if os.name == "nt" else "npx"

    if shutil.which(npm_cmd) is None or shutil.which(npx_cmd) is None:
        print("\nHATA: Bilgisayarınızda Node.js kurulu değil (npm / npx bulunamadı)!")
        print("Lütfen https://nodejs.org adresinden 'LTS' sürümünü indirip kurun,")
        print("ardından bu pencereyi kapatıp start_ios.bat dosyasını tekrar çalıştırın.")
        return False, npx_cmd

    node_modules = MOBILE_DIR / "node_modules"
    expo_pkg = node_modules / "expo"
    if not expo_pkg.is_dir():
        print("\n[2/2] iOS Expo paketleri (mobile/node_modules) ilk kez kuruluyor...")
        rc = subprocess.call([npm_cmd, "install"], cwd=str(MOBILE_DIR))
        if rc != 0:
            print("      Standart npm install başarısız oldu, --legacy-peer-deps ile tekrar deneniyor...")
            rc = subprocess.call([npm_cmd, "install", "--legacy-peer-deps"], cwd=str(MOBILE_DIR))
            if rc != 0:
                print("\nHATA: mobile klasöründe 'npm install' tamamlanamadı.")
                return False, npx_cmd

    return True, npx_cmd


def start_yolo_backend() -> None:
    os.chdir(str(ROOT))
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    import uvicorn

    uvicorn.run("webapp.app:app", host="0.0.0.0", port=8000, log_level="warning")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    os.chdir(str(ROOT))
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    print("\n" + "═" * 68)
    print("  MoodSync iOS (Expo Go) + YOLOv8 & AffectNet 7-Duygu AI Başlatıcı")
    print("═" * 68 + "\n")

    if not ensure_python_dependencies():
        return 1

    ok_node, npx_cmd = ensure_mobile_dependencies()
    if not ok_node:
        return 1

    _ensure_windows_firewall_rule()
    lan_urls = _write_lan_endpoints()

    print("\n" + "─" * 68)
    print("  HAZIR! Sunucu ve Veritabanı (webapp/data/moodsync.db) Aktif!")
    if lan_urls:
        print(f"  Yerel Sunucu Adresi : {lan_urls[0]} (+ Metro :8081 Köprüsü Aktif)")
    print("  • Tüm hesaplar, şarkılar ve çekilen fotoğraflar bu klasördeki")
    print("    webapp/data/moodsync.db içinde tutulur; telefonda yer kaplamaz!")
    print("  • iPhone 16 Pro'da Expo Go ile QR kodu okutun (veya açıksa yenileyin).")
    print("─" * 68 + "\n")

    backend_thread = threading.Thread(target=start_yolo_backend, daemon=True)
    backend_thread.start()

    extra_args = sys.argv[1:]
    cmd = [npx_cmd, "expo", "start", *extra_args]
    return subprocess.call(cmd, cwd=str(MOBILE_DIR))


if __name__ == "__main__":
    raise SystemExit(main())
