"""Parser for Notability .note files (format observed on v14.x, sessionFormatVersion 9).

Usage:
    python3 note_parser.py <file.note> <out_dir>            # summary + strokes.json
    python3 note_parser.py <file.note> <out_dir> --render   # also render pages to PNG (needs pdftoppm + Pillow)
"""
import json
import plistlib
import struct
import subprocess
import sys
import zipfile
from pathlib import Path


class Archive:
    """Minimal NSKeyedArchiver / GLKeyedArchiver object-graph reader."""

    def __init__(self, data):
        self.plist = plistlib.loads(data)
        self.objs = self.plist["$objects"]

    def deref(self, v):
        return self.objs[v.data] if isinstance(v, plistlib.UID) else v

    def classname(self, obj):
        if isinstance(obj, dict) and "$class" in obj:
            return self.deref(obj["$class"])["$classname"]
        return None

    def root(self):
        return self.deref(next(iter(self.plist["$top"].values())))

    def get(self, obj, key):
        return self.deref(obj[key]) if key in obj else None

    def to_py(self, v, depth=0):
        v = self.deref(v)
        if depth > 20 or not isinstance(v, dict):
            return v
        if "NS.keys" in v:
            return {self.to_py(k, depth + 1): self.to_py(o, depth + 1)
                    for k, o in zip(v["NS.keys"], v["NS.objects"])}
        if "NS.objects" in v:
            return [self.to_py(o, depth + 1) for o in v["NS.objects"]]
        if "NS.string" in v:
            return v["NS.string"]
        if "NS.time" in v:
            return v["NS.time"]
        return v


