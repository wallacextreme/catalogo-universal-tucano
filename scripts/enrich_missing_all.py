#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/enrich_missing_all.py
Enriquecimento completo de imagens para os produtos sem foto:
Passo 1: Varredura detalhada no https://www.universalautomotive.com.br/ (VTEX API com SKU pontuado e termos).
Passo 2: Varredura automatizada no https://mercadocar.com.br/ via Microsoft Playwright.
Conversão para WebP de estúdio (quality=96, fundo branco puro, 100% lowercase).
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image
from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from webp_studio_converter import convert_bytes_to_studio_webp, audit_webp_image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = PROJECT_ROOT / "src" / "data" / "catalog-master-seed.json"
CACHE_PATH = PROJECT_ROOT / "scripts" / ".playwright_scrape_cache.json"
IMAGES_DIR = PROJECT_ROOT / "public" / "catalog-images" / "universal"

IMAGES_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def download_bytes_simple(url: str, timeout: int = 15) -> Optional[bytes]:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read()
    except Exception as e:
        return None
    return None


def convert_and_save_images(sku: str, image_urls: List[str]) -> List[str]:
    saved_urls = []
    sku_lower = sku.lower()

    for idx, img_url in enumerate(image_urls):
        raw_bytes = download_bytes_simple(img_url)
        if not raw_bytes:
            continue

        target_name = f"{sku_lower}.webp" if idx == 0 else f"{sku_lower}_{idx + 1}.webp"
        target_path = IMAGES_DIR / target_name

        res = convert_bytes_to_studio_webp(
            raw_bytes,
            target_path,
            max_dimension=1600,
            quality=96,
            clean_corners=True,
            padding=16,
        )

        if res.success and res.audit_passed:
            saved_urls.append(f"/catalog-images/universal/{target_name}")

    return saved_urls


# ==============================================================================
# PASSO 1: UNIVERSAL AUTOMOTIVE (VTEX)
# ==============================================================================
def search_universal_vtex(sku: str) -> Optional[Dict[str, Any]]:
    queries = []
    if len(sku) == 5 and sku.isdigit():
        queries.append(f"{sku[:2]}.{sku[2:]}")  # Ex: 20.758
    queries.append(sku)

    for q in queries:
        url = f"https://www.universalautomotive.com.br/api/catalog_system/pub/products/search?ft={q}"
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if isinstance(data, list) and len(data) > 0:
                    for item in data:
                        p_name = item.get("productName", "")
                        ref = str(item.get("productReference", "")).strip()
                        ref_code = str(item.get("productReferenceCode", "")).strip()
                        link_text = item.get("linkText", "")
                        if (
                            sku in ref
                            or sku in ref_code
                            or f"_{sku}" in link_text
                            or q in p_name
                            or sku in p_name
                        ):
                            return item
                    # Se não houve match exato na lista, mas a query era pontuada específica
                    if q != sku and len(data) == 1:
                        return data[0]
        except Exception:
            pass
    return None


def run_phase1_universal(
    missing_products: List[Dict[str, Any]],
    cache: Dict[str, Any],
) -> Tuple[int, int]:
    print("\n" + "=" * 70, flush=True)
    print("INICIANDO FASE 1: BUSCA REFINADA NA UNIVERSAL AUTOMOTIVE", flush=True)
    print("=" * 70, flush=True)

    found_universal = 0
    images_converted = 0

    for idx, prod in enumerate(missing_products):
        sku = prod["sku"]
        item = search_universal_vtex(sku)

        if item:
            name = item.get("productName", "")
            img_urls = []
            for sk in item.get("items", []):
                for im in sk.get("images", []):
                    i_url = im.get("imageUrl", "")
                    if i_url:
                        # Full size clean VTEX URL
                        clean_url = re.sub(r"-\d+-\d+(\?|$)", r"\1", i_url)
                        if clean_url not in img_urls:
                            img_urls.append(clean_url)

            if img_urls:
                saved = convert_and_save_images(sku, img_urls)
                if saved:
                    found_universal += 1
                    images_converted += len(saved)
                    prod["staticImageUrls"] = saved
                    cache[sku] = {
                        "searched": True,
                        "found": True,
                        "source": "universalautomotive.com.br",
                        "productName": name,
                        "images": saved,
                    }
                    print(
                        f"  [UNIVERSAL] SKU {sku}: {name[:60]}... -> {len(saved)} foto(s) WebP",
                        flush=True,
                    )

    print(
        f"\nFase 1 Concluída: {found_universal} produtos encontrados na Universal Automotive ({images_converted} fotos geradas).",
        flush=True,
    )
    return found_universal, images_converted


