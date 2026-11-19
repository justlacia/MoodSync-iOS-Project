#!/usr/bin/env python3
"""
MoodSync Launcher (Desktop + iPhone 16 Pro Mobile Camera Ready).

Usage:
  python run.py                # Starts HTTP on :8000 (and HTTPS on :8443 for local Wi-Fi iPhone camera access)
  python run.py --port 8000    # Custom HTTP port
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import ipaddress
import socket
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _ensure_deps() -> None:
    if importlib.util.find_spec("uvicorn") is None or importlib.util.find_spec("fastapi") is None:
        print("Eksik Python paketleri kuruluyor, lütfen bekleyin...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "webapp" / "requirements.txt")])


def detect_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def ensure_self_signed_cert(cert_dir: Path, lan_ip: str) -> tuple[Path, Path] | None:
    """Generates a local TLS certificate so iOS Safari on iPhone 16 Pro enables getUserMedia over Wi-Fi."""
    cert_file = cert_dir / "local-cert.pem"
    key_file = cert_dir / "local-key.pem"
    if cert_file.is_file() and key_file.is_file():
        return cert_file, key_file
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID

        cert_dir.mkdir(parents=True, exist_ok=True)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = issuer = x509.Name(
            [
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MoodSync Local Studio"),
                x509.NameAttribute(NameOID.COMMON_NAME, lan_ip),
            ]
        )
        san_entries: list[x509.GeneralName] = [
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        ]
        try:
            san_entries.append(x509.IPAddress(ipaddress.ip_address(lan_ip)))
        except ValueError:
            pass

        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
            .sign(key, hashes.SHA256())
        )
        key_file.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        return cert_file, key_file
    except Exception:
        return None


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    _ensure_deps()
    import uvicorn

    parser = argparse.ArgumentParser(description="MoodSync Web & Mobile Server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--https-port", type=int, default=8443)
    parser.add_argument("--no-https", action="store_true")
    args = parser.parse_args()

    lan_ip = detect_lan_ip()
    print("\n" + "═" * 64)
    print("  MoodSync · Duygu Analizi & Çevrimiçi Müzik Platformu")
    print(f"  Bilgisayar Tarayıcısı : http://localhost:{args.port}")

    if not args.no_https:
        certs = ensure_self_signed_cert(Path(__file__).resolve().parent / "webapp" / "data" / "certs", lan_ip)
        if certs:
            cert_file, key_file = certs
            print(f"  iPhone 16 Pro (Wi-Fi) : https://{lan_ip}:{args.https_port}")
            print("  (iOS Safari'de kamera izni için HTTPS adresini açın)")
            https_cfg = uvicorn.Config(
                "webapp.app:app",
                host=args.host,
                port=args.https_port,
                ssl_certfile=str(cert_file),
                ssl_keyfile=str(key_file),
                log_level="warning",
            )
            https_server = uvicorn.Server(https_cfg)
            threading.Thread(target=https_server.run, daemon=True).start()
    print("═" * 64 + "\n")

    uvicorn.run("webapp.app:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
