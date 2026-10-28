import { Product } from '../domain/types';
import { icons } from './icons';
import { lightbox } from './lightbox';
import { storage } from '../storage/indexeddb';
import { convertImageToWebpStudio, createAssetFromWebp } from '../media/webp-converter';
import { urlManager } from '../media/object-url-manager';

export interface GalleryItem {
  type: 'static' | 'manual';
  url: string;
  assetId?: string;
  isCover: boolean;
}

export function resolveImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const cleanPath = url.startsWith('/') ? url.slice(1) : url;
  const base = import.meta.env.BASE_URL || './';
  return `${base}${cleanPath}`;
}

export class ImageGallery {
  public static async getDisplayItemsForProduct(product: Product): Promise<GalleryItem[]> {
    const items: GalleryItem[] = [];
    const removedUrls = new Set(product.removedStaticUrls || []);
    const coverUrl = product.coverStaticUrl || '';

    // 1. Fotos Estáticas (Fábrica / Web / XREF)
    for (const url of product.staticImageUrls || []) {
      if (!removedUrls.has(url)) {
        items.push({
          type: 'static',
          url,
          isCover: (url === coverUrl),
        });
      }
    }

    // 2. Fotos Manuais da Loja (IndexedDB)
    for (const assetId of product.imageAssetIds || []) {
      const asset = await storage.getImageAsset(assetId);
      if (asset) {
        const objectUrl = urlManager.createUrl(asset.masterBlob);
        items.push({
          type: 'manual',
          url: objectUrl,
          assetId,
          isCover: false,
        });
      }
    }

    // Se nenhuma estiver explicitamente marcada como capa, a primeira é a capa
    if (items.length > 0 && !items.some(i => i.isCover)) {
      items[0].isCover = true;
    }

    return items;
  }

  public static renderCardPreview(
    items: GalleryItem[],
    productTitle: string
  ): string {
    if (items.length === 0) {
      return `
        <div class="w-full h-48 bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center text-slate-400 border-b border-slate-200 dark:border-slate-700">
          ${icons.image('w-10 h-10 mb-2 stroke-1')}
          <span class="text-xs font-mono">SEM FOTO</span>
        </div>
      `;
    }

    // Ordena para que a foto de capa seja a primeira
    const sortedItems = [...items].sort((a, b) => (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0));
    const urls = sortedItems.map(i => resolveImageUrl(i.url));
    const coverUrl = urls[0];
    const totalAngles = urls.length;
    const urlsJson = encodeURIComponent(JSON.stringify(urls));

    return `
      <div
        class="card-preview-container relative w-full h-48 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden group select-none"
        data-all-urls="${urlsJson}"
        data-current-idx="0"
        data-title="${productTitle}"
      >
        <!-- Imagem Principal (Clicável para Lightbox) -->
        <img
          src="${coverUrl}"
          alt="${productTitle}"
          loading="lazy"
          class="card-preview-img max-w-full max-h-full object-contain p-2 transition-transform duration-200 group-hover:scale-105 cursor-pointer"
          data-action="open-lightbox"
        />

        <!-- Controles de Navegação de Ângulos (quando houver mais de 1 ângulo) -->
        ${totalAngles > 1 ? `
          <button
            type="button"
            class="btn-card-prev-angle absolute left-1.5 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full bg-slate-900/80 hover:bg-blue-600 text-white shadow-md transition opacity-80 group-hover:opacity-100 hover:scale-110 active:scale-95 cursor-pointer border border-slate-700"
            title="Ver ângulo anterior"
          >
            ${icons.chevronLeft('w-4 h-4')}
          </button>

          <button
            type="button"
            class="btn-card-next-angle absolute right-1.5 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full bg-slate-900/80 hover:bg-blue-600 text-white shadow-md transition opacity-80 group-hover:opacity-100 hover:scale-110 active:scale-95 cursor-pointer border border-slate-700"
            title="Ver próximo ângulo"
          >
            ${icons.chevronRight('w-4 h-4')}
          </button>

          <!-- Indicador Numérico de Ângulos (ex: 1 / 4) -->
          <span class="card-angle-badge absolute bottom-2 right-2 bg-slate-900/85 text-white text-[11px] font-mono px-2 py-0.5 rounded-full shadow-md font-bold border border-slate-700/50 z-20">
            1 / ${totalAngles}
          </span>

          <!-- Pontos Indicadores de Ângulos (Dots) -->
          <div class="card-dots-bar absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 z-20 bg-slate-950/60 px-2 py-1 rounded-full backdrop-blur-xs">
            ${urls.map((_, idx) => `
              <button
                type="button"
                class="card-dot-btn w-2 h-2 rounded-full transition-all cursor-pointer ${idx === 0 ? 'bg-blue-500 scale-125' : 'bg-slate-400/70 hover:bg-white'}"
                data-dot-idx="${idx}"
                title="Ir para ângulo ${idx + 1}"
              ></button>
            `).join('')}
          </div>
        ` : ''}

        <!-- Ícone de Zoom Flutuante -->
        <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
          <span class="bg-white/90 dark:bg-slate-800/90 p-1 rounded-full shadow text-slate-700 dark:text-slate-200 block">
            ${icons.zoomIn('w-3.5 h-3.5')}
          </span>
        </div>
      </div>
    `;
  }

