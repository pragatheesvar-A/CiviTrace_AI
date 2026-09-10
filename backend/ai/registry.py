"""
Lazy model registry — loads heavy models once, on first use, in a worker thread,
and always degrades gracefully so the API never hard-fails when a model or its
download is unavailable.

Every consumer can call `registry.status()` to know exactly which model backed a
decision (this provenance is surfaced all the way to the authority dashboard).
"""
from __future__ import annotations

import threading
import time
from typing import Any, Optional

from config import settings


class _Registry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._threads_capped = False
        self._clip: Any = None
        self._clip_proc: Any = None
        self._text: Any = None
        self._yolo: Any = None
        self._yolo_kind: str = "none"  # "pothole" | "generic" | "none"
        self._loaded: dict[str, str] = {}  # name -> "ok" | "error: ..."
        self._timings: dict[str, float] = {}

    def _cap_threads(self):
        """Keep inference from monopolising the box so the API stays responsive."""
        if self._threads_capped:
            return
        self._threads_capped = True
        try:
            import os as _os

            # Inference runs on a single-consumer queue (one job at a time), so let
            # each job use most of the box for low latency — leave 1 core for the API.
            n = max(1, (_os.cpu_count() or 4) - 1)
            import torch

            torch.set_num_threads(n)
            try:
                import cv2

                cv2.setNumThreads(1)
            except Exception:
                pass
        except Exception:
            pass

    # ---------------------------------------------------------------- CLIP
    def clip(self):
        self._cap_threads()
        if self._clip is not None or self._loaded.get("clip", "").startswith("error"):
            return self._clip, self._clip_proc
        with self._lock:
            if self._clip is None and "clip" not in self._loaded:
                t = time.time()
                try:
                    import torch
                    from transformers import CLIPModel, CLIPProcessor

                    self._clip = CLIPModel.from_pretrained(settings.clip_model).eval()
                    self._clip_proc = CLIPProcessor.from_pretrained(settings.clip_model)
                    torch.set_grad_enabled(False)
                    self._loaded["clip"] = "ok"
                except Exception as e:  # pragma: no cover
                    self._loaded["clip"] = f"error: {e}"
                self._timings["clip"] = round(time.time() - t, 1)
        return self._clip, self._clip_proc

    # ---------------------------------------------------- sentence-transformers
    def text_encoder(self):
        if self._text is not None or self._loaded.get("text", "").startswith("error"):
            return self._text
        with self._lock:
            if self._text is None and "text" not in self._loaded:
                t = time.time()
                try:
                    from sentence_transformers import SentenceTransformer

                    self._text = SentenceTransformer(settings.text_model)
                    self._loaded["text"] = "ok"
                except Exception as e:  # pragma: no cover
                    self._loaded["text"] = f"error: {e}"
                self._timings["text"] = round(time.time() - t, 1)
        return self._text

    # ---------------------------------------------------------------- YOLO
    def yolo(self):
        if self._yolo is not None or self._loaded.get("yolo", "").startswith("error"):
            return self._yolo, self._yolo_kind
        with self._lock:
            if self._yolo is None and "yolo" not in self._loaded:
                t = time.time()
                try:
                    import os

                    from ultralytics import YOLO

                    if os.path.exists(settings.pothole_weights):
                        self._yolo = YOLO(settings.pothole_weights)
                        self._yolo_kind = "pothole"
                    else:
                        self._yolo = YOLO(settings.yolo_fallback)
                        self._yolo_kind = "generic"
                    self._loaded["yolo"] = "ok"
                except Exception as e:  # pragma: no cover
                    self._loaded["yolo"] = f"error: {e}"
                self._timings["yolo"] = round(time.time() - t, 1)
        return self._yolo, self._yolo_kind

    # ---------------------------------------------------------------- warmup
    def warmup(self) -> None:
        """Kick off loads in a background thread so first request isn't slow."""
        if not settings.ai_enabled:
            return

        def _go():
            try:
                from security import sanitize_image
                from PIL import Image as _I
                import io as _io
                _b = _io.BytesIO(); _I.new("RGB", (48, 48)).save(_b, "JPEG")
                sanitize_image(_b.getvalue())   # warms the Haar cascade
            except Exception:
                pass
            # load + one dummy inference each so the first real request is warm
            enc = self.text_encoder()
            if enc is not None:
                try:
                    enc.encode(["warmup"])
                except Exception:
                    pass
            model, proc = self.clip()
            yolo, _ = self.yolo()
            try:
                from PIL import Image
                img = Image.new("RGB", (64, 64), (120, 120, 120))
                if model is not None and proc is not None:
                    import torch
                    with torch.no_grad():
                        model(**proc(text=["road", "not road"], images=img, return_tensors="pt", padding=True))
                if yolo is not None:
                    import numpy as np
                    yolo.predict(np.asarray(img), verbose=False)
            except Exception:
                pass

        threading.Thread(target=_go, daemon=True).start()

    # ---------------------------------------------------------------- status
    def status(self) -> dict:
        return {
            "ai_enabled": settings.ai_enabled,
            "models": dict(self._loaded),
            "load_seconds": dict(self._timings),
            "yolo_kind": self._yolo_kind,
            "clip_model": settings.clip_model,
            "text_model": settings.text_model,
        }


registry = _Registry()