def unpack(fmt, buf):
    size = struct.calcsize("<" + fmt)
    return [x[0] if len(x) == 1 else x for x in struct.iter_unpack("<" + fmt, buf[: len(buf) // size * size])]


def parse(note_path):
    z = zipfile.ZipFile(note_path)
    prefix = z.namelist()[0].split("/")[0]
    read = lambda name: z.read(f"{prefix}/{name}")

    arc = Archive(read("Session.plist"))
    session = arc.root()
    rich = arc.get(session, "richText")

    # Paper / page geometry: PDF pages are scaled to the locked paper width and stacked vertically.
    layout = arc.get(session, "NBNoteTakingSessionDocumentPaperLayoutModelKey")
    paper = {k: arc.deref(v) for k, v in arc.get(layout, "documentPaperAttributes").items() if k != "$class"}
    paper_width = float(paper["paperSizingBehavior"].split(":")[1])
    pages = [{k: v for k, v in arc.to_py(p).items() if k != "kPageLayoutPDFFileKey"}
             for p in arc.to_py(arc.get(rich, "pageLayoutArray"))]

    # Ink: struct-of-arrays, one entry per curve, points flattened across all curves.
    h = arc.get(arc.get(rich, "Handwriting Overlay"), "SpatialHash")
    n = arc.deref(h["numcurves"])
    npts = unpack("I", arc.get(h, "curvesnumpoints"))
    pts = unpack("ff", arc.get(h, "curvespoints"))
    colors = unpack("BBBB", arc.get(h, "curvescolors"))
    widths = unpack("f", arc.get(h, "curveswidth"))
    styles = list(arc.get(h, "curvesstyles"))
    uuids = arc.get(h, "curveUUIDs")
    forces = unpack("f", arc.get(h, "curvesforces"))

    # Audio sync: event UUID -> (recording id, timestamp in recording, duration).
    ev = arc.get(session, "contentPlaybackEventManager")
    sync = {}
    if ev:
        ne = arc.deref(ev["NBCPTimeManagerSOANumEventsKey"])
        eu = arc.get(ev, "NBCPTimeManagerSOAEventUUIDsKey")
        ts = unpack("f", arc.get(ev, "NBCPTimeManagerSOATimestampsKey"))
        rid = unpack("I", arc.get(ev, "NBCPTimeManagerSOARecordingIDsKey"))
        du = unpack("f", arc.get(ev, "NBCPTimeManagerSOADurationsKey"))
        for i in range(ne):
            sync[eu[i * 16:(i + 1) * 16].hex()] = {"recording": rid[i], "t": ts[i], "dur": du[i]}

    curves, off = [], 0
    for i in range(n):
        c_pts = pts[off:off + npts[i]]
        c_force = forces[off:off + npts[i]] if len(forces) == len(pts) else []
        off += npts[i]
        uid = uuids[i * 16:(i + 1) * 16].hex()
        curves.append({
            "uuid": uid,
            "points": [[round(x, 2), round(y, 2)] for x, y in c_pts],
            "forces": [round(f, 3) for f in c_force],
            "color": "#%02x%02x%02x%02x" % colors[i],
            "width": round(widths[i], 3),
            "style": styles[i] if i < len(styles) else None,
            "audio": sync.get(uid),
        })

    recordings = plistlib.loads(read("Recordings/library.plist")).get("recordings", {}) \
        if f"{prefix}/Recordings/library.plist" in z.namelist() else {}

    return {
        "name": arc.deref(session["name"]),
        "bundleVersion": arc.deref(session.get("NBNoteTakingSessionBundleVersionNumberKey")),
        "sessionFormatVersion": arc.deref(session.get("sessionFormatVersion")),
        "paper": paper,
        "paperWidth": paper_width,
        "pages": pages,
        "recordings": {k: {kk: str(vv) if kk == "createddate" else vv for kk, vv in r.items()}
                       for k, r in recordings.items()},
        "numAudioEvents": len(sync),
        "curves": curves,
    }, z, prefix


# Where an imported PDF page sits inside each paper page, in paper units. Pages are stacked
# vertically (page height = paperWidth * PAGE_ASPECT). Fitted against Notability's own PDF
# export of the same note; the PDF is inset slightly rather than filling the paper exactly.
PAGE_ASPECT = 0.75
PDF_RECT_X, PDF_RECT_Y = -10.3, 8.8
PDF_RECT_W, PDF_RECT_H = 708.5, 529.4


def render(doc, z, prefix, out_dir, scale=2.0):
    from PIL import Image, ImageDraw

    pdf_name = doc["pages"][0]["kPageLayoutPDFFileNameKey"]
    pdf_path = out_dir / pdf_name
    pdf_path.write_bytes(z.read(f"{prefix}/PDFs/{pdf_name}"))
    subprocess.run(["pdftoppm", "-png", "-r", str(int(72 * scale)), str(pdf_path), str(out_dir / "pdf")], check=True)
    pngs = sorted(out_dir.glob("pdf-*.png"))

    page_h = doc["paperWidth"] * PAGE_ASPECT
    for i, png in enumerate(pngs):
        img = Image.open(png).convert("RGB")
        top = i * page_h
        # Map paper units -> pixels of the rendered PDF page (see PDF_RECT_* above).
        k = img.width / PDF_RECT_W
        tx = lambda x: (x - PDF_RECT_X) * k
        ty = lambda y: (y - top - PDF_RECT_Y) * img.height / PDF_RECT_H
        draw = ImageDraw.Draw(img, "RGBA")
        for c in doc["curves"]:
            ys = [p[1] for p in c["points"]]
            if not ys or max(ys) < top or min(ys) > top + page_h:
                continue
            xy = [(tx(x), ty(y)) for x, y in c["points"]]
            rgba = tuple(int(c["color"][j:j + 2], 16) for j in (1, 3, 5, 7))
            w = max(1, int(c["width"] * k * 1.5))
            if len(xy) == 1:
                x, y = xy[0]
                draw.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=rgba)
            else:
                draw.line(xy, fill=rgba, width=w, joint="curve")
        img.save(out_dir / f"page-{i + 1:02d}.png")
        png.unlink()


def main():
    note, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    doc, z, prefix = parse(note)
    (out / "strokes.json").write_text(json.dumps(doc, ensure_ascii=False))
    synced = sum(1 for c in doc["curves"] if c["audio"])
    print(f"{doc['name']}: {len(doc['pages'])} pages, {len(doc['curves'])} curves "
          f"({synced} audio-linked), {len(doc['recordings'])} recordings, paper width {doc['paperWidth']}")
    if "--render" in sys.argv:
        render(doc, z, prefix, out)
        print(f"rendered pages to {out}")


if __name__ == "__main__":
    main()
