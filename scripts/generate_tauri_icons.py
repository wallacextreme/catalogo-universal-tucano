#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/generate_tauri_icons.py
Gera conjunto completo de ícones binários válidos (.ico e .png) para PWA e Tauri v2 Windows (.exe e .msi).
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
PUBLIC_DIR = PROJECT_ROOT / "public"
TAURI_ICONS_DIR = PROJECT_ROOT / "src-tauri" / "icons"


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Fundo arredondado azul automotivo (#1D4ED8)
    radius = int(size * 0.22)
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=(29, 78, 216, 255))

    # Borda sutil interna
    draw.rounded_rectangle([(int(size * 0.04), int(size * 0.04)), (size - 1 - int(size * 0.04), size - 1 - int(size * 0.04))], radius=radius - 2, outline=(59, 130, 246, 255), width=max(1, int(size * 0.03)))

    # Letra estilizada "T" ou símbolo Tucano / Engrenagem central
    center = size / 2
    # Círculo central branco
    c_r = int(size * 0.28)
    draw.ellipse([(center - c_r, center - c_r), (center + c_r, center + c_r)], fill=(255, 255, 255, 255))
    
    # Detalhe interno azul
    in_r = int(size * 0.16)
    draw.ellipse([(center - in_r, center - in_r), (center + in_r, center + in_r)], fill=(29, 78, 216, 255))

    # Letra "T" branca no centro
    t_width = int(size * 0.14)
    t_top = int(center - size * 0.10)
    t_bottom = int(center + size * 0.10)
    draw.rectangle([(int(center - t_width / 2), t_top), (int(center + t_width / 2), t_top + int(size * 0.04))], fill=(255, 255, 255, 255))
    draw.rectangle([(int(center - size * 0.02), t_top), (int(center + size * 0.02), t_bottom)], fill=(255, 255, 255, 255))

    return img


def main():
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    TAURI_ICONS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. PWA Icons
    icon_192 = draw_icon(192)
    icon_192.save(PUBLIC_DIR / "icon-192.png", "PNG")
    icon_512 = draw_icon(512)
    icon_512.save(PUBLIC_DIR / "icon-512.png", "PNG")

    # 2. Tauri Icons
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }

    for name, sz in sizes.items():
        icon_img = draw_icon(sz)
        icon_img.save(TAURI_ICONS_DIR / name, "PNG")

    # .ico multi-resolução para Windows
    ico_img = draw_icon(256)
    ico_img.save(
        TAURI_ICONS_DIR / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    ico_img.save(PUBLIC_DIR / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])

    print("[✓] Todos os ícones binários PWA e Tauri v2 (.ico e .png) foram gerados com sucesso!")


if __name__ == "__main__":
    main()
