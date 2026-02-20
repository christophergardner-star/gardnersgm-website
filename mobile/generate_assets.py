"""Generate placeholder app icons and splash screen for GGM Field app.
Creates minimal valid PNG files without external dependencies.
"""
import struct, zlib, os

def create_png(width, height, r, g, b):
    """Create a solid-colour PNG as bytes."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + c + crc

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))

    raw = b''
    row = struct.pack('BBB', r, g, b) * width
    for _ in range(height):
        raw += b'\x00' + row

    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend


def create_png_with_text(width, height, bg_r, bg_g, bg_b, text_lines=None):
    """Create a PNG with coloured background. Text not supported without Pillow,
    but the solid colour with the GGM green branding is enough for the build."""
    return create_png(width, height, bg_r, bg_g, bg_b)


os.makedirs('assets', exist_ok=True)

# GGM brand green: #2E7D32
R, G, B = 0x2E, 0x7D, 0x32

# icon.png — 1024x1024 (Expo standard)
with open('assets/icon.png', 'wb') as f:
    f.write(create_png(1024, 1024, R, G, B))
print('Created assets/icon.png (1024x1024)')

# adaptive-icon.png — 1024x1024  (Android adaptive icon foreground)
with open('assets/adaptive-icon.png', 'wb') as f:
    f.write(create_png(1024, 1024, R, G, B))
print('Created assets/adaptive-icon.png (1024x1024)')

# splash.png — 1284x2778 (iPhone Pro Max size, works for all)
with open('assets/splash.png', 'wb') as f:
    f.write(create_png(1284, 2778, R, G, B))
print('Created assets/splash.png (1284x2778)')

# favicon.png — 48x48 (web)
with open('assets/favicon.png', 'wb') as f:
    f.write(create_png(48, 48, R, G, B))
print('Created assets/favicon.png (48x48)')

print('Done — all assets created with GGM green (#2E7D32)')
