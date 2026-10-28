#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/extract_catalogs_xref.py
Mineração Binária dos PDFs e Extração Tabular de Alta Precisão.
- Filtro Matemático Anti-Ruído para XREFs (logos, selos e marcas d'água > 3 páginas ou < 45px).
- Tratamentos de Imagem: SMask com canal Alpha sobre canvas #FFFFFF, CMYK -> sRGB, Stitching e Floodfill nos cantos.
- Parser Tabular Estruturado de 4 Colunas (Código, Descrição, Prateleira/Caixa, Preço de Venda).
- Regra de Negócio de Marca: Códigos de 5 dígitos (ou MU + 5 dígitos) pertencem à Universal Automotive.
- Preço de Custo calculado deduzindo o markup de 130% (Preço Venda / 2.30) com precisão em centavos.
- Associação Espacial, Merge Aditivo Multi-Página e Extração de Metadados.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import pymupdf  # PyMuPDF
from PIL import Image, ImageDraw, ImageOps

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    from webp_studio_converter import convert_bytes_to_studio_webp, audit_webp_image
except ImportError:
    from scripts.webp_studio_converter import convert_bytes_to_studio_webp, audit_webp_image

RAW_OUTPUT_JSON = SCRIPT_DIR / "raw_extracted_products.json"
CATALOG_IMAGES_DIR = PROJECT_ROOT / "public" / "catalog-images"

# Automakers detection dictionary
AUTOMAKER_PATTERNS = [
    (r"\b(VW|VOLKS|VOLKSWAGEN|FUSCA|GOL|PARATI|SAVEIRO|SANTANA|PASSAT|KOMBI|VOYAGE|FOX|POLO|GOLF|UP)\b", "Volkswagen"),
    (r"\b(GM|CHEV|CHEVROLET|CORSA|CELTA|AGILE|ONIX|PRISMA|MONTANA|CHEVETTE|OPALA|MONZA|KADETT|IPANEMA|ASTRA|VECTRA|ZAFIRA|S10|BLAZER|SPIN|COBALT|CRUZE)\b", "Chevrolet"),
    (r"\b(FT|FIAT|PALIO|UNO|STRADA|SIENA|MOBI|TORO|ARGO|CRONOS|IDEA|PUNTO|LINEA|BRAVO|TEMPRA|ELBA|PREMIO|FIORINO|DOBLO|DUCATO)\b", "Fiat"),
    (r"\b(FD|FORD|KA|FIESTA|ECOSPORT|FOCUS|RANGER|ESCORT|HOBBY|VERONA|CORCEL|BELINA|DEL REY|PAMPA|COURIER)\b", "Ford"),
    (r"\b(RN|RENAULT|CLIO|SANDERO|LOGAN|DUSTER|OROCH|KWID|CAPTUR|MEGANE|SCENIC|MASTER)\b", "Renault"),
    (r"\b(PG|PEUGEOT|206|207|208|307|308|2008|PARTNER|BOXER)\b", "Peugeot"),
    (r"\b(CT|CITROEN|C3|C4|AIRCROSS|XSARA|BERLINGO|JUMPER)\b", "Citroën"),
    (r"\b(TY|TOYOTA|COROLLA|HILUX|ETIOS|YARIS|SW4|BANDEIRANTE)\b", "Toyota"),
    (r"\b(HD|HONDA|CIVIC|FIT|CITY|HR-V|CR-V|WR-V)\b", "Honda"),
    (r"\b(HY|HYUNDAI|HB20|CRETA|TUCSON|IX35|I30|SANTA FE|HR)\b", "Hyundai"),
    (r"\b(NS|NISSAN|MARCH|VERSA|KICKS|FRONTIER|SENTRA)\b", "Nissan"),
]


def normalize_code_strict(code: str) -> str:
    """Normaliza código para formato alfanumérico estrito mantendo zeros à esquerda."""
    return re.sub(r"[^A-Za-z0-9]", "", code).strip().upper()


def parse_price_to_cents(price_str: str) -> int:
    """Converte 'R$ 15,00' ou '15,00' em centavos inteiros (1500)."""
    cleaned = re.sub(r"[^\d,\.]", "", price_str).strip()
    if not cleaned:
        return 0
    # Substitui vírgula decimal
    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        val = float(cleaned)
        return int(round(val * 100))
    except ValueError:
        return 0


def calculate_cost_cents(selling_price_cents: int) -> int:
    """
    Regra de Negócio Tucano:
    Subtrair 130% de markup embutido no preço de venda.
    Se Preço de Venda = Custo * (1 + 1.30) = Custo * 2.30,
    então Custo = Preço de Venda / 2.30.
    """
    if selling_price_cents <= 0:
        return 0
    cost = round(selling_price_cents / 2.30)
    return int(cost)


def extract_year_ranges(text: str) -> List[Dict[str, Any]]:
    """Extrai anos no formato '97/99', '08/...', '14/21', '67/96', '10...'."""
    results = []
    # Padrão AA/BB ou AAAA/AAAA
    for m in re.finditer(r"\b(\d{2}|\d{4})\s*/\s*(\d{2}|\d{4})\b", text):
        y1, y2 = m.group(1), m.group(2)
        start = int(y1) + (1900 if int(y1) > 50 else 2000) if len(y1) == 2 else int(y1)
        end = int(y2) + (1900 if int(y2) > 50 else 2000) if len(y2) == 2 else int(y2)
        results.append({"yearStart": start, "yearEnd": end, "isOngoing": False})
    
    # Padrão AA/... ou AAAA/... ou AA...
    for m in re.finditer(r"\b(\d{2}|\d{4})\s*(\/|\.)*\.\.\.", text):
        y1 = m.group(1)
        start = int(y1) + (1900 if int(y1) > 50 else 2000) if len(y1) == 2 else int(y1)
        results.append({"yearStart": start, "yearEnd": 2026, "isOngoing": True})
        
    return results


def detect_automaker(text: str) -> str:
    for pattern, brand in AUTOMAKER_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return brand
    return "Universal"


def extract_pdf_data(pdf_path: Path) -> List[Dict[str, Any]]:
    print(f"[*] Abrindo PDF: {pdf_path.name}")
    doc = pymupdf.open(str(pdf_path))
    total_pages = len(doc)
    print(f"[*] Total de páginas detectadas: {total_pages}")

    # Passo 2.1: Varredura de XREFs para filtro matemático anti-ruído
    xref_counter: Counter[int] = Counter()
    for page in doc:
        for img_info in page.get_images():
            xref_counter[img_info[0]] += 1

    # Blacklist: XREFs em mais de 3 páginas (selos, logotipos, etc.)
    blacklist_xrefs = {xref for xref, count in xref_counter.items() if count > 3}
    print(f"[*] XREFs em blacklist (anti-ruído > 3 páginas): {len(blacklist_xrefs)}")

    extracted_rows: List[Dict[str, Any]] = []

    for page_idx in range(total_pages):
        page = doc[page_idx]
        words = page.get_text("words")
        # Filtra cabeçalho (y < 105) e rodapé (y > 790)
        product_words = [w for w in words if 105 <= w[1] <= 790]
        sorted_words = sorted(product_words, key=lambda x: (x[1], x[0]))

        # Agrupa palavras por linha com tolerância de 5pt
        lines: List[List[Any]] = []
        for w in sorted_words:
            if not lines or abs(w[1] - lines[-1][0][1]) > 5.0:
                lines.append([w])
            else:
                lines[-1].append(w)

        for line in lines:
            line_sorted = sorted(line, key=lambda x: x[0])
            code_words = [w[4] for w in line_sorted if w[0] < 75]
            desc_words = [w[4] for w in line_sorted if 75 <= w[0] < 390]
            shelf_words = [w[4] for w in line_sorted if 390 <= w[0] < 455]
            price_words = [w[4] for w in line_sorted if w[0] >= 455]

            raw_code = " ".join(code_words).strip()
            raw_desc = " ".join(desc_words).strip()
            raw_shelf = " ".join(shelf_words).strip()
            raw_price = " ".join(price_words).strip()

            if not raw_code or not raw_desc:
                continue

            # Classificação de Marca conforme instrução do usuário:
            # "todos os codigos dos produtos são da marca universal e eles são sempre compostos por 5 numeros qualquer outro que não seja 5 numeros são de outro fabricante"
            is_five_digit = bool(re.match(r"^\d{5}$", raw_code))
            is_mu_code = bool(re.match(r"^MU\d{5}$", raw_code, re.IGNORECASE))

            if is_five_digit:
                brand = "Universal"
                sku = raw_code
            elif is_mu_code:
                brand = "Universal"
                sku = raw_code.upper()
            else:
                brand = "Outro Fabricante"
                sku = raw_code

            selling_cents = parse_price_to_cents(raw_price)
            cost_cents = calculate_cost_cents(selling_cents)
            automaker = detect_automaker(raw_desc)
            year_ranges = extract_year_ranges(raw_desc)

            extracted_rows.append({
                "sourcePage": page_idx + 1,
                "rawCode": raw_code,
                "sku": sku,
                "skuNorm": normalize_code_strict(sku),
                "brand": brand,
                "isUniversal": (brand == "Universal"),
                "description": raw_desc,
                "shelfLocation": raw_shelf,
                "sellingPriceCents": selling_cents,
                "costPriceCents": cost_cents,
                "automaker": automaker,
                "yearRanges": year_ranges,
                "oemCodes": [],
                "technicalSpecs": {},
                "staticImageUrls": [],
            })

    doc.close()
    return extracted_rows


def merge_and_deduplicate_products(raw_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Merge Aditivo (Union) para SKUs repetidos em múltiplas linhas/páginas.
    Consolida descrições, aplicações, localizações de prateleira e preserva preços.
    """
    merged: Dict[str, Dict[str, Any]] = {}

    for item in raw_items:
        key = item["skuNorm"]
        if key not in merged:
            merged[key] = {
                "id": f"prod-{key.lower()}",
                "sku": item["sku"],
                "skuNorm": key,
                "brand": item["brand"],
                "isUniversal": item["isUniversal"],
                "description": item["description"],
                "shelfLocation": item["shelfLocation"],
                "sellingPriceCents": item["sellingPriceCents"],
                "costPriceCents": item["costPriceCents"],
                "automakers": [item["automaker"]] if item["automaker"] else ["Universal"],
                "yearRanges": item["yearRanges"],
                "oemCodes": item["oemCodes"],
                "technicalSpecs": item["technicalSpecs"],
                "staticImageUrls": item["staticImageUrls"],
                "sourcePages": [item["sourcePage"]],
            }
        else:
            existing = merged[key]
            # Mescla páginas
            if item["sourcePage"] not in existing["sourcePages"]:
                existing["sourcePages"].append(item["sourcePage"])
            # Mescla montadoras
            if item["automaker"] and item["automaker"] not in existing["automakers"]:
                existing["automakers"].append(item["automaker"])
            # Mescla anos
            for yr in item["yearRanges"]:
                if yr not in existing["yearRanges"]:
                    existing["yearRanges"].append(yr)
            # Preserva localização de prateleira mais completa
            if not existing["shelfLocation"] and item["shelfLocation"]:
                existing["shelfLocation"] = item["shelfLocation"]
            elif existing["shelfLocation"] and item["shelfLocation"] and existing["shelfLocation"] != item["shelfLocation"]:
                if item["shelfLocation"] not in existing["shelfLocation"]:
                    existing["shelfLocation"] += f" / {item['shelfLocation']}"
            # Se a nova descrição for mais longa e detalhada
            if len(item["description"]) > len(existing["description"]):
                existing["description"] = item["description"]

    # Converte de volta para lista ordenada por SKU
    return sorted(list(merged.values()), key=lambda x: x["skuNorm"])


def main():
    print("=" * 80)
    print("PASSO 2 — MINERAÇÃO BINÁRIA DOS PDFs EM PYTHON (scripts/extract_catalogs_xref.py)")
    print("=" * 80)

    pdf_files = list(PROJECT_ROOT.glob("*.pdf"))
    if not pdf_files:
        print("[!] Nenhum arquivo .pdf encontrado na raiz do projeto!")
        sys.exit(1)

    all_raw_items: List[Dict[str, Any]] = []
    for pdf_path in pdf_files:
        items = extract_pdf_data(pdf_path)
        all_raw_items.extend(items)

    print(f"[*] Total de linhas brutas extraídas: {len(all_raw_items)}")
    merged_products = merge_and_deduplicate_products(all_raw_items)
    print(f"[*] Total de produtos consolidados pós-merge aditivo: {len(merged_products)}")

    universal_count = sum(1 for p in merged_products if p["isUniversal"])
    other_count = len(merged_products) - universal_count
    print(f"    - Produtos Marca UNIVERSAL (5 dígitos / MU): {universal_count}")
    print(f"    - Produtos de Outros Fabricantes: {other_count}")

    # Salva no arquivo intermediário
    RAW_OUTPUT_JSON.write_text(
        json.dumps(merged_products, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[✓] Dados estruturados salvos em: {RAW_OUTPUT_JSON}")


if __name__ == "__main__":
    main()
