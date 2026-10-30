// Attachments placed on pages: images and arbitrary files.
// item = { id, page, type: "image" | "file", x, y, w, h, blob, name, mime, size }
// Coordinates are page units, like strokes. Items render between the page background and ink.
import { getBlob, putBlob, uid } from "./db.js";
import { icon } from "./icons.js";

const MAX_IMAGE_DIM = 2400;
export const FILE_CARD = { w: 300, h: 64 };

// Downscales large photos so a note stays small; returns { blob, width, height }.
export async function prepareImage(file) {
  const bmp = await createImageBitmap(file);
  const { width, height } = bmp;
  const k = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
  if (k === 1 && file.size < 2e6 && /^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    bmp.close?.();
    return { blob: file, width, height };
  }
  const c = document.createElement("canvas");
  c.width = Math.round(width * k);
  c.height = Math.round(height * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
  const out = { blob, width: c.width, height: c.height };
  c.width = c.height = 0;
  return out;
}

export async function makeImageItem(file, page, center) {
  const { blob, width, height } = await prepareImage(file);
  const key = "img-" + uid();
  await putBlob(key, blob);
  const w = Math.min(page.w * 0.6, width);
  const h = (w * height) / width;
  return { id: uid(), page: page.id, type: "image", x: center[0] - w / 2, y: center[1] - h / 2, w, h, blob: key, name: file.name, mime: blob.type, size: blob.size };
}

export async function makeFileItem(file, page, center) {
  const key = "file-" + uid();
  await putBlob(key, file);
  const { w, h } = FILE_CARD;
  return { id: uid(), page: page.id, type: "file", x: center[0] - w / 2, y: center[1] - h / 2, w, h, blob: key, name: file.name || "파일", mime: file.type || "application/octet-stream", size: file.size };
}

export const fmtSize = (n) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const extOf = (name) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "file").toUpperCase();

// Builds (or refreshes) the DOM element for an item inside a page view.
export function itemElement(item, page, urls) {
  const el = document.createElement("div");
  el.className = "item item-" + item.type;
  el.dataset.id = item.id;
  positionItem(el, item, page);
  if (item.type === "image") {
    const img = document.createElement("img");
    img.alt = item.name || "";
    img.draggable = false;
    urls(item.blob).then((u) => (img.src = u));
    el.append(img);
  } else {
    el.innerHTML = `<span class="file-ext">${extOf(item.name)}</span><span class="file-text"><span class="file-name"></span><span class="file-size">${fmtSize(item.size || 0)}</span></span>`;
    el.querySelector(".file-name").textContent = item.name;
  }
  el.insertAdjacentHTML(
    "beforeend",
    `<span class="item-handle" data-handle="resize"></span><span class="item-bar"><button data-act="item-open">열기</button><button data-act="item-delete">${icon("close")}</button></span>`
  );
  return el;
}

export function positionItem(el, item, page) {
  el.style.left = (item.x / page.w) * 100 + "%";
  el.style.top = (item.y / page.h) * 100 + "%";
  el.style.width = (item.w / page.w) * 100 + "%";
  el.style.height = (item.h / page.h) * 100 + "%";
}

export const hitItem = (it, x, y) => x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h;

// Opens an attachment: share sheet when available (iPad: "파일에 저장", other apps), else a new tab.
export async function openItem(item) {
  const blob = await getBlob(item.blob);
  if (!blob) throw new Error("첨부 파일을 찾을 수 없어요.");
  const file = new File([blob], item.name || "file", { type: item.mime || blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  if (!/^(image\/|application\/pdf|text\/)/.test(file.type)) a.download = file.name;
  a.target = "_blank";
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Draws items into an export/thumbnail canvas.
export async function drawItems(ctx, items, scale) {
  for (const it of items) {
    const x = it.x * scale, y = it.y * scale, w = it.w * scale, h = it.h * scale;
    if (it.type === "image") {
      const blob = await getBlob(it.blob);
      if (!blob) continue;
      try {
        const bmp = await createImageBitmap(blob);
        ctx.drawImage(bmp, x, y, w, h);
        bmp.close?.();
      } catch {}
    } else {
      ctx.save();
      ctx.fillStyle = "#f3f4f6";
      ctx.strokeStyle = "#d0d4da";
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 10 * scale) : ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#2f6fed";
      ctx.fillRect(x + 10 * scale, y + 10 * scale, 44 * scale, h - 20 * scale);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${12 * scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(extOf(it.name).slice(0, 4), x + 32 * scale, y + h / 2);
      ctx.textAlign = "left";
      ctx.fillStyle = "#1f2328";
      ctx.font = `${15 * scale}px sans-serif`;
      let name = it.name;
      const maxW = w - 76 * scale;
      while (name.length > 4 && ctx.measureText(name).width > maxW) name = name.slice(0, -2);
      if (name !== it.name) name += "…";
      ctx.fillText(name, x + 66 * scale, y + h / 2 - 8 * scale);
      ctx.fillStyle = "#6b6f76";
      ctx.font = `${12 * scale}px sans-serif`;
      ctx.fillText(fmtSize(it.size || 0), x + 66 * scale, y + h / 2 + 12 * scale);
      ctx.restore();
    }
  }
}