  public static renderModalGallery(
    container: HTMLElement,
    product: Product,
    onProductChange: (updated: Product) => void
  ): void {
    const render = async () => {
      const items = await ImageGallery.getDisplayItemsForProduct(product);
      container.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Galeria de Ângulos (${items.length})
            </span>
            <label class="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 transition">
              ${icons.upload('w-3.5 h-3.5')}
              <span>Adicionar Foto (ou Cole com Ctrl+V)</span>
              <input type="file" id="gallery-file-input" accept="image/*" multiple class="hidden" />
            </label>
          </div>

          <div class="grid grid-cols-4 gap-2.5">
            ${items.map((item, idx) => `
              <div class="relative group border rounded-lg overflow-hidden bg-white dark:bg-slate-800 ${item.isCover ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-700'}">
                <div class="h-24 w-full flex items-center justify-center p-1 cursor-pointer" data-preview-idx="${idx}">
                  <img src="${item.url}" class="max-w-full max-h-full object-contain" />
                </div>
                
                <div class="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/80 p-0.5 rounded">
                  <button type="button" class="p-1 hover:text-amber-400 text-slate-300 transition" title="Definir como Capa Principal" data-set-cover="${item.url}">
                    ${icons.star('w-3.5 h-3.5')}
                  </button>
                  <button type="button" class="p-1 hover:text-red-400 text-slate-300 transition" title="Remover Foto" data-remove-url="${item.url}" data-asset-id="${item.assetId || ''}">
                    ${icons.trash('w-3.5 h-3.5')}
                  </button>
                </div>

                ${item.isCover ? `
                  <span class="absolute bottom-1 left-1 bg-blue-600 text-[10px] text-white px-1 rounded font-medium">
                    Capa
                  </span>
                ` : ''}
              </div>
            `).join('')}

            <!-- Drop Zone Box -->
            <label class="h-24 border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:text-blue-500 cursor-pointer transition p-2 text-center">
              ${icons.plus('w-6 h-6 mb-1')}
              <span class="text-[10px] font-medium leading-tight">Arrastar / Ctrl+V</span>
              <input type="file" id="gallery-dropzone-input" accept="image/*" multiple class="hidden" />
            </label>
          </div>
        </div>
      `;

      // Eventos
      container.querySelectorAll('[data-preview-idx]').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.getAttribute('data-preview-idx') || '0', 10);
          const it = items[idx];
          if (it) lightbox.open(it.url, product.sku);
        });
      });

      container.querySelectorAll('[data-set-cover]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetUrl = el.getAttribute('data-set-cover')!;
          product.coverStaticUrl = targetUrl;
          onProductChange(product);
          render();
        });
      });

      container.querySelectorAll('[data-remove-url]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetUrl = el.getAttribute('data-remove-url')!;
          const assetId = el.getAttribute('data-asset-id');

          if (assetId) {
            product.imageAssetIds = (product.imageAssetIds || []).filter(id => id !== assetId);
          } else {
            product.removedStaticUrls = [...(product.removedStaticUrls || []), targetUrl];
            product.staticImageUrls = (product.staticImageUrls || []).filter(u => u !== targetUrl);
          }

          if (product.coverStaticUrl === targetUrl) {
            product.coverStaticUrl = undefined;
          }

          onProductChange(product);
          render();
        });
      });

      const handleFiles = async (files: FileList | File[]) => {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file.type.startsWith('image/')) continue;
          const processed = await convertImageToWebpStudio(file);
          const asset = createAssetFromWebp(processed);
          await storage.saveImageAsset(asset);
          product.imageAssetIds = [...(product.imageAssetIds || []), asset.id];
        }
        onProductChange(product);
        render();
      };

      const fileInput = container.querySelector<HTMLInputElement>('#gallery-file-input');
      fileInput?.addEventListener('change', () => {
        if (fileInput.files) handleFiles(fileInput.files);
      });

      const dropInput = container.querySelector<HTMLInputElement>('#gallery-dropzone-input');
      dropInput?.addEventListener('change', () => {
        if (dropInput.files) handleFiles(dropInput.files);
      });
    };

    render();
  }
}
