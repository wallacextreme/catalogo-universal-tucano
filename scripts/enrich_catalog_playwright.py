#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/enrich_catalog_playwright.py
Super-Enriquecimento Web Multi-Ângulos via Microsoft Playwright.
- Concorrência controlada: asyncio.Semaphore(4).
- Cache incremental: scripts/.playwright_scrape_cache.json para retomada instantânea.
- Busca automatizada no catálogo oficial Universal Automotive (https://www.universalautomotive.com.br/).
- Extração de descrições oficiais ricas, aplicações veiculares, montadoras, anos e especificações técnicas.
- Extração e download de fotos originais de estúdio em múltiplos ângulos (Capa, _2, _3, etc.).
- Conversão via webp_studio_converter.py com 100% dos nomes em estrito lowercase.
- Fallback defensivo automático: nenhuma peça fica sem imagem.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.stdout.reconfigure(encoding="utf-8")

from playwright.async_api import APIRequestContext, async_playwright
from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    from webp_studio_converter import convert_bytes_to_studio_webp, audit_webp_image
except ImportError:
    from scripts.webp_studio_converter import convert_bytes_to_studio_webp, audit_webp_image

RAW_INPUT_JSON = SCRIPT_DIR / "raw_extracted_products.json"
CACHE_FILE_PATH = SCRIPT_DIR / ".playwright_scrape_cache.json"
MASTER_SEED_JSON = PROJECT_ROOT / "src" / "data" / "catalog-master-seed.json"
PUBLIC_IMAGES_DIR = PROJECT_ROOT / "public" / "catalog-images" / "universal"

CONCURRENCY_LIMIT = 4
MAX_RETRIES = 2
SEARCH_API_BASE = "https://www.universalautomotive.com.br/api/catalog_system/pub/products/search?ft="


def normalize_sku_lower(code: str) -> str:
    """Normaliza o código para minúsculas estrito alfanumérico (compatível Linux/Firebase)."""
    return re.sub(r"[^a-z0-9]", "", code.lower())


def load_cache() -> Dict[str, Any]:
    if CACHE_FILE_PATH.exists():
        try:
            return json.loads(CACHE_FILE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache: Dict[str, Any]) -> None:
    CACHE_FILE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def generate_technical_fallback_webp(
    sku: str,
    desc: str,
    brand: str,
    shelf: str,
    out_path: Path,
) -> bool:
    """
    Fallback Defensivo Obrigatório:
    Gera uma imagem técnica limpa com fundo branco puro (#FFFFFF),
    tipografia legível e moldura suave caso a foto não exista no catálogo online.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (800, 800), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Moldura industrial de balcão
    draw.rounded_rectangle([(40, 40), (760, 760)], radius=32, outline=(226, 232, 240), width=4)
    draw.rounded_rectangle([(60, 60), (740, 740)], radius=24, outline=(241, 245, 249), width=2)

    # Header da marca
    draw.text((400, 160), brand.upper(), fill=(29, 78, 216), anchor="mm")
    
    # SKU em destaque
    draw.text((400, 260), f"CÓDIGO: {sku.upper()}", fill=(15, 23, 42), anchor="mm")

    # Localização na loja
    if shelf:
        draw.text((400, 340), f"LOCALIZAÇÃO: CAIXA / PRAT. {shelf}", fill=(71, 85, 105), anchor="mm")

    # Descrição resumida em 2 linhas
    words = desc.split()
    line1 = " ".join(words[:5])
    line2 = " ".join(words[5:10])
    draw.text((400, 440), line1, fill=(51, 65, 85), anchor="mm")
    if line2:
        draw.text((400, 480), line2, fill=(51, 65, 85), anchor="mm")

    # Rodapé técnico
    draw.text((400, 640), "AUTO PEÇAS TUCANO — CATÁLOGO OFICIAL", fill=(148, 163, 184), anchor="mm")

    img.save(out_path, format="WEBP", quality=96, method=6)
    passed, _ = audit_webp_image(out_path)
    return passed


async def fetch_product_vtex(
    api_context: APIRequestContext,
    sku: str,
    semaphore: asyncio.Semaphore,
) -> Optional[Dict[str, Any]]:
    """Consulta a API oficial VTEX do catálogo Universal Automotive."""
    async with semaphore:
        url = f"{SEARCH_API_BASE}{sku}"
        for attempt in range(MAX_RETRIES):
            try:
                resp = await api_context.get(url, timeout=12000)
                if resp.status == 200:
                    data = await resp.json()
                    if isinstance(data, list) and len(data) > 0:
                        # Procura o item com referência exata ao SKU
                        for prod in data:
                            ref = str(prod.get("productReference", "")).strip()
                            ref_code = str(prod.get("productReferenceCode", "")).strip()
                            p_name = str(prod.get("productName", ""))
                            if ref == sku or ref_code == sku or f"_{sku}" in prod.get("linkText", "") or sku in p_name:
                                return prod
                        # Se nenhum tiver o SKU exato na ref, usa o primeiro match relevante
                        return data[0]
                    return None
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    return None
                await asyncio.sleep(0.5)
    return None


async def download_image_bytes(
    api_context: APIRequestContext,
    img_url: str,
    semaphore: asyncio.Semaphore,
) -> Optional[bytes]:
    """Baixa os bytes originais de uma imagem de estúdio em alta resolução."""
    async with semaphore:
        # Se for URL VTEX, ajusta para tamanho completo de alta definição
        clean_url = re.sub(r"-\d+-\d+(\?|$)", r"\1", img_url)
        try:
            resp = await api_context.get(clean_url, timeout=15000)
            if resp.status == 200:
                return await resp.body()
        except Exception:
            pass
        # Fallback para a URL original com os parâmetros
        try:
            resp = await api_context.get(img_url, timeout=15000)
            if resp.status == 200:
                return await resp.body()
        except Exception:
            return None
    return None


async def process_single_product(
    product: Dict[str, Any],
    api_context: APIRequestContext,
    semaphore: asyncio.Semaphore,
    cache: Dict[str, Any],
    stats: Dict[str, int],
) -> Dict[str, Any]:
    sku = product["sku"]
    sku_norm_lower = normalize_sku_lower(sku)
    is_universal = product.get("isUniversal", False)

    cached_entry = cache.get(sku)
    web_data: Optional[Dict[str, Any]] = None

    if cached_entry:
        web_data = cached_entry.get("web_data")
        stats["cache_hits"] += 1
    elif is_universal:
        web_data = await fetch_product_vtex(api_context, sku, semaphore)
        cache[sku] = {
            "searched": True,
            "found": web_data is not None,
            "web_data": web_data,
        }
        if web_data:
            stats["web_found"] += 1
        else:
            stats["web_not_found"] += 1

    # Atualiza dados com informações da web (se encontradas)
    official_desc = product["description"]
    all_images_urls: List[str] = []
    models_found: List[str] = []
    years_found: List[str] = []
    montadoras_found: List[str] = list(product.get("automakers", []))
    oem_codes: List[str] = list(product.get("oemCodes", []))
    tech_specs: Dict[str, Any] = dict(product.get("technicalSpecs", {}))

    if web_data:
        # 1. Descrição oficial rica do site da Universal
        p_name = web_data.get("productName", "")
        p_desc = web_data.get("description", "")
        if p_name and len(p_name) > len(official_desc):
            official_desc = p_name
        elif p_desc and len(p_desc) > len(official_desc):
            official_desc = p_desc

        # 2. Montadoras e Modelos
        if "Montadora" in web_data and isinstance(web_data["Montadora"], list):
            for m in web_data["Montadora"]:
                if m.upper() not in ["USO GERAL", "UNIVERSAL"] and m not in montadoras_found:
                    montadoras_found.append(m)

        if "Modelo" in web_data and isinstance(web_data["Modelo"], list):
            models_found = [str(m).strip() for m in web_data["Modelo"] if str(m).strip()]

        if "Ano" in web_data and isinstance(web_data["Ano"], list):
            years_found = [str(y).strip() for y in web_data["Ano"] if str(y).strip()]

        # 3. Extrai imagens de estúdio
        items = web_data.get("items", [])
        for it in items:
            images = it.get("images", [])
            for im in images:
                u = im.get("imageUrl")
                if u and u not in all_images_urls:
                    all_images_urls.append(u)

        # 4. Códigos originais e especificações
        for key in ["Original", "Especificações Técnicas", "Características Técnicas"]:
            if key in web_data and web_data[key]:
                tech_specs[key] = web_data[key]

    # Processamento de Imagens para WebP (Multi-Ângulos)
    static_image_urls: List[str] = []
    if all_images_urls:
        for idx, img_url in enumerate(all_images_urls):
            suffix = "" if idx == 0 else f"_{idx + 1}"
            file_name = f"{sku_norm_lower}{suffix}.webp"
            target_path = PUBLIC_IMAGES_DIR / file_name
            web_rel_path = f"/catalog-images/universal/{file_name}"

            # Se o arquivo já existe e foi validado
            if target_path.exists():
                is_valid, _ = audit_webp_image(target_path)
                if is_valid:
                    static_image_urls.append(web_rel_path)
                    continue

            # Baixa e converte a imagem
            raw_bytes = await download_image_bytes(api_context, img_url, semaphore)
            if raw_bytes:
                conv_res = convert_bytes_to_studio_webp(
                    raw_image_bytes=raw_bytes,
                    output_path=target_path,
                    quality=96,
                    clean_corners=True,
                    padding=16,
                )
                if conv_res.success:
                    static_image_urls.append(web_rel_path)
                    stats["images_converted"] += 1
                else:
                    print(f"  [!] Falha na conversão WebP para {file_name}: {conv_res.audit_message}")

    # Fallback Defensivo Obrigatório: Nenhuma peça fica sem imagem!
    if not static_image_urls:
        fallback_file = f"{sku_norm_lower}.webp"
        fallback_path = PUBLIC_IMAGES_DIR / fallback_file
        web_rel_fallback = f"/catalog-images/universal/{fallback_file}"

        if not fallback_path.exists() or not audit_webp_image(fallback_path)[0]:
            generate_technical_fallback_webp(
                sku=sku,
                desc=official_desc,
                brand=product["brand"],
                shelf=product.get("shelfLocation", ""),
                out_path=fallback_path,
            )
            stats["fallbacks_generated"] += 1

        static_image_urls.append(web_rel_fallback)

    # Formata anos estruturados
    year_ranges = list(product.get("yearRanges", []))
    if years_found and not year_ranges:
        try:
            valid_years = [int(y) for y in years_found if y.isdigit()]
            if valid_years:
                year_ranges.append({
                    "yearStart": min(valid_years),
                    "yearEnd": max(valid_years),
                    "isOngoing": False,
                })
        except Exception:
            pass

    return {
        **product,
        "description": official_desc,
        "automakers": montadoras_found if montadoras_found else ["Universal"],
        "models": models_found,
        "yearRanges": year_ranges,
        "oemCodes": oem_codes,
        "technicalSpecs": tech_specs,
        "staticImageUrls": static_image_urls,
    }


async def main():
    print("=" * 80)
    print("PASSO 3 — SUPER-ENRIQUECIMENTO WEB MULTI-ÂNGULOS VIA PLAYWRIGHT")
    print("=" * 80)

    if not RAW_INPUT_JSON.exists():
        print(f"[!] Arquivo de produtos brutos não encontrado em: {RAW_INPUT_JSON}")
        sys.exit(1)

    raw_products: List[Dict[str, Any]] = json.loads(RAW_INPUT_JSON.read_text(encoding="utf-8"))
    print(f"[*] Carregados {len(raw_products)} produtos brutos para enriquecimento.")

    cache = load_cache()
    print(f"[*] Itens no cache local: {len(cache)}")

    PUBLIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)

    stats = {
        "cache_hits": 0,
        "web_found": 0,
        "web_not_found": 0,
        "images_converted": 0,
        "fallbacks_generated": 0,
    }

    async with async_playwright() as p:
        # Cria contexto de API Playwright com headers padrão de browser
        api_context = await p.request.new_context(
            extra_http_headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            }
        )

        tasks = []
        for prod in raw_products:
            tasks.append(
                process_single_product(
                    product=prod,
                    api_context=api_context,
                    semaphore=semaphore,
                    cache=cache,
                    stats=stats,
                )
            )

        print(f"[*] Iniciando enriquecimento assíncrono com semáforo={CONCURRENCY_LIMIT}...")
        enriched_products = await asyncio.gather(*tasks)

        # Salva o cache atualizado
        save_cache(cache)
        await api_context.dispose()

    # Salva o arquivo Master Seed Oficial em src/data/catalog-master-seed.json
    MASTER_SEED_JSON.parent.mkdir(parents=True, exist_ok=True)
    MASTER_SEED_JSON.write_text(
        json.dumps(enriched_products, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\n" + "=" * 80)
    print("RELATÓRIO DO ENRIQUECIMENTO E CONVERSÃO WEBP")
    print("=" * 80)
    print(f"[*] Total de produtos processados: {len(enriched_products)}")
    print(f"[*] Produtos encontrados na web: {stats['web_found']}")
    print(f"[*] Produtos de cache reaproveitados: {stats['cache_hits']}")
    print(f"[*] Novas imagens WebP convertidas (multi-ângulos): {stats['images_converted']}")
    print(f"[*] Imagens técnicas de fallback geradas: {stats['fallbacks_generated']}")
    
    # Validação dos arquivos WebP gerados em public/catalog-images/universal
    generated_webp_files = list(PUBLIC_IMAGES_DIR.glob("*.webp"))
    print(f"[*] Total de arquivos .webp na pasta public/catalog-images/universal/: {len(generated_webp_files)}")
    print(f"[✓] Catálogo Master Seed gerado com sucesso em: {MASTER_SEED_JSON}")


if __name__ == "__main__":
    asyncio.run(main())
