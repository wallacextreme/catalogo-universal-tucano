#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/enrich_catalog_playwright.py
Motor Universal Multi-Marca de Enriquecimento de Catálogos via Microsoft Playwright.

Funciona para QUALQUER catálogo eletrônico e qualquer fabricante:
1. Auto-detecta marcas, produtos e URLs de catálogos web a partir dos JSONs em `src/data/`,
   do arquivo opcional `scripts/catalog_sources.json` ou de argumentos de linha de comando.
2. Executa 3 estratégias em cascata para localizar cada peça no site do fabricante:
   - Estratégia A: URL direta por padrão de rota (template `{slug}` / `{sku}`).
   - Estratégia B: URL de pesquisa direta (`?s={sku}`, `?q={sku}`, `?busca={sku}`).
   - Estratégia C: Automação visual da barra de busca via Playwright Locators + clique no card.
3. Extrai todas as fotos de estúdio em resolução máxima (JSON-LD, OpenGraph, Zoom Attributes,
   Srcset e galerias de carrossel) para alimentar a galeria multi-ângulos.
4. Processa cada foto via `webp_studio_converter.py` (WebP Sem Perda Visual, fundo #FFFFFF,
   LANCZOS e auditoria de pixels) com nomes 100% lowercase (compatível com Linux/Firebase).
5. Preserva a foto extraída do PDF (XREF) como Fallback Defensivo se a peça não existir na web.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote_plus, urljoin, urlparse

from playwright.async_api import BrowserContext, Page, async_playwright

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from webp_studio_converter import convert_bytes_to_studio_webp

DATA_DIR = PROJECT_ROOT / "src" / "data"
PUBLIC_IMAGES_ROOT = PROJECT_ROOT / "public" / "catalog-images"
SOURCES_CONFIG_PATH = SCRIPT_DIR / "catalog_sources.json"
CACHE_FILE_PATH = SCRIPT_DIR / ".playwright_scrape_cache.json"
SW_FILE_PATH = PROJECT_ROOT / "public" / "sw.js"


# ============================================================================
# UTILITÁRIOS DE NORMALIZAÇÃO (100% LOWERCASE PARA LINUX / FIREBASE HOSTING)
# ============================================================================

def normalize_slug_lower(text: str) -> str:
    """Converte 'Tampas Click' -> 'click' ou 'G-1001' -> 'g-1001'."""
    cleaned = text.strip().lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned)
    return cleaned.strip("-")


def normalize_sku_strict_lower(raw_code: str) -> str:
    """Converte 'G-1001' -> 'g1001' ou 'TC-3060-A' -> 'tc3060a'."""
    return re.sub(r"[^a-zA-Z0-9]", "", raw_code).lower()


def normalize_brand_folder(brand_name: str) -> str:
    """Define o nome da pasta da marca em public/catalog-images/{brand_folder}/."""
    b = brand_name.strip().lower()
    if "click" in b or "plasticomp" in b:
        return "click"
    if "gonel" in b:
        return "gonel"
    return normalize_slug_lower(b) or "geral"


