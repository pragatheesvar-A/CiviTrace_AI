// Live camera capture with a real-time AI detection overlay — a bounding box
// + confidence value drawn over the live preview as you frame the shot, the
// same way a face-recognition attendance kiosk shows a box on the live feed.
//
// Honesty: the boxes come from the SAME CLIP scene gate + YOLOv8 pothole
// detector the backend uses for real verification (/api/vision/preview runs
// them on an actual frame from your camera, nothing is faked or animated).
// It is not a claim of 30fps real-time inference — the client sends one frame
// at a time and waits for the previous result before sending the next, so the
// overlay updates roughly every 1-2s on typical hardware. The photo you
// capture is a full-resolution frame; the authoritative verification (Evidence
// Trust, priority, etc.) still runs on it after you submit the report.
import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.jsx";
import { Icon } from "./ui.jsx";

const VISION_CATS = ["Roads", "Flooding", "Traffic"];
const BOX_COLOR = "#3ddc84";

export default function LiveCamera({ category, onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState("Starting camera…");
  const [error, setError] = useState("");
  const [last, setLast] = useState(null);   // last /vision/preview result
  const hasPreview = VISION_CATS.includes(category);

  useEffect(() => {
    stoppedRef.current = false;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();
        setStatus("");
        if (hasPreview) tick();
      } catch (e) {
        setError(
          e?.name === "NotAllowedError" ? "Camera permission denied — allow camera access, or choose a photo instead."
            : "Couldn't open the camera on this device — choose a photo instead.");
      }
    })();
    return () => {
      cancelled = true;
      stoppedRef.current = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function grabFrame(maxW) {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, maxW / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.55);
  }

  async function tick() {
    if (stoppedRef.current) return;
    if (!busyRef.current) {
      busyRef.current = true;
      try {
        const frame = grabFrame(480);   // small + fast — this is a live preview, not the saved photo
        if (frame) {
          const r = await api("/vision/preview", { method: "POST", body: { image_base64: frame, category } });
          if (!stoppedRef.current) { setLast(r); paint(r); }
        }
      } catch { /* transient — try again next tick */ }
      busyRef.current = false;
    }
    if (!stoppedRef.current) setTimeout(tick, 250);
  }

  function paint(r) {
    const v = videoRef.current, cv = canvasRef.current;
    if (!v || !cv) return;
    const w = v.clientWidth, h = v.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    for (const d of r.detections || []) {
      const [x1, y1, x2, y2] = d.box;
      const x = x1 * w, y = y1 * h, bw = (x2 - x1) * w, bh = (y2 - y1) * h;
      ctx.strokeStyle = BOX_COLOR;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, bw, bh);
      const label = `${d.label} ${(d.confidence * 100).toFixed(0)}%`;
      ctx.font = "bold 13px Inter, sans-serif";
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = BOX_COLOR;
      ctx.fillRect(x, Math.max(0, y - 22), tw, 22);
      ctx.fillStyle = "#04140c";
      ctx.fillText(label, x + 6, Math.max(15, y - 6));
    }
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const dataUrl = c.toDataURL("image/jpeg", 0.92);
    c.toBlob((blob) => {
      const url = blob ? URL.createObjectURL(blob) : dataUrl;
      onCapture(dataUrl, url);
    }, "image/jpeg", 0.92);
  }

  const detCount = last?.detections?.length || 0;
  const sceneScore = last?.scene ? Math.round(last.scene.score * 100) : null;

  return (
    <div className="fixed inset-0 z-[999] bg-black flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {status && (
          <div className="absolute inset-0 grid place-items-center text-white text-sm gap-2 flex-col flex">
            <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {status}
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 top-4 bg-error/95 text-white text-xs p-3 rounded-xl flex items-start gap-2">
            <Icon name="error" className="text-sm mt-px" />{error}
          </div>
        )}
        {!error && !status && (
          <div className="absolute top-4 left-4 right-4 flex items-center justify-center gap-2 bg-black/55 backdrop-blur px-3 py-2 rounded-full text-white text-xs font-semibold"
               style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)" }}>
            {hasPreview ? (
              <>
                <span className={`w-2 h-2 rounded-full ${detCount ? "bg-secondary" : "bg-amber-400"} animate-pulse`} />
                {detCount
                  ? `Live AI: ${detCount} pothole${detCount > 1 ? "s" : ""} detected`
                  : sceneScore != null
                    ? `Live AI: scanning · road-scene ${sceneScore}%`
                    : "Live AI: scanning…"}
              </>
            ) : (
              <>
                <Icon name="info" className="text-sm" />
                No live detector for {category} — frame it clearly, description matters most
              </>
            )}
          </div>
        )}
        <button onClick={onClose} type="button"
          className="absolute left-4 w-9 h-9 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center"
          style={{ top: "calc(env(safe-area-inset-top,0px) + 56px)" }}>
          <Icon name="close" className="text-lg" />
        </button>
      </div>

      <div className="bg-black px-6 flex items-center justify-between"
           style={{ paddingTop: 20, paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 24px)" }}>
        <button onClick={onClose} type="button" className="text-white/70 text-sm font-bold w-16 text-left">Cancel</button>
        <button onClick={capture} type="button" disabled={!!status || !!error}
          className="w-[68px] h-[68px] rounded-full border-4 border-white bg-white/15 active:scale-90 transition-transform disabled:opacity-40" />
        <span className="w-16" />
      </div>
    </div>
  );
}
