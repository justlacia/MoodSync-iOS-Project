"""Real-time YOLOv8 Face Detection + AffectNet 7-Emotion Deep Learning Recognizer for iPhone 16 Pro & Web."""
from __future__ import annotations

import base64
import io
import os
import tempfile
import threading
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

from .database import MOOD_LABELS_TR

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_CANDIDATES = [
    REPO_ROOT / "src" / "MoodSync" / "python" / "models" / "model.pt",
    REPO_ROOT / "yoloModels" / "yolov8_best.pt",
]
AFFECTNET_ONNX_PATH = REPO_ROOT / "src" / "MoodSync" / "python" / "models" / "affectnet_b2_7.onnx"
AFFECTNET_ONNX_URL = (
    "https://github.com/sb-ai-lab/EmotiEffLib/raw/main/models/affectnet_emotions/onnx/enet_b2_7.onnx"
)

ALIASES = {
    "positive": "positive",
    "happy": "positive",
    "smile": "positive",
    "neutral": "neutral",
    "negative": "negative",
    "sad": "negative",
    "cry": "negative",
}

# 7 AffectNet classes for enet_b2_7.onnx
AFFECTNET_7_CLASSES = {
    0: "Anger",
    1: "Disgust",
    2: "Fear",
    3: "Happiness",
    4: "Neutral",
    5: "Sadness",
    6: "Surprise",
}

EMOTION_LABELS_TR = {
    "happy": "Mutlu",
    "surprise": "Heyecanlı",
    "neutral": "Dingin",
    "sad": "Üzgün",
    "angry": "Kızgın",
}

EMOTION_TO_MOOD = {
    "happy": "positive",
    "surprise": "positive",
    "neutral": "neutral",
    "sad": "negative",
    "angry": "negative",
}

_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype="float32")
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype="float32")


def _iou(box_a: list[float], box_b: list[float]) -> float:
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    if inter <= 0:
        return 0.0
    area_a = max(1.0, (box_a[2] - box_a[0]) * (box_a[3] - box_a[1]))
    area_b = max(1.0, (box_b[2] - box_b[0]) * (box_b[3] - box_b[1]))
    return inter / (area_a + area_b - inter)


