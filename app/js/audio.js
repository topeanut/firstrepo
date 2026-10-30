// Microphone recording (stamps strokes with the recording time) and playback.
import { getBlob, putBlob, uid } from "./db.js";

function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const t of ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

export class Recorder {
  constructor() {
    this.rec = null;
    this.id = null;
    this.startedAt = 0;
  }
  get active() {
    return !!this.rec;
  }
  // Seconds since the current recording started.
  now() {
    return (performance.now() - this.startedAt) / 1000;
  }
  async start(id) {
    const mime = pickMime();
    if (mime === null) throw new Error("이 브라우저는 녹음을 지원하지 않아요.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    this.chunks = [];
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.id = id;
    this.startedAt = performance.now();
  }
  // Stops and stores the audio; resolves to a recording entry for the doc.
  stop() {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    const duration = this.now();
    return new Promise((resolve) => {
      rec.onstop = async () => {
        this.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/mp4" });
        const key = "audio-" + uid();
        await putBlob(key, blob);
        const entry = { id: this.id, blob: key, duration, name: "녹음 " + this.id, created: Date.now() };
        this.rec = null;
        this.id = null;
        resolve(entry);
      };
      rec.stop();
    });
  }
}

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.recording = null;
    this.url = null;
  }
  async load(recording) {
    if (this.recording?.blob === recording.blob) return;
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    const blob = await getBlob(recording.blob);
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    this.recording = recording;
  }
  get duration() {
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : this.recording?.duration || 0;
  }
  async seek(t, play = true) {
    const go = () => {
      this.audio.currentTime = Math.max(0, t);
      if (play) this.audio.play().catch(() => {});
    };
    if (this.audio.readyState >= 1) go();
    else this.audio.addEventListener("loadedmetadata", go, { once: true });
  }
  close() {
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.audio.removeAttribute("src");
    this.recording = null;
    this.url = null;
  }
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};
