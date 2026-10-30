// Light / dark theme: "system" follows iPadOS appearance.
const KEY = "penote.theme";
const DARK_PDF_KEY = "penote.darkPdf";
const mq = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set();

const read = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export const THEMES = ["light", "dark", "system"];
export const THEME_LABEL = { system: "시스템 설정", light: "라이트", dark: "다크" };

export const getTheme = () => read(KEY, "light");
export const isDark = () => (getTheme() === "system" ? mq.matches : getTheme() === "dark");
export const darkPdf = () => read(DARK_PDF_KEY, "0") === "1";

function apply() {
  const t = getTheme();
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark() ? "#141416" : "#f2f2f6";
  listeners.forEach((fn) => fn());
}

export function cycleTheme() {
  const t = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  write(KEY, t);
  apply();
  return t;
}

export function toggleDarkPdf() {
  write(DARK_PDF_KEY, darkPdf() ? "0" : "1");
  apply();
}

export const onThemeChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

mq.addEventListener?.("change", () => getTheme() === "system" && apply());
apply();

// Ink colour as shown on dark paper: near-black ink turns light, other colours brighten slightly.
export function darkInk(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.25) return "#e8e8ea";
  const lift = (v) => Math.round(v + (255 - v) * 0.18);
  return "#" + [lift(r), lift(g), lift(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
