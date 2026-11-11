"""Draw the Fate Map icon (one cell branching into three lineages, as in fatemap/web/icon.svg) -> AppIcon.icns.
   python make_icon.py OUT.icns   |   python make_icon.py --png OUT.png [size]   (needs Pillow)"""
import os, subprocess, sys, tempfile
from PIL import Image, ImageDraw

def draw(size):
    s = size * 4; u = s / 64
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0)); tile = Image.new("RGBA", (s, s)); td = ImageDraw.Draw(tile)
    a, b = (18, 64, 63), (8, 26, 32)
    for i in range(2 * s):
        t = i / (2 * s); td.line((i, 0, 0, i), fill=tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3)) + (255,), width=2)
    mask = Image.new("L", (s, s), 0); ImageDraw.Draw(mask).rounded_rectangle((3*u, 3*u, 61*u, 61*u), radius=int(13.5*u), fill=255)
    img.paste(tile, (0, 0), mask); d = ImageDraw.Draw(img); w = int(3.2 * u)
    def bez(p0, p1, p2, p3, col):
        pts = []
        for i in range(41):
            t = i / 40; m = 1 - t
            pts.append(tuple((m**3*p0[k] + 3*m*m*t*p1[k] + 3*m*t*t*p2[k] + t**3*p3[k]) * u for k in (0, 1)))
        d.line(pts, fill=col, width=w, joint="curve")
        for q in (pts[0], pts[-1]): d.ellipse((q[0]-w/2, q[1]-w/2, q[0]+w/2, q[1]+w/2), fill=col)
    bez((32,21),(32,33),(14,32),(14,47),(110,168,255,255)); bez((32,21),(32,34),(32,36),(32,47),(255,122,107,255)); bez((32,21),(32,33),(50,32),(50,47),(242,193,78,255))
    for cx, cy, r, c in [(32,17,7,(234,255,251)),(14,49,4.6,(110,168,255)),(32,49,4.6,(255,122,107)),(50,49,4.6,(242,193,78))]:
        d.ellipse(((cx-r)*u, (cy-r)*u, (cx+r)*u, (cy+r)*u), fill=c + (255,))
    return img.resize((size, size), Image.LANCZOS)

def main(out):
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "AppIcon.iconset"); os.mkdir(iconset)
        for base in (16, 32, 128, 256, 512):
            draw(base).save(os.path.join(iconset, f"icon_{base}x{base}.png")); draw(base*2).save(os.path.join(iconset, f"icon_{base}x{base}@2x.png"))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--png": draw(int(sys.argv[3]) if len(sys.argv) > 3 else 512).save(sys.argv[2])
    else: main(sys.argv[1] if len(sys.argv) > 1 else "AppIcon.icns")