# ==============================================================================
# PASSO 2: MERCADOCAR (PLAYWRIGHT)
# ==============================================================================
async def search_mercadocar_playwright(
    page: Page,
    sku: str,
    desc: str,
) -> Optional[List[str]]:
    """
    Pesquisa no MercadoCar via busca web:
    Tenta 'universal {sku}' e '{sku}'
    """
    for query in [f"universal {sku}", sku]:
        search_url = f"https://mercadocar.com.br/search?q={query}"
        try:
            await page.goto(search_url, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(1500)

            results = await page.evaluate(
                """() => {
                const items = document.querySelectorAll('.product-item, .item-box');
                const out = [];
                for (const item of items) {
                    const link = item.querySelector('a.picture-link, .product-title a, a');
                    const img = item.querySelector('img');
                    const title = item.querySelector('.product-title a, h2 a, a');
                    if (link && img) {
                        out.push({
                            title: title ? title.textContent.trim() : '',
                            href: link.href || '',
                            imgSrc: img.src || img.getAttribute('data-src') || '',
                            dataFull: link.getAttribute('data-full-image-url') || img.getAttribute('data-full-image-url') || ''
                        });
                    }
                }
                return out;
            }"""
            )

            # Procura match que contenha o SKU no link ou título
            matching_items = []
            for r in results:
                href = r["href"].lower()
                title = r["title"].lower()
                sku_l = sku.lower()
                if sku_l in href or sku_l in title:
                    # Preferência se tiver 'universal'
                    matching_items.append(r)

            if matching_items:
                # Ordena os que têm 'universal' no topo
                matching_items.sort(
                    key=lambda x: (
                        1
                        if "universal" in x["href"].lower()
                        or "universal" in x["title"].lower()
                        else 0
                    ),
                    reverse=True,
                )
                best = matching_items[0]

                # Se já temos o dataFull ou imgSrc
                img_url = best["dataFull"] or best["imgSrc"]
                if img_url:
                    # Converte URL thumbnail de azure blob para imagem original (remove _360, _450)
                    full_img_url = re.sub(
                        r"_\d+\.(jpe?g|png|webp)", r".\1", img_url
                    )

                    # Navega até a página do produto para ver se há mais ângulos
                    gallery_urls = [full_img_url]
                    try:
                        await page.goto(
                            best["href"],
                            wait_until="domcontentloaded",
                            timeout=15000,
                        )
                        page_imgs = await page.evaluate(
                            """() => {
                            const imgs = [];
                            // Fotos adicionais na galeria do cloudzoom
                            const galleryLinks = document.querySelectorAll('.picture-gallery a, .picture a, .gallery-wrap a');
                            for (const a of galleryLinks) {
                                const u = a.getAttribute('data-full-image-url') || a.href;
                                if (u && u.includes('stgecomm.blob') && !imgs.includes(u)) {
                                    imgs.push(u);
                                }
                            }
                            return imgs;
                        }"""
                        )
                        for u in page_imgs:
                            clean_u = re.sub(
                                r"_\d+\.(jpe?g|png|webp)", r".\1", u
                            )
                            if clean_u not in gallery_urls:
                                gallery_urls.append(clean_u)
                    except Exception:
                        pass

                    return gallery_urls
        except Exception as e:
            pass
    return None


async def run_phase2_mercadocar(
    remaining_products: List[Dict[str, Any]],
    cache: Dict[str, Any],
) -> Tuple[int, int]:
    print("\n" + "=" * 70, flush=True)
    print(
        f"INICIANDO FASE 2: BUSCA NO MERCADOCAR COM PLAYWRIGHT ({len(remaining_products)} ITENS)",
        flush=True,
    )
    print("=" * 70, flush=True)

    found_mc = 0
    images_converted = 0

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=HEADERS["User-Agent"])
        page = await context.new_page()

        for idx, prod in enumerate(remaining_products):
            sku = prod["sku"]
            desc = prod.get("description", "")

            # Pula se já encontrou na fase 1
            if cache.get(sku, {}).get("found", False):
                continue

            print(
                f"[{idx + 1}/{len(remaining_products)}] Buscando MercadoCar: SKU {sku} - {desc[:40]}...",
                flush=True,
            )
            img_urls = await search_mercadocar_playwright(page, sku, desc)

            if img_urls:
                saved = convert_and_save_images(sku, img_urls)
                if saved:
                    found_mc += 1
                    images_converted += len(saved)
                    prod["staticImageUrls"] = saved
                    cache[sku] = {
                        "searched": True,
                        "found": True,
                        "source": "mercadocar.com.br",
                        "productName": desc,
                        "images": saved,
                    }
                    print(
                        f"  --> [MERCADOCAR SUCESSO] SKU {sku}: {len(saved)} foto(s) WebP salvas!",
                        flush=True,
                    )
            else:
                print(f"  --> [MERCADOCAR NÃO ENCONTRADO] SKU {sku}", flush=True)

            # Salva progresso incremental a cada 5 itens
            if (idx + 1) % 5 == 0:
                with open(SEED_PATH, "w", encoding="utf-8") as f:
                    json.dump(seed, f, ensure_ascii=False, indent=2)
                with open(CACHE_PATH, "w", encoding="utf-8") as f:
                    json.dump(cache, f, ensure_ascii=False, indent=2)

        await browser.close()

    return found_mc, images_converted


