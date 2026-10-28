#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/webp_studio_converter.py
Motor Industrial de Conversão Automática para .WebP Sem Perda Visual (Studio Grade).
- Composição de canal Alpha/SMask sobre fundo branco puro (#FFFFFF).
- Limpeza opcional de bordas/fundos de tabela via Floodfill nos 4 cantos.
- Recorte inteligente (Smart Trim) com margem protetora de 16px mantendo 100% do Aspect Ratio.
- Redimensionamento LANCZOS (até 1600px) sem jamais ampliar artificialmente imagens menores.
- Codificação WebP Near-Lossless (quality=96, method=6) ou Lossless puro (lossless=True).
- Auditoria automática de integridade de pixels (Zero fundo preto / Cantos #FFFFFF).
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageOps


@dataclass
class WebpConversionResult:
    success: bool
    output_path: Optional[Path]
    width: int
    height: int
    size_bytes: int
    sha256_hex: str
    audit_passed: bool
    audit_message: str


def _ensure_rgb_white_background(
    img: Image.Image,
    smask_img: Optional[Image.Image] = None,
) -> Image.Image:
    """
    Converte qualquer modo (RGBA, LA, P, CMYK) para RGB compondo transparências
    sobre fundo branco puro (#FFFFFF).
    """
    # Se veio uma máscara SMask separada do PDF (XREF)
    if smask_img is not None:
        base_rgb = img.convert("RGB")
        mask_l = smask_img.convert("L")
        if mask_l.size != base_rgb.size:
            mask_l = mask_l.resize(base_rgb.size, Image.Resampling.LANCZOS)
        white_bg = Image.new("RGB", base_rgb.size, (255, 255, 255))
        white_bg.paste(base_rgb, mask=mask_l)
        return white_bg

    # Se a imagem possui paleta com transparência ou canal Alpha nativo
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        white_bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        composed = Image.alpha_composite(white_bg, rgba)
        return composed.convert("RGB")

    # Se estiver em CMYK (comum em gráficas de catálogos PDF)
    if img.mode == "CMYK":
        return img.convert("RGB")

    return img.convert("RGB")


def _clean_corner_background_to_white(
    img: Image.Image,
    tolerance: int = 24,
) -> Image.Image:
    """
    Amostra os 4 cantos da imagem. Se houver fundo colorido de tabela ou cinza de estúdio,
    aplica floodfill suave nos 4 cantos convertendo para branco puro (#FFFFFF).
    """
    rgb = img.copy()
    w, h = rgb.size
    if w < 10 or h < 10:
        return rgb

    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    for cx, cy in corners:
        pixel = rgb.getpixel((cx, cy))
        if isinstance(pixel, tuple) and len(pixel) >= 3:
            r, g, b = pixel[0], pixel[1], pixel[2]
            # Se não for branco puro e também não for um pixel escuro da própria peça
            is_already_white = r >= 250 and g >= 250 and b >= 250
            is_dark_object = r < 60 and g < 60 and b < 60
            if not is_already_white and not is_dark_object:
                ImageDraw.floodfill(
                    rgb,
                    xy=(cx, cy),
                    value=(255, 255, 255),
                    thresh=tolerance,
                )
    return rgb


def _smart_trim_with_padding(
    img: Image.Image,
    padding: int = 16,
    white_threshold: int = 248,
) -> Image.Image:
    """
    Remove sobras brancas excessivas ao redor da peça e adiciona um padding protetor
    uniforme (16px), preservando 100% da proporção original da peça sem cortar bicos.
    """
    gray = img.convert("L")
    # Inverte onde tudo que é quase branco (>= white_threshold) vira 0 (preto)
    lut = [0 if i >= white_threshold else 255 for i in range(256)]
    mask = gray.point(lut)
    bbox = mask.getbbox()

    if not bbox:
        return img

    cropped = img.crop(bbox)
    if padding > 0:
        return ImageOps.expand(cropped, border=padding, fill=(255, 255, 255))
    return cropped


def audit_webp_image(webp_path: Path) -> Tuple[bool, str]:
    """
    Gate Automático de Qualidade de Pixels:
    1. Arquivo existe e possui tamanho > 512 bytes.
    2. Dimensões válidas (>= 45x45px).
    3. Verifica se a imagem não ficou com fundo preto (falha de SMask) ou totalmente vazia.
    """
    if not webp_path.exists():
        return False, "Arquivo não existe no disco."

    size_bytes = webp_path.stat().st_size
    if size_bytes < 512:
        return False, f"Arquivo muito pequeno ({size_bytes} bytes)."

    try:
        with Image.open(webp_path) as im:
            rgb = im.convert("RGB")
            w, h = rgb.size
            if w < 45 or h < 45:
                return False, f"Dimensões insuficientes ({w}x{h}px)."

            # Verifica os 4 cantos para garantir que não há fundo preto de SMask quebrada
            corners = [
                rgb.getpixel((0, 0)),
                rgb.getpixel((w - 1, 0)),
                rgb.getpixel((0, h - 1)),
                rgb.getpixel((w - 1, h - 1)),
            ]
            black_corners = sum(
                1 for (r, g, b) in corners if r < 15 and g < 15 and b < 15
            )
            if black_corners >= 3:
                return False, "Fundo preto detectado nos cantos (possível falha de SMask)."

            # Verifica se a imagem não é 100% branca vazia
            extrema = rgb.convert("L").getextrema()
            if extrema and extrema[0] >= 250:
                return False, "Imagem completamente branca/vazia."

            return True, f"OK ({w}x{h}px, {size_bytes} bytes)"
    except Exception as exc:
        return False, f"Erro ao abrir WebP na auditoria: {exc}"


def convert_bytes_to_studio_webp(
    raw_image_bytes: bytes,
    output_path: Path,
    smask_bytes: Optional[bytes] = None,
    max_dimension: int = 1600,
    padding: int = 16,
    clean_corners: bool = True,
    use_lossless: bool = False,
    quality: int = 96,
) -> WebpConversionResult:
    """
    Converte bytes brutos de imagem (vindos de XREF do PDF ou do Playwright Web)
    em um arquivo .webp de altíssima fidelidade sem perda visual.
    """
    try:
        img = Image.open(io.BytesIO(raw_image_bytes))
        img.load()

        smask_img: Optional[Image.Image] = None
        if smask_bytes is not None:
            smask_img = Image.open(io.BytesIO(smask_bytes))
            smask_img.load()

        # 1. Compor sobre fundo branco puro (#FFFFFF)
        rgb = _ensure_rgb_white_background(img, smask_img)

        # 2. Limpar fundos de tabela nos cantos (se habilitado)
        if clean_corners:
            rgb = _clean_corner_background_to_white(rgb, tolerance=24)

        # 3. Smart Trim preservando 100% do Aspect Ratio + Padding protetor de 16px
        rgb = _smart_trim_with_padding(rgb, padding=padding)

        # 4. Redimensionar com LANCZOS apenas se ultrapassar max_dimension (jamais esticar!)
        w, h = rgb.size
        if max(w, h) > max_dimension:
            scale = max_dimension / float(max(w, h))
            new_w = max(1, int(round(w * scale)))
            new_h = max(1, int(round(h * scale)))
            rgb = rgb.resize((new_w, new_h), Image.Resampling.LANCZOS)
            w, h = rgb.size

        # 5. Codificar em WebP Sem Perda Visual
        output_path.parent.mkdir(parents=True, exist_ok=True)
        webp_buffer = io.BytesIO()

        if use_lossless:
            rgb.save(webp_buffer, format="WEBP", lossless=True, quality=100, method=6)
        else:
            # Near-Lossless Studio Mode: preserva detalhes finos de roscas/bicos em 400% zoom
            rgb.save(
                webp_buffer,
                format="WEBP",
                quality=quality,
                method=6,
                exact=True,
            )

        webp_bytes = webp_buffer.getvalue()
        sha256_hex = hashlib.sha256(webp_bytes).hexdigest().upper()
        output_path.write_bytes(webp_bytes)

        # 6. Auditar qualidade de pixels do arquivo salvo
        passed, msg = audit_webp_image(output_path)

        return WebpConversionResult(
            success=passed,
            output_path=output_path if passed else None,
            width=w,
            height=h,
            size_bytes=len(webp_bytes),
            sha256_hex=sha256_hex,
            audit_passed=passed,
            audit_message=msg,
        )
    except Exception as exc:
        return WebpConversionResult(
            success=False,
            output_path=None,
            width=0,
            height=0,
            size_bytes=0,
            sha256_hex="",
            audit_passed=False,
            audit_message=f"Falha na conversão WebP: {exc}",
        )