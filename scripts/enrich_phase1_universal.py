import json
import urllib.request
import re
import sys
import io
from pathlib import Path
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

from webp_studio_converter import convert_bytes_to_studio_webp, audit_webp_image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = PROJECT_ROOT / "src" / "data" / "catalog-master-seed.json"
CACHE_PATH = PROJECT_ROOT / "scripts" / ".playwright_scrape_cache.json"
IMAGES_DIR = PROJECT_ROOT / "public" / "catalog-images" / "universal"

seed = json.load(open(SEED_PATH, encoding="utf-8"))
cache = json.load(open(CACHE_PATH, encoding="utf-8"))

# Identify all missing SKUs
missing_skus = []
for p in seed:
    sku = p["sku"]
    if not cache.get(sku, {}).get("found", False):
        missing_skus.append(p)

print(f"Total products to check in Phase 1 (Universal Dotted): {len(missing_skus)}")

headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
found_count = 0
converted_images = 0

for idx, prod in enumerate(missing_skus):
    sku = prod["sku"]
    sku_lower = sku.lower()
    
    # Check if SKU is 5 digits or can be formatted with dot
    candidates = []
    if len(sku) == 5 and sku.isdigit():
        candidates.append(f"{sku[:2]}.{sku[2:]}")
    candidates.append(sku)

    matched_item = None
    matched_query = ""

    for cand in candidates:
        url = f"https://www.universalautomotive.com.br/api/catalog_system/pub/products/search?ft={cand}"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode())
                if isinstance(data, list) and len(data) > 0:
                    for item in data:
                        # Check if product name or reference code or linkText matches SKU
                        p_name = item.get("productName", "")
                        ref = str(item.get("productReference", "")).strip()
                        ref_code = str(item.get("productReferenceCode", "")).strip()
                        link_text = item.get("linkText", "")
                        if sku in ref or sku in ref_code or f"_{sku}" in link_text or cand in p_name or sku in p_name:
                            matched_item = item
                            matched_query = cand
                            break
                    if matched_item:
                        break
        except Exception:
            pass

    if matched_item:
        found_count += 1
        name = matched_item.get("productName", "")
        # Extract all studio images
        images = []
        for sk in matched_item.get("items", []):
            for im in sk.get("images", []):
                i_url = im.get("imageUrl", "")
                if i_url and i_url not in images:
                    images.append(i_url)

        print(f"[{found_count}] Found on Universal ({matched_query}): SKU {sku} - {name} ({len(images)} images)")

        # Download and convert images
        new_urls = []
        for img_idx, img_url in enumerate(images):
            # Clean VTEX URL to get full size
            clean_url = re.sub(r"-\d+-\d+(\?|$)", r"\1", img_url)
            try:
                req = urllib.request.Request(clean_url, headers=headers)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw_bytes = resp.read()
                    
                target_filename = f"{sku_lower}.webp" if img_idx == 0 else f"{sku_lower}_{img_idx + 1}.webp"
                target_path = IMAGES_DIR / target_filename
                
                success = convert_bytes_to_studio_webp(
                    raw_bytes,
                    target_path,
                    max_dim=1600,
                    quality=96,
                    clean_corners=True,
                    padding=16,
                )
                if success:
                    audit_ok, _ = audit_webp_image(target_path)
                    new_urls.append(f"/catalog-images/universal/{target_filename}")
                    converted_images += 1
            except Exception as e:
                print(f"  Failed image {img_url}: {e}")

        if new_urls:
            prod["staticImageUrls"] = new_urls
            cache[sku] = {
                "searched": True,
                "found": True,
                "web_data": {
                    "productName": name,
                    "brand": matched_item.get("brand", "Universal"),
                    "link": matched_item.get("link", ""),
                    "images": images
                }
            }

print(f"\nPhase 1 Complete: Found {found_count} products on Universal, converted {converted_images} images.")

# Save progress
with open(SEED_PATH, "w", encoding="utf-8") as f:
    json.dump(seed, f, ensure_ascii=False, indent=2)

with open(CACHE_PATH, "w", encoding="utf-8") as f:
    json.dump(cache, f, ensure_ascii=False, indent=2)

print("Saved updated seed and cache.")