class EmotionDetectorService:
    """Combines YOLOv8 face localization with AffectNet EfficientNet-B2 7-Emotion ONNX inference."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ort_lock = threading.Lock()
        self._model: Any = None
        self._ort_session: Any = None
        self.model_path = next((p for p in MODEL_CANDIDATES if p.is_file()), MODEL_CANDIDATES[0])
        self.onnx_path = AFFECTNET_ONNX_PATH

    def warmup(self) -> None:
        self._ensure_model()
        self._ensure_affectnet_session()

    def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:
                return self._model
            if not self.model_path.is_file():
                raise RuntimeError(f"YOLOv8 model dosyası bulunamadı: {self.model_path}")
            cache_dir = Path(tempfile.gettempdir()) / "MoodSyncYoloCache"
            cache_dir.mkdir(parents=True, exist_ok=True)
            os.environ.setdefault("YOLO_CONFIG_DIR", str(cache_dir))
            os.environ.setdefault("MPLCONFIGDIR", str(cache_dir / "mpl"))
            from ultralytics import YOLO

            self._model = YOLO(str(self.model_path))
            dummy = Image.new("RGB", (320, 320), (128, 128, 128))
            self._model.predict(source=dummy, conf=0.25, imgsz=320, verbose=False)
            return self._model

    def _ensure_affectnet_session(self) -> Any:
        if self._ort_session is not None:
            return self._ort_session
        with self._ort_lock:
            if self._ort_session is not None:
                return self._ort_session
            try:
                if not self.onnx_path.is_file() or self.onnx_path.stat().st_size < 5_000_000:
                    self.onnx_path.parent.mkdir(parents=True, exist_ok=True)
                    tmp_path = self.onnx_path.with_suffix(".onnx.tmp")
                    urllib.request.urlretrieve(AFFECTNET_ONNX_URL, str(tmp_path))
                    tmp_path.replace(self.onnx_path)

                import onnxruntime as ort

                ort.set_default_logger_severity(3)
                sess = ort.InferenceSession(
                    str(self.onnx_path),
                    providers=["CPUExecutionProvider"],
                )
                dummy_input = np.zeros((1, 3, 260, 260), dtype="float32")
                sess.run(None, {"input": dummy_input})
                self._ort_session = sess
            except Exception:
                self._ort_session = None
            return self._ort_session

    def _classify_affectnet_face(
        self, full_img: Image.Image, box: list[float]
    ) -> tuple[str, float, dict[str, float]] | None:
        sess = self._ensure_affectnet_session()
        if sess is None:
            return None

        w, h = full_img.size
        x1, y1, x2, y2 = box
        bw = max(16.0, x2 - x1)
        bh = max(16.0, y2 - y1)

        # Trim outer hair/forehead margin slightly so AffectNet focuses on eyebrows, eyes & mouth muscles
        cx1 = int(max(0.0, x1 + bw * 0.05))
        cy1 = int(max(0.0, y1 + bh * 0.11))
        cx2 = int(min(float(w), x2 - bw * 0.05))
        cy2 = int(min(float(h), y2 - bh * 0.02))
        if cx2 - cx1 < 24 or cy2 - cy1 < 24:
            cx1, cy1, cx2, cy2 = int(max(0, x1)), int(max(0, y1)), int(min(w, x2)), int(min(h, y2))

        crop = full_img.crop((cx1, cy1, cx2, cy2)).resize((260, 260), Image.Resampling.BILINEAR)
        arr = np.asarray(crop, dtype="float32") / 255.0
        arr = (arr - _IMAGENET_MEAN) / _IMAGENET_STD
        tensor = arr.transpose(2, 0, 1)[np.newaxis, ...]

        with self._ort_lock:
            logits = sess.run(None, {"input": tensor})[0][0]

        shifted = logits - float(np.max(logits))
        exp_scores = np.exp(shifted)
        probs = exp_scores / float(np.sum(exp_scores))
        p_map = {AFFECTNET_7_CLASSES[i]: float(probs[i]) for i in range(len(AFFECTNET_7_CLASSES))}

        # Furrowed brows / glare / scowl activate Anger (+ Disgust); sad lip pouts activate Sadness without Anger
        disgust_weight = 0.65 if p_map["Anger"] >= 0.14 else 0.20
        angry_score = p_map["Anger"] + p_map["Disgust"] * disgust_weight
        sad_score = p_map["Sadness"] + p_map["Fear"] * 0.65
        happy_score = p_map["Happiness"]
        surprise_score = p_map["Surprise"]
        neutral_score = p_map["Neutral"]

        total = max(1e-6, angry_score + sad_score + happy_score + surprise_score + neutral_score)
        emo_scores = {
            "happy": happy_score / total,
            "surprise": surprise_score / total,
            "neutral": neutral_score / total,
            "sad": sad_score / total,
            "angry": angry_score / total,
        }

        best_emotion, best_prob = max(emo_scores.items(), key=lambda kv: kv[1])

        # Calibration for real-time smartphone selfies: if Neutral narrowly leads while the user is
        # visibly furrowing brows (angry >= 0.30) or frowning (sad >= 0.30), surface the active emotion!
        if best_emotion == "neutral":
            expressive_candidates = [
                ("angry", emo_scores["angry"]),
                ("sad", emo_scores["sad"]),
                ("happy", emo_scores["happy"]),
                ("surprise", emo_scores["surprise"]),
            ]
            top_exp, top_exp_val = max(expressive_candidates, key=lambda kv: kv[1])
            if top_exp_val >= 0.30 and top_exp_val >= emo_scores["neutral"] * 0.68:
                best_emotion = top_exp
                # Display calibrated confidence reflecting active expression strength
                best_prob = min(0.96, top_exp_val / max(1e-6, top_exp_val + emo_scores["neutral"] * 0.45))

        return best_emotion, float(best_prob), emo_scores

    def detect_image_bytes(
        self,
        raw_bytes: bytes,
        live_mode: bool = False,
        create_thumbnail: bool = False,
    ) -> dict[str, Any]:
        if len(raw_bytes) > 20 * 1024 * 1024:
            raise ValueError("Görsel boyutu 20 MB sınırını aşıyor.")
        try:
            pil_img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw_bytes))).convert("RGB")
        except Exception as exc:
            raise ValueError("Geçerli bir fotoğraf okunamadı.") from exc

        width, height = pil_img.size
        if width < 32 or height < 32:
            raise ValueError("Görsel çözünürlüğü çok düşük.")

        imgsz = 416 if live_mode else 640
        min_conf = 0.16 if live_mode else 0.18

        detections = self._run_yolo(pil_img, imgsz=imgsz, conf=min_conf)
        used_padding = False
        pad_px = 0

        # Fallback 1: Close-up iPhone 16 Pro selfies where face fills >85% of the frame
        if not detections:
            pad_px = int(max(width, height) * 0.24)
            padded = ImageOps.expand(pil_img, border=pad_px, fill=(118, 118, 118))
            detections = self._run_yolo(padded, imgsz=imgsz, conf=0.14)
            used_padding = True

        # Fallback 2: Sideways raw sensor buffer without EXIF tag (90° CW / CCW check)
        if not detections:
            for angle in (270, 90):
                rotated = pil_img.rotate(angle, expand=True)
                rot_det = self._run_yolo(rotated, imgsz=imgsz, conf=0.18)
                if rot_det:
                    pil_img = rotated
                    width, height = pil_img.size
                    detections = rot_det
                    used_padding = False
                    pad_px = 0
                    break

        thumbnail_data_url = self._make_thumbnail_data_url(pil_img) if create_thumbnail else None

        if not detections:
            return {
                "detected": False,
                "mood": None,
                "moodLabel": "Yüz Aranıyor…",
                "emotion": None,
                "emotionLabel": "Yüz Aranıyor…",
                "confidence": 0.0,
                "scores": {"positive": 0.0, "neutral": 0.0, "negative": 0.0},
                "emotionScores": {"happy": 0.0, "surprise": 0.0, "neutral": 0.0, "sad": 0.0, "angry": 0.0},
                "faceBox": None,
                "faceCount": 0,
                "snapshotDataUrl": thumbnail_data_url,
            }

        if used_padding and pad_px > 0:
            remapped = []
            for label, score, box in detections:
                bx = [
                    max(0.0, min(float(width), box[0] - pad_px)),
                    max(0.0, min(float(height), box[1] - pad_px)),
                    max(0.0, min(float(width), box[2] - pad_px)),
                    max(0.0, min(float(height), box[3] - pad_px)),
                ]
                remapped.append((label, score, bx))
            detections = remapped

        clusters: list[dict[str, Any]] = []
        for label, score, box in sorted(detections, key=lambda d: d[1], reverse=True):
            placed = False
            for cluster in clusters:
                if _iou(box, cluster["box"]) >= 0.40:
                    cluster["preds"].append((label, score))
                    placed = True
                    break
            if not placed:
                clusters.append({"box": box, "preds": [(label, score)]})

        cx_frame, cy_frame = width / 2.0, height / 2.0
        diag = max(1.0, (width**2 + height**2) ** 0.5)

        def face_priority(cluster: dict[str, Any]) -> float:
            b = cluster["box"]
            area_ratio = ((b[2] - b[0]) * (b[3] - b[1])) / max(1.0, float(width * height))
            fcx, fcy = (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0
            center_dist = (((fcx - cx_frame) ** 2 + (fcy - cy_frame) ** 2) ** 0.5) / diag
            best_conf = cluster["preds"][0][1]
            return area_ratio * 1.8 + best_conf * 0.8 - center_dist * 0.35

        primary = max(clusters, key=face_priority)
        b = primary["box"]

        # Primary emotion classification via AffectNet 7-emotion model on detected face crop
        affectnet_res = self._classify_affectnet_face(pil_img, b)
        if affectnet_res is not None:
            best_emotion, best_conf, emo_scores = affectnet_res
            best_mood = EMOTION_TO_MOOD[best_emotion]
            raw_scores = {
                "positive": round(emo_scores["happy"] + emo_scores["surprise"], 4),
                "neutral": round(emo_scores["neutral"], 4),
                "negative": round(emo_scores["sad"] + emo_scores["angry"], 4),
            }
        else:
            raw_scores = {"positive": 0.0, "neutral": 0.0, "negative": 0.0}
            for lbl, sc in primary["preds"]:
                raw_scores[lbl] = max(raw_scores[lbl], float(sc))
            best_mood, best_conf = max(raw_scores.items(), key=lambda kv: kv[1])
            fallback_emo_map = {"positive": "happy", "neutral": "neutral", "negative": "sad"}
            best_emotion = fallback_emo_map[best_mood]
            emo_scores = {
                "happy": raw_scores["positive"],
                "surprise": 0.0,
                "neutral": raw_scores["neutral"],
                "sad": raw_scores["negative"],
                "angry": 0.0,
            }

        norm_box = [
            round(max(0.0, min(1.0, b[0] / width)), 4),
            round(max(0.0, min(1.0, b[1] / height)), 4),
            round(max(0.0, min(1.0, b[2] / width)), 4),
            round(max(0.0, min(1.0, b[3] / height)), 4),
        ]

        return {
            "detected": True,
            "mood": best_mood,
            "moodLabel": MOOD_LABELS_TR[best_mood],
            "emotion": best_emotion,
            "emotionLabel": EMOTION_LABELS_TR[best_emotion],
            "confidence": round(best_conf, 4),
            "scores": {k: round(v, 4) for k, v in raw_scores.items()},
            "emotionScores": {k: round(v, 4) for k, v in emo_scores.items()},
            "faceBox": norm_box,
            "faceCount": len(clusters),
            "snapshotDataUrl": thumbnail_data_url,
        }

    def _run_yolo(self, image: Image.Image, imgsz: int, conf: float) -> list[tuple[str, float, list[float]]]:
        model = self._ensure_model()
        with self._lock:
            result = model.predict(source=image, conf=conf, iou=0.55, imgsz=imgsz, save=False, verbose=False)[0]
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []
        parsed: list[tuple[str, float, list[float]]] = []
        for cls_idx, prob, xyxy in zip(boxes.cls.tolist(), boxes.conf.tolist(), boxes.xyxy.tolist()):
            raw_name = str(result.names[int(cls_idx)]).lower()
            mapped = ALIASES.get(raw_name)
            if mapped:
                parsed.append((mapped, float(prob), [float(v) for v in xyxy]))
        return parsed

    @staticmethod
    def _make_thumbnail_data_url(image: Image.Image, max_side: int = 360) -> str:
        thumb = image.copy()
        thumb.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, format="JPEG", quality=82, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"
