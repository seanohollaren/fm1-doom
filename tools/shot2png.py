"""Convert a host-test frame dump (pico-host-sdl FM1_SHOT_DIR hook) to PNG: shot2png.py in.raw out.png"""
import struct, sys
from PIL import Image
d = open(sys.argv[1], 'rb').read()
w, h, pitch, bpp = struct.unpack('<4i', d[:16]); px = d[16:]
print(w, h, pitch, bpp)
vw = pitch // 2                      # the pixels are 16-bit whatever the surface claims
im = Image.new('RGB', (vw, h))
out = []
for y in range(h):
    row = struct.unpack('<%dH' % vw, px[y*pitch:y*pitch + vw*2])
    out += [((v & 31) << 3, ((v >> 6) & 31) << 3, ((v >> 11) & 31) << 3) for v in row]
im.putdata(out)
step = max(1, h // 200)
im.crop((0, 0, 640, h)).resize((640, 400), Image.NEAREST).save(sys.argv[2]) if h >= 200 else im.save(sys.argv[2])
