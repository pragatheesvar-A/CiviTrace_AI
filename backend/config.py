"""Central configuration (env-driven). Secrets never hard-coded."""
from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CIVIC_", env_file=".env", extra="ignore")

    # --- core ---
    app_name: str = "CivicPulse"
    env: str = "dev"  # dev | prod
    db_url: str = f"sqlite+aiosqlite:///{os.path.join(BASE_DIR, 'civicpulse.db')}"
    upload_dir: str = os.path.join(ROOT_DIR, "uploads")
    frontend_dir: str = os.path.join(ROOT_DIR, "frontend")

    # --- auth / security ---
    jwt_secret: str = "dev-only-change-me"  # override with CIVIC_JWT_SECRET in prod
    jwt_alg: str = "HS256"
    access_ttl_min: int = 30
    refresh_ttl_days: int = 30
    login_max_attempts: int = 5
    login_lockout_min: int = 15
    rate_limit_per_min: int = 90
    report_rate_limit_per_hour: int = 40
    require_authority_2fa: bool = False  # set true in prod

    # --- privacy ---
    strip_exif: bool = True
    blur_faces: bool = True
    max_upload_mb: int = 10

    # --- AI ---
    ai_enabled: bool = True
    clip_model: str = "openai/clip-vit-base-patch32"
    text_model: str = "all-MiniLM-L6-v2"
    pothole_weights: str = os.path.join(BASE_DIR, "ai", "weights", "pothole_yolov8.pt")
    yolo_fallback: str = os.path.join(BASE_DIR, "ai", "weights", "yolov8n.pt")
    scene_gate_threshold: float = 0.45
    detect_conf_threshold: float = 0.35
    verify_conf_threshold: float = 0.55
    dedupe_radius_m: float = 75.0
    dedupe_text_sim: float = 0.55

    # --- weather (Open-Meteo — keyless, no signup) ---
    weather_enabled: bool = True
    weather_url: str = "https://api.open-meteo.com/v1/forecast"

    # --- misc ---
    # 7-category civic taxonomy (patent submission spec)
    categories: tuple[str, ...] = (
        "Roads", "Water", "Waste", "Electricity", "Safety", "Flooding", "Traffic")
    # categories that run an image pipeline (CLIP scene gate; Roads adds YOLO)
    vision_categories: tuple[str, ...] = ("Roads", "Flooding", "Traffic")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    os.makedirs(s.upload_dir, exist_ok=True)
    return s


settings = get_settings()
