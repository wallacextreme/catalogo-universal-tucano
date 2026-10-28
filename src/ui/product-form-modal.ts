import { Product, ProductWithInventory, StoreInventoryData } from '../domain/types';
import { icons } from './icons';
import { ImageGallery } from './image-gallery';
import { storage } from '../storage/indexeddb';
import { formatBRL, parseBRL, calculateCostFromSelling } from '../domain/currency';
import { normalizeCodeStrict } from '../domain/normalizer';

export class ProductFormModal {
  private overlay: HTMLElement | null = null;
  private onSavedCallback: () => void = () => {};

  public open(
    productToEdit: ProductWithInventory | null,
    onSaved: () => void
  ): void {
    this.close();
    this.onSavedCallback = onSaved;

    const isNew = !productToEdit;
    const currentProduct: Product = productToEdit ? { ...productToEdit } : {
      id: `prod-${Date.now()}`,
      sku: '',
      skuNorm: '',
      brand: 'Universal',
      description: '',
      category: 'Geral',
      automakers: ['Universal'],
      models: [],
      yearRanges: [],
      oemCodes: [],
      technicalSpecs: {},
      staticImageUrls: [],
      removedStaticUrls: [],
      imageAssetIds: [],
      isTrash: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const currentInventory: StoreInventoryData = productToEdit?.storeInventory ? { ...productToEdit.storeInventory } : {
      productId: currentProduct.id,
      shelfLocation: '',
      sellingPriceCents: 0,
      costPriceCents: 0,
      stockQuantity: 1,
      internalNotes: '',
      updatedAt: new Date().toISOString(),
    };

    this.overlay = document.createElement('div');
    this.overlay.className = 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

    const sellingBRL = formatBRL(currentInventory.sellingPriceCents);
    const costBRL = formatBRL(currentInventory.costPriceCents);

    this.overlay.innerHTML = `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-8 animate-fadeIn flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
          <div class="flex items-center gap-3">
            <span class="p-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg">
              ${isNew ? icons.plus('w-5 h-5') : icons.edit('w-5 h-5')}
            </span>
            <div>
              <h2 class="text-lg font-bold text-slate-900 dark:text-white">
                ${isNew ? 'Cadastrar Nova Peça no Balcão' : `Editar Peça: SKU ${currentProduct.sku}`}
              </h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Campos técnicos de fábrica e inventário inviolável da loja
              </p>
            </div>
          </div>
          <button id="modal-close-btn" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition">
            ${icons.close('w-6 h-6')}
          </button>
        </div>

        <!-- Form Body (Scrollable) -->
        <div class="p-6 overflow-y-auto space-y-6 flex-1 font-sans">
          <!-- 1. Identificação Principal -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Código Comercial (SKU) *
              </label>
              <input type="text" id="inp-sku" value="${currentProduct.sku}" class="w-full font-mono text-lg font-extrabold px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 uppercase" placeholder="Ex: 20428" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Marca / Fabricante
              </label>
              <input type="text" id="inp-brand" value="${currentProduct.brand}" class="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500" placeholder="Ex: Universal" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Localização (Caixa / Prateleira)
              </label>
              <input type="text" id="inp-shelf" value="${currentInventory.shelfLocation}" class="w-full font-mono text-base font-bold px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 focus:ring-2 focus:ring-blue-500 uppercase" placeholder="Ex: 548" />
            </div>
          </div>

          <!-- Descrição Completa -->
          <div>
            <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
              Descrição do Produto
            </label>
            <textarea id="inp-desc" rows="2" class="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm" placeholder="Descrição completa da peça">${currentProduct.description}</textarea>
          </div>

          <!-- 2. Preços e Estoque (Dedução de 130% Markup) -->
          <div class="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Preço de Venda
              </label>
              <input type="text" id="inp-selling" value="${sellingBRL}" class="w-full font-mono font-bold text-base px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 focus:ring-2 focus:ring-emerald-500" placeholder="R$ 0,00" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Preço de Custo (-130% Markup)
              </label>
              <input type="text" id="inp-cost" value="${costBRL}" class="w-full font-mono text-base px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 focus:ring-2 focus:ring-blue-500" placeholder="R$ 0,00" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Qtd em Estoque
              </label>
              <input type="number" id="inp-stock" value="${currentInventory.stockQuantity}" min="0" class="w-full font-mono font-bold text-base px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <!-- 3. Galeria Multi-Ângulos -->
          <div id="modal-gallery-container" class="pt-2"></div>

          <!-- 4. Códigos Originais (OEM) e Aplicações -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Códigos Originais OEM (separados por vírgula)
              </label>
              <input type="text" id="inp-oem" value="${(currentProduct.oemCodes || []).join(', ')}" class="w-full font-mono text-sm px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 uppercase" placeholder="Ex: 377837205A, 377837206A" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Montadoras (separadas por vírgula)
              </label>
              <input type="text" id="inp-automakers" value="${(currentProduct.automakers || []).join(', ')}" class="w-full text-sm px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500" placeholder="Ex: Volkswagen, Fiat" />
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
          <div class="flex items-center gap-2">
            ${!isNew ? `
              <button type="button" id="btn-duplicate" class="px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center gap-1.5 transition">
                ${icons.duplicate('w-3.5 h-3.5')}
                <span>Duplicar</span>
              </button>
              
              <button type="button" id="btn-trash" class="px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/60 inline-flex items-center gap-1.5 transition">
                ${icons.trash('w-3.5 h-3.5')}
                <span>${currentProduct.isTrash ? 'Excluir Definitivamente' : 'Mover p/ Lixeira'}</span>
              </button>
            ` : ''}
          </div>

          <div class="flex items-center gap-3">
            <button type="button" id="btn-cancel" class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition">
              Cancelar
            </button>
            <button type="button" id="btn-save" class="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm hover:shadow transition inline-flex items-center gap-1.5">
              ${icons.check('w-4 h-4')}
              <span>Salvar Alterações</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Renderiza Galeria
    const galleryContainer = this.overlay.querySelector<HTMLElement>('#modal-gallery-container')!;
    ImageGallery.renderModalGallery(galleryContainer, currentProduct, (updated) => {
      Object.assign(currentProduct, updated);
    });

    // Auto-cálculo de preço de custo ao digitar preço de venda
    const inpSelling = this.overlay.querySelector<HTMLInputElement>('#inp-selling')!;
    const inpCost = this.overlay.querySelector<HTMLInputElement>('#inp-cost')!;
    inpSelling.addEventListener('input', () => {
      const sCents = parseBRL(inpSelling.value);
      const cCents = calculateCostFromSelling(sCents);
      inpCost.value = formatBRL(cCents);
    });

    // Eventos de Ação
    this.overlay.querySelector('#modal-close-btn')!.addEventListener('click', () => this.close());
    this.overlay.querySelector('#btn-cancel')!.addEventListener('click', () => this.close());

    // Duplicar
    const btnDup = this.overlay.querySelector<HTMLButtonElement>('#btn-duplicate');
    btnDup?.addEventListener('click', async () => {
      const newSku = prompt('Digite o novo Código (SKU) para o produto duplicado:', `${currentProduct.sku}-C`);
      if (newSku && newSku.trim()) {
        await storage.duplicateProduct(currentProduct.id, newSku.trim());
        this.close();
        this.onSavedCallback();
      }
    });

    // Lixeira ou Exclusão
    const btnTrash = this.overlay.querySelector<HTMLButtonElement>('#btn-trash');
    btnTrash?.addEventListener('click', async () => {
      if (currentProduct.isTrash) {
        if (confirm(`Deseja realmente EXCLUIR DEFINITIVAMENTE o SKU ${currentProduct.sku}? Esta ação não pode ser desfeita.`)) {
          await storage.hardDeleteProduct(currentProduct.id);
          this.close();
          this.onSavedCallback();
        }
      } else {
        if (confirm(`Mover o SKU ${currentProduct.sku} para a lixeira?`)) {
          await storage.softDeleteProduct(currentProduct.id);
          this.close();
          this.onSavedCallback();
        }
      }
    });

    // Salvar
    this.overlay.querySelector('#btn-save')!.addEventListener('click', async () => {
      const skuVal = (this.overlay!.querySelector<HTMLInputElement>('#inp-sku')!).value.trim();
      if (!skuVal) {
        alert('O Código Comercial (SKU) é obrigatório.');
        return;
      }

      const brandVal = (this.overlay!.querySelector<HTMLInputElement>('#inp-brand')!).value.trim();
      const shelfVal = (this.overlay!.querySelector<HTMLInputElement>('#inp-shelf')!).value.trim();
      const descVal = (this.overlay!.querySelector<HTMLTextAreaElement>('#inp-desc')!).value.trim();
      const sellingVal = parseBRL(inpSelling.value);
      const costVal = parseBRL(inpCost.value);
      const stockVal = parseInt((this.overlay!.querySelector<HTMLInputElement>('#inp-stock')!).value || '1', 10);
      const oemVal = (this.overlay!.querySelector<HTMLInputElement>('#inp-oem')!).value;
      const automakersVal = (this.overlay!.querySelector<HTMLInputElement>('#inp-automakers')!).value;

      currentProduct.sku = skuVal;
      currentProduct.skuNorm = normalizeCodeStrict(skuVal);
      currentProduct.brand = brandVal || 'Universal';
      currentProduct.description = descVal;
      currentProduct.oemCodes = oemVal.split(',').map(s => s.trim()).filter(Boolean);
      currentProduct.automakers = automakersVal.split(',').map(s => s.trim()).filter(Boolean);

      currentInventory.shelfLocation = shelfVal;
      currentInventory.sellingPriceCents = Number(sellingVal);
      currentInventory.costPriceCents = Number(costVal);
      currentInventory.stockQuantity = stockVal;

      await storage.saveProductWithInventory(currentProduct, currentInventory);
      this.close();
      this.onSavedCallback();
    });

    // Escape para fechar
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        window.removeEventListener('keydown', onKey);
      }
    };
    window.addEventListener('keydown', onKey);
  }

  public close(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
    }
  }
}

export const productFormModal = new ProductFormModal();
