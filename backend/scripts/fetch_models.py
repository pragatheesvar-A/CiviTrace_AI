"""
Pre-download the AI models so the first request isn't slow.
Safe to re-run — everything is cached. Never fails the build: on no network it
just warns and the API falls back to deterministic heuristics.

    python backend/scripts/fetch_models.py
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

WEIGHTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ai", "weights")
os.makedirs(WEIGHTS, exist_ok=True)


def ok(m):
    print(f"  [ok] {m}", flush=True)


def warn(m):
    print(f"  [skip] {m}", flush=True)


def main():
    print("Fetching CivicPulse AI models…")
    try:
        from transformers import CLIPModel, CLIPProcessor

        CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        ok("CLIP ViT-B/32 (scene gate)")
    except Exception as e:
        warn(f"CLIP unavailable: {str(e)[:120]}")

    try:
        from sentence_transformers import SentenceTransformer

        SentenceTransformer("all-MiniLM-L6-v2")
        ok("MiniLM-L6-v2 (text + embeddings)")
    except Exception as e:
        warn(f"sentence-transformers unavailable: {str(e)[:120]}")

    dst = os.path.join(WEIGHTS, "pothole_yolov8.pt")
    if os.path.exists(dst):
        ok("YOLOv8 pothole weights (cached)")
    else:
        try:
            import shutil

            from huggingface_hub import hf_hub_download
            from ultralytics import YOLO

            for repo in ("keremberke/yolov8m-pothole-segmentation",
                         "keremberke/yolov8n-pothole-segmentation"):
                try:
                    p = hf_hub_download(repo_id=repo, filename="best.pt")
                    shutil.copy(p, dst)
                    YOLO(dst)
                    ok(f"YOLOv8 pothole weights ({repo})")
                    break
                except Exception:
                    continue
            else:
                warn("no pothole checkpoint reachable — detector will use generic YOLOv8n")
        except Exception as e:
            warn(f"ultralytics/hf unavailable: {str(e)[:120]}")
    print("Done.")


if __name__ == "__main__":
    main()