# ==============================================================================
# EXECUÇÃO PRINCIPAL
# ==============================================================================
async def main():
    global seed, cache
    seed = json.load(open(SEED_PATH, encoding="utf-8"))
    cache = json.load(open(CACHE_PATH, encoding="utf-8"))

    # Produtos que atualmente não possuem foto de estúdio real
    # (ou seja, marcados como not found no cache)
    missing_products = [
        p for p in seed if not cache.get(p["sku"], {}).get("found", False)
    ]
    print(f"Total de produtos sem foto de estúdio: {len(missing_products)}")

    # 1. Executa Fase 1 na Universal Automotive
    f1_found, f1_imgs = run_phase1_universal(missing_products, cache)

    # Atualiza lista de restantes
    remaining = [
        p for p in seed if not cache.get(p["sku"], {}).get("found", False)
    ]
    print(f"\nProdutos restantes para MercadoCar: {len(remaining)}")

    # 2. Executa Fase 2 no MercadoCar
    f2_found, f2_imgs = await run_phase2_mercadocar(remaining, cache)

    # 3. Salva arquivos finais
    with open(SEED_PATH, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=2)

    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 70)
    print("RELATÓRIO FINAL DE ENRIQUECIMENTO DE IMAGENS:")
    print(f"- Fotos recuperadas na Universal Automotive: {f1_found} produtos ({f1_imgs} imagens)")
    print(f"- Fotos recuperadas no MercadoCar: {f2_found} produtos ({f2_imgs} imagens)")
    total_found = f1_found + f2_found
    print(f"- TOTAL GERAL DE PRODUTOS CORRIGIDOS COM FOTOS: {total_found}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
