"""Generate app icon assets from the GGM logo screenshot.

Creates:
  - icon.png          (1024x1024) — main app icon, white bg, logo centred with padding
  - adaptive-icon.png (1024x1024) — Android adaptive icon foreground (safe zone = inner 66%)
  - favicon.png       (48x48)     — web favicon
  - splash.png        (1284x2778) — splash screen, white bg, logo centred
  - notification-icon.png (96x96) — notification icon

All assets have a WHITE background with the Gardner's GM logo properly fitted.
"""
import os
import sys
from PIL import Image

# Source logo
LOGO_PATH = r"C:\Users\Chris\Pictures\Screenshots\Screenshot 2026-02-21 153138.png"
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")

os.makedirs(ASSETS_DIR, exist_ok=True)

if not os.path.exists(LOGO_PATH):
    print(f"ERROR: Logo not found at {LOGO_PATH}")
    sys.exit(1)

logo = Image.open(LOGO_PATH).convert("RGBA")
print(f"Source logo: {logo.size[0]}x{logo.size[1]} ({logo.mode})")


def create_icon(logo_img, size, padding_pct, output_path, bg_color=(255, 255, 255, 255)):
    """Create a square icon with logo centred on background.
    
    padding_pct: percentage of the canvas to leave as padding on each side.
    e.g. 0.15 means 15% padding on each side, so logo fills 70% of width.
    """
    canvas = Image.new("RGBA", (size, size), bg_color)
    
    # Calculate available area for the logo
    available = int(size * (1 - 2 * padding_pct))
    
    # Scale logo to fit within available area, maintaining aspect ratio
    logo_w, logo_h = logo_img.size
    ratio = min(available / logo_w, available / logo_h)
    new_w = int(logo_w * ratio)
    new_h = int(logo_h * ratio)
    
    resized = logo_img.resize((new_w, new_h), Image.LANCZOS)
    
    # Centre on canvas
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    
    # Paste with alpha mask for transparency
    canvas.paste(resized, (x, y), resized)
    
    # Convert to RGB (no alpha) for final PNG — app stores require this
    final = Image.new("RGB", (size, size), (255, 255, 255))
    final.paste(canvas, (0, 0), canvas)
    final.save(output_path, "PNG", optimize=True)
    print(f"Created {output_path} ({size}x{size})")


def create_splash(logo_img, width, height, output_path):
    """Create a splash screen with logo centred on white background."""
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    
    # Logo should be ~40% of the width
    available_w = int(width * 0.5)
    available_h = int(height * 0.2)
    
    logo_w, logo_h = logo_img.size
    ratio = min(available_w / logo_w, available_h / logo_h)
    new_w = int(logo_w * ratio)
    new_h = int(logo_h * ratio)
    
    resized = logo_img.resize((new_w, new_h), Image.LANCZOS)
    
    x = (width - new_w) // 2
    y = (height - new_h) // 2
    
    # Paste with alpha mask
    canvas_rgba = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    canvas_rgba.paste(resized, (x, y), resized)
    final = canvas_rgba.convert("RGB")
    final.save(output_path, "PNG", optimize=True)
    print(f"Created {output_path} ({width}x{height})")


# === Generate all assets ===

# 1. Main app icon — 1024x1024, 12% padding (logo fills ~76%)
create_icon(logo, 1024, 0.12, os.path.join(ASSETS_DIR, "icon.png"))

# 2. Android adaptive icon foreground — 1024x1024 
#    Safe zone is inner 66%, so we need MORE padding (~20%) to keep logo inside safe zone
create_icon(logo, 1024, 0.20, os.path.join(ASSETS_DIR, "adaptive-icon.png"))

# 3. Favicon — 48x48, minimal padding
create_icon(logo, 48, 0.08, os.path.join(ASSETS_DIR, "favicon.png"))

# 4. Splash screen — 1284x2778 (iPhone Pro Max, works for all)
create_splash(logo, 1284, 2778, os.path.join(ASSETS_DIR, "splash.png"))

# 5. Notification icon — 96x96
create_icon(logo, 96, 0.10, os.path.join(ASSETS_DIR, "notification-icon.png"))

print("\nAll assets generated with white background + GGM logo.")
print("Ready for EAS build.")