def load_scrape_cache() -> Dict[str, List[str]]:
    if CACHE_FILE_PATH.exists():
        try:
            return json.loads(CACHE_FILE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_scrape_cache(cache: Dict[str, List[str]]) -> None:
    CACHE_FILE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def is_valid_product_image_url(url: str) -> bool:
    """Filtra ícones, logos, bandeiras de idioma, selos ISO e placeholders."""
    lower = url.lower()
    if lower.startswith("data:") or lower.endswith(".svg") or lower.endswith(".gif"):
        return False
    blacklist = (
        "logo",
        "icon",
        "favicon",
        "sprite",
        "banner",
        "header",
        "footer",
        "iso9001",
        "iso-9001",
        "iatf",
        "whatsapp",
        "facebook",
        "instagram",
        "youtube",
        "linkedin",
        "placeholder",
        "sem-foto",
        "no-image",
        "default",
        "flag",
        "avatar",
        "loading",
        "spinner",
    )
    return not any(term in lower for term in blacklist)


def promote_thumbnail_url_to_fullsize(url: str) -> List[str]:
    """
    Remove sufixos comuns de miniaturas de CDNs/WordPress/VTEX/Magento
    (ex.: foto-300x300.jpg -> foto.jpg) retornando [url_alta_res, url_original].
    """
    candidates: List[str] = []
    # Padrão WordPress / WooCommerce: -150x150.jpg, -300x300.png, -600x600.webp
    wp_full = re.sub(r"-\d{2,4}x\d{2,4}(\.[a-zA-Z]{3,4})(\?.*)?$", r"\1\2", url)
    if wp_full != url:
        candidates.append(wp_full)

    # Padrão query string de redimensionamento (?width=200, ?w=300)
    qs_clean = re.sub(r"([?&])(w|width|h|height|size)=\d+(&|$)", r"\1", url)
    qs_clean = qs_clean.rstrip("?&")
    if qs_clean != url and qs_clean not in candidates:
        candidates.append(qs_clean)

    if url not in candidates:
        candidates.append(url)
    return candidates


# ============================================================================
# DESCOBERTA AUTOMÁTICA DE CONFIGURAÇÃO DE CATÁLOGOS WEB POR MARCA
# ============================================================================

def discover_brand_web_configs(
    seed_data: Dict[str, Any],
    cli_brand: Optional[str],
    cli_url: Optional[str],
    cli_pattern: Optional[str],
) -> Dict[str, Dict[str, Any]]:
    """
    Monta o mapa de configuração web para cada marca presente no catálogo.
    Prioridade:
      1. Parâmetros explícitos de CLI (--brand, --url, --url-pattern)
      2. Arquivo `scripts/catalog_sources.json` (se existir)
      3. Descoberta automática de URLs no próprio JSON do catálogo
    """
    configs: Dict[str, Dict[str, Any]] = {}

    # 1. Perfis conhecidos + arquivo catalog_sources.json
    default_profiles: Dict[str, Dict[str, Any]] = {
        "gonel": {
            "baseUrl": "https://gonel.com.br",
            "directPatterns": [
                "https://gonel.com.br/catalog/{slug}",
                "https://gonel.com.br/produto/{slug}",
            ],
            "searchUrls": [
                "https://gonel.com.br/catalog?search={sku}",
                "https://gonel.com.br/?s={sku}",
            ],
            "catalogHome": "https://gonel.com.br/catalog",
        },
        "click": {
            "baseUrl": "https://www.tampasclick.com.br",
            "directPatterns": [
                "https://www.tampasclick.com.br/produto/{slug}",
                "https://www.tampasclick.com.br/produtos/{slug}",
            ],
            "searchUrls": [
                "https://www.tampasclick.com.br/?s={sku}",
                "https://www.tampasclick.com.br/produtos?busca={sku}",
            ],
            "catalogHome": "https://www.tampasclick.com.br",
        },
        "unifap": {
            "baseUrl": "https://www.unifap.com.br",
            "directPatterns": [
                "https://www.unifap.com.br/produto/{slug}",
            ],
            "searchUrls": [
                "https://www.unifap.com.br/?s={sku}",
            ],
            "catalogHome": "https://www.unifap.com.br",
        },
    }

    for k, v in default_profiles.items():
        configs[k] = v

    if SOURCES_CONFIG_PATH.exists():
        try:
            custom_sources = json.loads(SOURCES_CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(custom_sources, dict):
                for brand_key, cfg in custom_sources.items():
                    configs[normalize_brand_folder(brand_key)] = cfg
        except Exception as exc:
            print(f"[!] Aviso ao ler {SOURCES_CONFIG_PATH}: {exc}")

    # 2. Inspeciona referenceDocuments / sourceDocuments no seed em busca de URLs
    for doc in seed_data.get("referenceDocuments", []) + seed_data.get("sourceDocuments", []):
        b_name = str(doc.get("brandName", "")).strip()
        web_url = str(doc.get("websiteUrl") or doc.get("catalogUrl") or "").strip()
        if b_name and web_url:
            b_key = normalize_brand_folder(b_name)
            parsed = urlparse(web_url if "://" in web_url else f"https://{web_url}")
            base = f"{parsed.scheme}://{parsed.netloc}"
            if b_key not in configs:
                configs[b_key] = {
                    "baseUrl": base,
                    "directPatterns": [
                        f"{base}/catalog/{{slug}}",
                        f"{base}/produto/{{slug}}",
                        f"{base}/produtos/{{slug}}",
                    ],
                    "searchUrls": [
                        f"{base}/?s={{sku}}",
                        f"{base}/busca?q={{sku}}",
                        f"{base}/search?q={{sku}}",
                    ],
                    "catalogHome": web_url if "://" in web_url else base,
                }

    # 3. Sobrescrita via CLI (permite usar em qualquer marca nova na hora)
    if cli_brand and cli_url:
        b_key = normalize_brand_folder(cli_brand)
        parsed = urlparse(cli_url if "://" in cli_url else f"https://{cli_url}")
        base = f"{parsed.scheme}://{parsed.netloc}"
        patterns = (
            [cli_pattern]
            if cli_pattern
            else [
                f"{cli_url.rstrip('/')}/{{slug}}",
                f"{base}/catalog/{{slug}}",
                f"{base}/produto/{{slug}}",
                f"{base}/produtos/{{slug}}",
            ]
        )
        configs[b_key] = {
            "baseUrl": base,
            "directPatterns": patterns,
            "searchUrls": [
                f"{base}/?s={{sku}}",
                f"{base}/busca?q={{sku}}",
                f"{base}/search?q={{sku}}",
            ],
            "catalogHome": cli_url if "://" in cli_url else base,
        }

    return configs


# ============================================================================
# EXTRATOR UNIVERSAL DE IMAGENS NA PÁGINA (JSON-LD + DOM + SCORING)
# ============================================================================

async def extract_studio_images_from_current_page(
    page: Page,
    commercial_code: str,
) -> List[str]:
    """
    Inspeciona a página atual carregada no Playwright e extrai todas as URLs
    de fotos de estúdio do produto (em múltiplos ângulos quando disponíveis).
    """
    current_url = page.url
    raw_candidates: List[str] = await page.evaluate(
        """(skuCode) => {
            const results = [];
            const addUrl = (u) => {
                if (u && typeof u === 'string' && !u.startsWith('data:')) {
                    results.push(u.trim());
                }
            };

            // 1. Schema.org JSON-LD (Padrão E-commerce Universal)
            const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const s of ldScripts) {
                try {
                    const data = JSON.parse(s.textContent || '{}');
                    const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
                    for (const item of items) {
                        if (item && (item['@type'] === 'Product' || item.image)) {
                            const imgs = Array.isArray(item.image) ? item.image : [item.image];
                            for (const im of imgs) {
                                if (typeof im === 'string') addUrl(im);
                                else if (im && im.url) addUrl(im.url);
                            }
                        }
                    }
                } catch {}
            }

            // 2. Galerias de Produto, Zoom, Carrosséis (Swiper, Slick, WooCommerce, VTEX, Custom)
            const gallerySelectors = [
                '.product-gallery img',
                '.woocommerce-product-gallery img',
                '[class*="product-image"] img',
                '[class*="product-gallery"] img',
                '[class*="product_image"] img',
                '[class*="galeria"] img',
                '[class*="detalhe"] img',
                '.swiper-wrapper img',
                '.slick-track img',
                '.carousel-inner img',
                '[data-fancybox] img',
                '[data-lightbox] img',
                'main img',
                'article img'
            ];

            for (const selector of gallerySelectors) {
                const elements = document.querySelectorAll(selector);
                for (const img of elements) {
                    const rect = img.getBoundingClientRect();
                    const natW = img.naturalWidth || rect.width || 0;
                    const natH = img.naturalHeight || rect.height || 0;
                    if (natW > 0 && natW < 90 && natH > 0 && natH < 90) continue;

                    // Prioriza atributos de Zoom / Full Resolution
                    addUrl(img.getAttribute('data-large_image'));
                    addUrl(img.getAttribute('data-zoom-image'));
                    addUrl(img.getAttribute('data-zoom'));
                    addUrl(img.getAttribute('data-full'));
                    addUrl(img.getAttribute('data-high-res-src'));
                    addUrl(img.getAttribute('data-src'));

                    // Pega o maior item do srcset se existir
                    const srcset = img.getAttribute('srcset');
                    if (srcset) {
                        const parts = srcset.split(',').map(p => p.trim().split(/\\s+/)[0]);
                        if (parts.length > 0) addUrl(parts[parts.length - 1]);
                    }

                    // Se a imagem estiver dentro de um link <a href="...jpg/webp">
                    const parentLink = img.closest('a[href]');
                    if (parentLink) {
                        const href = parentLink.getAttribute('href') || '';
                        if (/\\.(jpe?g|png|webp)(\\?.*)?$/i.test(href)) {
                            addUrl(href);
                        }
                    }

                    addUrl(img.currentSrc || img.src);
                }
            }

            // 3. Meta OpenGraph (Fallback)
            const ogImg = document.querySelector('meta[property="og:image"]');
            if (ogImg) addUrl(ogImg.getAttribute('content'));

            return Array.from(new Set(results));
        }""",
        commercial_code,
    )

    final_urls: List[str] = []
    seen: Set[str] = set()

    for raw_u in raw_candidates:
        abs_url = urljoin(current_url, raw_u)
        if not is_valid_product_image_url(abs_url):
            continue
        for promoted in promote_thumbnail_url_to_fullsize(abs_url):
            if promoted not in seen:
                seen.add(promoted)
                final_urls.append(promoted)

    return final_urls


async def locate_product_page_and_extract_images(
    page: Page,
    commercial_code: str,
    brand_cfg: Dict[str, Any],
) -> List[str]:
    """
    Executa as 3 Estratégias Universais em Cascata:
      A) URL Direta por Template ({slug}, {sku})
      B) URL de Pesquisa Direta (?s={sku}, ?q={sku}) + clique no card correspondente
      C) Automação de Barra de Busca na página do catálogo via Playwright Locators
    """
    slug = normalize_slug_lower(commercial_code)
    sku_norm = normalize_sku_strict_lower(commercial_code)
    sku_encoded = quote_plus(commercial_code.strip())

    # ------------------------------------------------------------------------
    # ESTRATÉGIA A: Tentativa por Padrões de URL Direta
    # ------------------------------------------------------------------------
    for pattern in brand_cfg.get("directPatterns", []):
        target_url = (
            pattern.replace("{slug}", slug)
            .replace("{sku}", sku_encoded)
            .replace("{sku_norm}", sku_norm)
        )
        try:
            resp = await page.goto(target_url, wait_until="domcontentloaded", timeout=15000)
            if resp and resp.status < 400:
                await page.wait_for_timeout(700)
                # Confirma se o código da peça realmente aparece na página carregada
                body_text = (await page.inner_text("body")).upper()
                if commercial_code.upper() in body_text or sku_norm.upper() in re.sub(
                    r"[^A-Z0-9]", "", body_text
                ):
                    imgs = await extract_studio_images_from_current_page(page, commercial_code)
                    if imgs:
                        return imgs
        except Exception:
            continue

    # ------------------------------------------------------------------------
    # ESTRATÉGIA B: Tentativa por URL de Pesquisa (?s=..., ?q=...)
    # ------------------------------------------------------------------------
    for search_pattern in brand_cfg.get("searchUrls", []):
        search_url = search_pattern.replace("{sku}", sku_encoded).replace("{slug}", slug)
        try:
            resp = await page.goto(search_url, wait_until="domcontentloaded", timeout=15000)
            if not resp or resp.status >= 400:
                continue
            await page.wait_for_timeout(800)

            # Se houver um link de produto na grade de resultados com o código exato, clica nele
            product_link = page.locator(f"a:has-text('{commercial_code}')").first
            if await product_link.count() > 0:
                await product_link.click(timeout=5000)
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
                await page.wait_for_timeout(700)

            imgs = await extract_studio_images_from_current_page(page, commercial_code)
            if imgs:
                return imgs
        except Exception:
            continue

    # ------------------------------------------------------------------------
    # ESTRATÉGIA C: Interação Direta com Barra de Busca via Playwright Locators
    # ------------------------------------------------------------------------
    catalog_home = brand_cfg.get("catalogHome") or brand_cfg.get("baseUrl")
    if catalog_home:
        try:
            await page.goto(catalog_home, wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_timeout(600)
            search_input = page.locator(
                "input[type='search'], input[name='s'], input[name='q'], "
                "input[placeholder*='Buscar' i], input[placeholder*='Pesquisar' i], "
                "input[placeholder*='Código' i], input[placeholder*='Produto' i]"
            ).first

            if await search_input.count() > 0 and await search_input.is_visible():
                await search_input.fill(commercial_code)
                await search_input.press("Enter")
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
                await page.wait_for_timeout(800)

                card_link = page.locator(f"a:has-text('{commercial_code}')").first
                if await card_link.count() > 0:
                    await card_link.click(timeout=5000)
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
                    await page.wait_for_timeout(700)

                imgs = await extract_studio_images_from_current_page(page, commercial_code)
                if imgs:
                    return imgs
        except Exception:
            pass

    return []


# ============================================================================
# PIPELINE ASSÍNCRONO DE PROCESSAMENTO E CONVERSÃO WEBP STUDIO
# ============================================================================

async def process_product_item(
    semaphore: asyncio.Semaphore,
    context: BrowserContext,
    product: Dict[str, Any],
    brand_cfg: Dict[str, Any],
    cache: Dict[str, List[str]],
    use_lossless: bool,
    force_refresh: bool,
) -> Tuple[str, List[str]]:
    brand_name = str(product.get("brandName", "geral")).strip()
    brand_folder = normalize_brand_folder(brand_name)
    code_raw = str(product.get("commercialCodeRaw", "")).strip()
    sku_norm = normalize_sku_strict_lower(code_raw)
    cache_key = f"{brand_folder}::{sku_norm}"
    existing_urls: List[str] = list(product.get("staticImageUrls") or [])

    if not force_refresh and cache_key in cache and cache[cache_key]:
        cached_paths = cache[cache_key]
        if all((PROJECT_ROOT / "public" / p.lstrip("/")).exists() for p in cached_paths):
            return cache_key, cached_paths

    async with semaphore:
        page = await context.new_page()
        try:
            candidate_urls = await locate_product_page_and_extract_images(
                page, code_raw, brand_cfg
            )
            if not candidate_urls:
                return cache_key, existing_urls

            brand_output_dir = PUBLIC_IMAGES_ROOT / brand_folder
            brand_output_dir.mkdir(parents=True, exist_ok=True)

            saved_static_urls: List[str] = []
            seen_hashes: Set[str] = set()

            for img_url in candidate_urls:
                if len(saved_static_urls) >= 6:
                    break
                try:
                    resp = await context.request.get(img_url, timeout=15000)
                    if not resp.ok:
                        continue
                    img_bytes = await resp.body()
                    if len(img_bytes) < 1200:
                        continue

                    angle_idx = len(saved_static_urls) + 1
                    filename = (
                        f"{sku_norm}.webp"
                        if angle_idx == 1
                        else f"{sku_norm}_{angle_idx}.webp"
                    )
                    out_path = brand_output_dir / filename

                    conv = convert_bytes_to_studio_webp(
                        raw_image_bytes=img_bytes,
                        output_path=out_path,
                        max_dimension=1600,
                        padding=16,
                        clean_corners=True,
                        use_lossless=use_lossless,
                        quality=96,
                    )

                    if conv.success and conv.audit_passed:
                        if conv.sha256_hex in seen_hashes:
                            if angle_idx > 1 and out_path.exists():
                                out_path.unlink(missing_ok=True)
                            continue

                        seen_hashes.add(conv.sha256_hex)
                        saved_static_urls.append(
                            f"/catalog-images/{brand_folder}/{filename}"
                        )
                except Exception:
                    continue

            if saved_static_urls:
                cache[cache_key] = saved_static_urls
                save_scrape_cache(cache)
                print(
                    f"  [✓] [{brand_name.upper()}] {code_raw}: "
                    f"{len(saved_static_urls)} ângulo(s) WebP HD -> {saved_static_urls}"
                )
                return cache_key, saved_static_urls

            return cache_key, existing_urls
        finally:
            await page.close()


def update_all_catalog_json_files(updated_map: Dict[str, List[str]]) -> Dict[str, int]:
    """
    Atualiza automaticamente todos os arquivos JSON de catálogo em `src/data/*.json`
    (ex.: catalog-master-seed.json, reservatorios-catalog.json, etc.).
    """
    stats: Dict[str, int] = {}
    if not DATA_DIR.exists():
        return stats

    for json_file in sorted(DATA_DIR.glob("*.json")):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            products_list = data.get("products", []) if isinstance(data, dict) else data
            if not isinstance(products_list, list):
                continue

            count = 0
            for prod in products_list:
                if not isinstance(prod, dict):
                    continue
                b_folder = normalize_brand_folder(str(prod.get("brandName", "geral")))
                s_norm = normalize_sku_strict_lower(str(prod.get("commercialCodeRaw", "")))
                key = f"{b_folder}::{s_norm}"
                if key in updated_map and updated_map[key]:
                    prod["staticImageUrls"] = updated_map[key]
                    count += 1

            if count > 0:
                json_file.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                stats[json_file.name] = count
        except Exception as exc:
            print(f"[!] Erro ao atualizar {json_file.name}: {exc}")

    return stats


def bump_service_worker_cache_version() -> None:
    if not SW_FILE_PATH.exists():
        return
    content = SW_FILE_PATH.read_text(encoding="utf-8")
    updated = re.sub(
        r"(CACHE_NAME\s*=\s*['\"])([^'\"]+)(['\"])",
        r"\1autocat-universal-webp-v4\3",
        content,
        count=1,
    )
    if updated != content:
        SW_FILE_PATH.write_text(updated, encoding="utf-8")


async def async_main() -> None:
    parser = argparse.ArgumentParser(
        description="Enriquecedor Universal Multi-Marca de Catálogos via Playwright + WebP Studio"
    )
    parser.add_argument(
        "--seed",
        type=str,
        default=str(DATA_DIR / "catalog-master-seed.json"),
        help="Caminho do arquivo JSON principal de seed",
    )
    parser.add_argument(
        "--brand",
        type=str,
        default=None,
        help="Filtrar apenas uma marca específica (ex: Gonel, Click, Unifap, Florio)",
    )
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="URL base do catálogo web da marca (ex: https://gonel.com.br/catalog)",
    )
    parser.add_argument(
        "--url-pattern",
        type=str,
        default=None,
        help="Template opcional de URL direta (ex: https://marca.com.br/catalog/{slug})",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Número máximo de abas simultâneas no Playwright (padrão: 4)",
    )
    parser.add_argument(
        "--lossless",
        action="store_true",
        help="Ativar compressão WebP 100%% Lossless (padrão: Near-Lossless Studio quality=96)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignorar cache incremental e reprocessar todas as peças",
    )
    args = parser.parse_args()

    seed_path = Path(args.seed)
    if not seed_path.exists():
        # Tenta localizar qualquer JSON válido dentro de src/data/
        json_candidates = list(DATA_DIR.glob("*.json")) if DATA_DIR.exists() else []
        if not json_candidates:
            print(f"[ERRO] Nenhum arquivo de seed encontrado em {seed_path}")
            sys.exit(1)
        seed_path = json_candidates[0]

    seed_data = json.loads(seed_path.read_text(encoding="utf-8"))
    all_products: List[Dict[str, Any]] = (
        seed_data.get("products", []) if isinstance(seed_data, dict) else seed_data
    )

    brand_configs = discover_brand_web_configs(
        seed_data if isinstance(seed_data, dict) else {},
        args.brand,
        args.url,
        args.url_pattern,
    )

    # Filtra os produtos cujas marcas possuem configuração web ativa
    target_products: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for prod in all_products:
        b_name = str(prod.get("brandName", "")).strip()
        b_key = normalize_brand_folder(b_name)
        if args.brand and normalize_brand_folder(args.brand) != b_key:
            continue
        if b_key in brand_configs:
            target_products.append((prod, brand_configs[b_key]))

    if not target_products:
        print(
            "[!] Nenhum produto elegível para enriquecimento web ou nenhuma URL de catálogo configurada."
        )
        print(
            "    Dica: use `python scripts/enrich_catalog_playwright.py --brand MinhaMarca --url https://site.com.br`"
        )
        return

    print("==================================================================")
    print(f"🚀 PLAYWRIGHT UNIVERSAL CATALOG ENRICHER (STUDIO WEBP HD)")
    print(f"   • Total de peças na fila: {len(target_products)}")
    print(f"   • Concorrência: {args.concurrency} workers | Modo Lossless: {args.lossless}")
    print("==================================================================")

    cache = load_scrape_cache()
    semaphore = asyncio.Semaphore(max(1, args.concurrency))
    updated_map: Dict[str, List[str]] = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
        )

        tasks = [
            process_product_item(
                semaphore=semaphore,
                context=context,
                product=prod,
                brand_cfg=b_cfg,
                cache=cache,
                use_lossless=args.lossless,
                force_refresh=args.force,
            )
            for prod, b_cfg in target_products
        ]
        results = await asyncio.gather(*tasks)

        for cache_key, urls in results:
            if urls:
                updated_map[cache_key] = urls

        await context.close()
        await browser.close()

    updated_files = update_all_catalog_json_files(updated_map)
    bump_service_worker_cache_version()

    multi_angle_total = sum(1 for v in updated_map.values() if len(v) > 1)
    photos_total = sum(len(v) for v in updated_map.values())

    print("\n==================================================================")
    print("✅ ENRIQUECIMENTO UNIVERSAL PLAYWRIGHT + WEBP CONCLUÍDO!")
    print(f"   • Arquivos JSON atualizados: {updated_files}")
    print(f"   • Total de fotos WebP Studio auditadas: {photos_total}")
    print(f"   • Produtos com múltiplos ângulos (_2.webp, _3.webp+): {multi_angle_total}")
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(async_main())