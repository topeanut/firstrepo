# Generates scan60.pdf: 60 scanned-looking pages (one 1240x1754 JPEG each), used by the
# freeze/memory tests. Usage: python3 make-scan-pdf.py <out-dir>   (needs Pillow)
import os, random, sys
from PIL import Image, ImageDraw, ImageFilter

random.seed(1)
pages = []
for i in range(60):
    im = Image.new("L", (1240, 1754), 255)
    d = ImageDraw.Draw(im)
    for row in range(40):
        y, x = 120 + row * 38, 100
        while x < 1100:
            w = random.randint(20, 90)
            d.rectangle([x, y, x + w, y + 18], fill=random.randint(0, 80))
            x += w + random.randint(8, 20)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    pages.append(im.convert("RGB"))
out = os.path.join(sys.argv[1] if len(sys.argv) > 1 else ".", "scan60.pdf")
pages[0].save(out, save_all=True, append_images=pages[1:], resolution=150, quality=70)
print(out, os.path.getsize(out) // 1024, "KB")
