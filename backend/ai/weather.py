"""
Rainfall / weather correlation for the Flooding category.

Contribution: a flooding report is corroborated not only by the photo and by
nearby duplicate reports, but by *independent* meteorological evidence. We query
Open-Meteo (keyless, no signup) for the last 24 h of precipitation and the next
6 h forecast at the report's coordinates, and turn it into a bounded
``rain_factor`` in [0, 1] that feeds the verifier and the priority model.

If the network is unavailable the factor is a neutral 0.35 and the evidence
chain records that the correlation was skipped — never a hard failure.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from functools import lru_cache

from config import settings


@dataclass
class RainContext:
    rain_factor: float          # 0..1 — meteorological support for a flooding claim
    rain_last_24h_mm: float
    rain_next_6h_mm: float
    is_raining_now: bool
    method: str                 # "open-meteo" | "unavailable"
    detail: str

    def dict(self) -> dict:
        return asdict(self)


_NEUTRAL = RainContext(0.35, 0.0, 0.0, False, "unavailable", "weather lookup skipped")


def _round_key(lat: float, lng: float) -> tuple[float, float]:
    # cache at ~1 km granularity, 10-minute buckets
    return (round(lat, 2), round(lng, 2))


@lru_cache(maxsize=256)
def _fetch(lat_key: float, lng_key: float, bucket: int) -> RainContext:
    if not settings.weather_enabled:
        return _NEUTRAL
    params = urllib.parse.urlencode({
        "latitude": lat_key, "longitude": lng_key,
        "hourly": "precipitation",
        "past_hours": 24, "forecast_hours": 6,
        "timezone": "UTC",
    })
    url = f"{settings.weather_url}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=4) as r:
            data = json.loads(r.read().decode("utf-8"))
        series = data.get("hourly", {}).get("precipitation", []) or []
        if not series:
            return _NEUTRAL
        past = [float(x or 0) for x in series[:24]]
        future = [float(x or 0) for x in series[24:30]]
        last24 = round(sum(past), 2)
        next6 = round(sum(future), 2)
        now_rain = (past[-1] if past else 0) > 0.1
        # 40 mm/24 h ≈ heavy urban-flooding rain → saturate the factor there
        factor = max(0.0, min(1.0, 0.15 + last24 / 40.0 + next6 / 30.0))
        return RainContext(
            rain_factor=round(factor, 3), rain_last_24h_mm=last24, rain_next_6h_mm=next6,
            is_raining_now=now_rain, method="open-meteo",
            detail=f"{last24} mm in last 24 h, {next6} mm expected next 6 h",
        )
    except Exception as e:  # pragma: no cover
        c = RainContext(**{**asdict(_NEUTRAL)})
        c.detail = f"weather lookup failed: {e}"
        return c


def context_for(lat: float, lng: float) -> RainContext:
    lk, gk = _round_key(lat, lng)
    return _fetch(lk, gk, int(time.time() // 600))
