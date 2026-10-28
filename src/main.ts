import './style.css';
import { ProductWithInventory, RelationLink } from './domain/types';
import { storage } from './storage/indexeddb';
import { searchEngine, SearchMatch } from './search/search-engine';
import { relationsEngine } from './relations/relations-engine';
import { ImageGallery } from './ui/image-gallery';
import { lightbox } from './ui/lightbox';
import { productFormModal } from './ui/product-form-modal';
import { renderManagementModal } from './ui/management-modal';
import { icons } from './ui/icons';
import { formatBRL } from './domain/currency';
import seedData from './data/catalog-master-seed.json';

class App {
  private allProducts: ProductWithInventory[] = [];
  private allRelations: RelationLink[] = [];
  private currentMatches: SearchMatch[] = [];
  private clientMode = false; // Modo Cliente: Oculta Preços no Balcão
  private isDark = false;
  private currentFilterAutomaker = 'all';
  private currentFilterPrice = 'all';
  private lastSearchTimeMs = 0;

  public async init(): Promise<void> {
    // 1. Configura Tema (Daylight Counter Mode como padrão)
    this.isDark = localStorage.getItem('tucano_theme') === 'dark';
    this.applyTheme();

    // 2. Inicializa Banco e Executa Auto-Seed / Sync Não-Destrutivo
    try {
      await storage.autoSeedFromMasterJson(seedData);
    } catch (err) {
      console.warn('Erro durante auto-seed:', err);
    }

    // 3. Carrega Dados
    await this.refreshData();

    // 4. Registra Service Worker PWA (Offline-First)
    if ('serviceWorker' in navigator && !window.location.host.includes('tauri')) {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('Falha ao registrar Service Worker:', err);
      });
    }

    // 5. Renderiza Interface
    this.renderShell();
    this.executeSearch();
  }

  private applyTheme(): void {
    if (this.isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    localStorage.setItem('tucano_theme', this.isDark ? 'dark' : 'light');
  }

  private toggleTheme(): void {
    this.isDark = !this.isDark;
    this.applyTheme();
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.innerHTML = this.isDark ? icons.sun('w-5 h-5') : icons.moon('w-5 h-5');
  }

  private toggleClientMode(): void {
    this.clientMode = !this.clientMode;
    const btn = document.getElementById('client-mode-btn');
    if (btn) {
      btn.innerHTML = this.clientMode
        ? `${icons.eyeOff('w-4 h-4 text-amber-500')} <span class="text-xs font-semibold text-amber-600 dark:text-amber-400">Modo Cliente (Preços Ocultos)</span>`
        : `${icons.eye('w-4 h-4 text-emerald-600 dark:text-emerald-400')} <span class="text-xs font-semibold text-slate-700 dark:text-slate-300">Modo Balcão (Preços Visíveis)</span>`;
    }
    this.renderProductsGrid();
  }

  public async refreshData(): Promise<void> {
    this.allProducts = await storage.getAllProductsWithInventory(true);
    this.allRelations = await storage.getAllRelations();
    const activeProducts = this.allProducts.filter(p => !p.isTrash);
    searchEngine.index(activeProducts);
  }

  private executeSearch(): void {
    const input = document.getElementById('search-input') as HTMLInputElement | null;
    const query = input ? input.value : '';

    const t0 = performance.now();
    const activeList = this.allProducts.filter(p => !p.isTrash);

    // Reindexa engine se mudou de aba
    searchEngine.index(activeList);

    this.currentMatches = searchEngine.search(query, {
      automaker: this.currentFilterAutomaker,
      priceStatus: this.currentFilterPrice as any,
    });
    this.lastSearchTimeMs = Math.round((performance.now() - t0) * 10) / 10;

    this.renderProductsGrid();
    this.updateStats();
  }

  private renderShell(): void {
    const appEl = document.getElementById('app')!;

    appEl.innerHTML = `
      <!-- Top Bar / Header de Balcão -->
      <header class="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <!-- Logo & Marca -->
          <div class="flex items-center gap-3 select-none">
            <div class="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center font-extrabold text-xl shadow-md shadow-blue-700/20">
              T
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-base font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">
                  AUTO PEÇAS TUCANO
                </h1>
                <span class="bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded">
                  UNIVERSAL
                </span>
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-none mt-1">
                Catálogo Eletrônico de Balcão Offline-First
              </p>
            </div>
          </div>

          <!-- Barra de Busca Instantânea (< 50ms) -->
          <div class="flex-1 max-w-2xl relative">
            <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              ${icons.search('w-5 h-5')}
            </div>
            <input
              type="text"
              id="search-input"
              class="w-full pl-11 pr-28 py-2.5 bg-slate-100 dark:bg-slate-800/80 border border-slate-300/80 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white dark:focus:bg-slate-800 font-medium text-sm transition"
              placeholder="Buscar por Código Universal (5 dígitos), OEM, Aplicação, Veículo ou Caixa..."
              autofocus
            />
            <div class="absolute inset-y-0 right-0 pr-2.5 flex items-center gap-1.5">
              <!-- Botão Limpar Caixa de Busca (1 clique ou Esc) -->
              <button
                type="button"
                id="search-clear-btn"
                class="hidden p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition cursor-pointer"
                title="Limpar busca para digitar novamente (Esc)"
              >
                ${icons.x('w-4 h-4')}
              </button>
              <span id="benchmark-pill" class="text-[10px] font-mono bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md font-bold">
                0.0 ms
              </span>
            </div>
          </div>

          <!-- Ações Superiores -->
          <div class="flex items-center gap-2">
            <!-- Botão Modo Cliente (Ocultar Preços) -->
            <button
              id="client-mode-btn"
              class="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl inline-flex items-center gap-2 transition cursor-pointer"
              title="Alternar entre visualização de balcão e tela de cliente"
            >
              ${icons.eye('w-4 h-4 text-emerald-600 dark:text-emerald-400')}
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-300">Modo Balcão</span>
            </button>

            <!-- Alternador de Tema Claro / Escuro -->
            <button
              id="theme-toggle-btn"
              class="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer"
              title="Alternar Modo Claro / Modo Escuro"
            >
              ${this.isDark ? icons.sun('w-5 h-5') : icons.moon('w-5 h-5')}
            </button>

            <!-- Botão Nova Peça -->
            <button
              id="new-product-btn"
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-sm hover:shadow inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              ${icons.plus('w-4 h-4')}
              <span>Nova Peça</span>
            </button>

            <!-- Botão de Gestão, Backup & Auditoria de Balcão -->
            <button
              id="management-menu-btn"
              class="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer"
              title="Gestão, Backup, CSV, Lixeira e Auditoria de Balcão"
            >
              ${icons.database('w-5 h-5 text-red-600 dark:text-red-500')}
            </button>
          </div>
        </div>

        <!-- Filtros Rápidos de Montadora -->
        <div id="automakers-filter-container" class="bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200/80 dark:border-slate-800 px-4 py-2"></div>
      </header>

      <!-- Main Content Container -->
      <main class="max-w-7xl mx-auto px-4 py-6">
        <!-- Sub-header de contagem e status -->
        <div class="flex items-center justify-between mb-4 text-xs text-slate-500 dark:text-slate-400">
          <div id="stats-counter" class="font-medium">
            Carregando catálogo...
          </div>
          <div class="text-[11px] font-mono">
            Pressione <kbd class="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-slate-800 dark:text-slate-200 font-bold">/</kbd> para focar na busca
          </div>
        </div>

        <!-- Grid de Cards de Produtos -->
        <div id="products-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"></div>
      </main>
    `;

    this.renderAutomakersBar();
    this.bindEvents();
  }

  private renderAutomakersBar(): void {
    const container = document.getElementById('automakers-filter-container');
    if (!container) return;

    const rawAutomakers = Array.from(
      new Set(
        this.allProducts
          .filter(p => !p.isTrash)
          .flatMap(p => p.automakers || [])
      )
    );

    // Sanitiza montadoras descartando '0 <sem montadora>', categorias gerais e valores inválidos
    const automakers = Array.from(
      new Set(
        rawAutomakers
          .map(a => (a === 'CITRON' || a === 'CITRON' || a === 'CITROËN' ? 'Citroën' : a.trim()))
          .filter(a => {
            if (!a || a === 'Universal' || a === 'Uso Geral' || a === 'Garagista' || a === 'nibus' || a === 'Ônibus') return false;
            if (/^[0-9]/.test(a) || a.toLowerCase().includes('sem montadora')) return false;
            return a.length >= 2;
          })
      )
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const isFiltered = this.currentFilterAutomaker !== 'all';

    container.innerHTML = `
      <div class="max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto py-1 text-xs">
        <span class="font-bold text-slate-500 uppercase tracking-wider text-[10px] shrink-0">Montadora:</span>

        ${isFiltered ? `
          <!-- Botão para Desmarcar o Filtro Ativo e Voltar para Todas -->
          <button
            id="btn-clear-automaker-filter"
            type="button"
            class="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/80 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800 rounded-lg font-bold text-xs inline-flex items-center gap-1.5 transition shrink-0 cursor-pointer shadow-xs"
            title="Desmarcar ${this.currentFilterAutomaker} e voltar para Todas"
          >
            ${icons.x('w-3.5 h-3.5')}
            <span>Desmarcar (${this.currentFilterAutomaker})</span>
          </button>
        ` : ''}

        <button
          class="filter-automaker-btn px-2.5 py-1 rounded-lg font-medium transition shrink-0 cursor-pointer ${!isFiltered ? 'bg-blue-600 text-white font-bold shadow-xs' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'}"
          data-brand="all"
          title="Ver todas as montadoras"
        >
          Todas
        </button>

        ${automakers.map(a => {
          const isActive = this.currentFilterAutomaker === a;
          return `
            <button
              class="filter-automaker-btn px-2.5 py-1 rounded-lg font-medium transition shrink-0 cursor-pointer ${isActive ? 'bg-blue-600 text-white font-bold shadow-xs ring-2 ring-blue-400/40' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'}"
              data-brand="${a}"
              title="${isActive ? 'Clique para desmarcar' : `Filtrar por ${a}`}"
            >
              ${a}
            </button>
          `;
        }).join('')}
      </div>
    `;

    // Eventos da Barra de Montadoras
    container.querySelector('#btn-clear-automaker-filter')?.addEventListener('click', () => {
      this.currentFilterAutomaker = 'all';
      this.renderAutomakersBar();
      this.executeSearch();
    });

    container.querySelectorAll('.filter-automaker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const brand = btn.getAttribute('data-brand') || 'all';
        // Se clicar na montadora já ativa, desmarca e volta para 'all'
        if (this.currentFilterAutomaker === brand && brand !== 'all') {
          this.currentFilterAutomaker = 'all';
        } else {
          this.currentFilterAutomaker = brand;
        }
        this.renderAutomakersBar();
        this.executeSearch();
      });
    });
  }

  private bindEvents(): void {
    // 1. Busca Instantânea com Botão de Limpar
    const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
    const searchClearBtn = document.getElementById('search-clear-btn') as HTMLButtonElement | null;

    const updateClearButtonVisibility = () => {
      if (!searchClearBtn || !searchInput) return;
      if (searchInput.value.trim().length > 0) {
        searchClearBtn.classList.remove('hidden');
      } else {
        searchClearBtn.classList.add('hidden');
      }
    };

    searchInput?.addEventListener('input', () => {
      updateClearButtonVisibility();
      this.executeSearch();
    });

    searchClearBtn?.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      updateClearButtonVisibility();
      this.executeSearch();
    });

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value.length > 0) {
        e.preventDefault();
        searchInput.value = '';
        updateClearButtonVisibility();
        this.executeSearch();
      }
    });

    // 2. Foco rápido na busca com '/'
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      }
    });

    // 3. Alternador de Tema
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => this.toggleTheme());

    // 4. Alternador Modo Cliente
    document.getElementById('client-mode-btn')?.addEventListener('click', () => this.toggleClientMode());

    // 5. Nova Peça
    document.getElementById('new-product-btn')?.addEventListener('click', () => {
      productFormModal.open(null, async () => {
        await this.refreshData();
        this.executeSearch();
      });
    });

    // 6. Gestão, Backup & Auditoria de Balcão (Modal Completo Unificado)
    document.getElementById('management-menu-btn')?.addEventListener('click', () => {
      renderManagementModal({
        onClose: () => {},
        onDatabaseReload: async () => {
          await this.refreshData();
          this.renderAutomakersBar();
          this.executeSearch();
        },
      });
    });
  }

  private updateStats(): void {
    const pill = document.getElementById('benchmark-pill');
    if (pill) {
      pill.textContent = `${this.lastSearchTimeMs} ms`;
    }

    const counter = document.getElementById('stats-counter');
    if (counter) {
      const total = this.currentMatches.length;
      counter.innerHTML = `Mostrando <strong>${total}</strong> peças encontradas em <strong>${this.lastSearchTimeMs} ms</strong>`;
    }
  }

  private async renderProductsGrid(): Promise<void> {
    const grid = document.getElementById('products-grid');
    if (!grid) return;

    if (this.currentMatches.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-slate-400">
          <div class="inline-flex p-3 bg-slate-100 dark:bg-slate-800 rounded-full mb-3 text-slate-400">
            ${icons.search('w-8 h-8')}
          </div>
          <h3 class="text-base font-bold text-slate-700 dark:text-slate-300">Nenhuma peça encontrada</h3>
          <p class="text-xs text-slate-500 mt-1">Verifique o código ou tente buscar por modelo ou caixa da loja.</p>
        </div>
      `;
      return;
    }

    // Renderiza cards de forma assíncrona com suporte a galeria híbrida
    const cardsHtml = await Promise.all(
      this.currentMatches.slice(0, 100).map(async match => {
        const item = match.product;
        const inv = item.storeInventory;
        const displayItems = await ImageGallery.getDisplayItemsForProduct(item);
        const cardPreviewHtml = ImageGallery.renderCardPreview(displayItems, item.description || item.sku);

        const sellingFormatted = formatBRL(inv.sellingPriceCents);
        const costFormatted = formatBRL(inv.costPriceCents);

        // Vínculos
        const relations = relationsEngine.organizeRelations(item.sku, this.allRelations);
        const totalRelations =
          relations.equivalences.length +
          relations.couplings.length +
          relations.kits.length +
          relations.variants.length +
          relations.transitiveSuggestions.length;

        return `
          <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between group" data-product-id="${item.id}">
            <!-- Imagem e Previews -->
            ${cardPreviewHtml}

            <!-- Conteúdo Técnico do Card -->
            <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
              <div>
                <!-- Linha 1: SKU em Alta Proeminência Monospaçada + Caixa -->
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <span class="font-mono text-xl font-extrabold text-blue-700 dark:text-blue-400 tracking-tight">
                      ${item.sku}
                    </span>
                    <span class="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      ${item.brand}
                    </span>
                  </div>

                  ${inv.shelfLocation ? `
                    <div class="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg text-right shrink-0">
                      <span class="block text-[9px] font-bold text-slate-400 uppercase leading-none">CAIXA</span>
                      <span class="font-mono text-sm font-black text-slate-800 dark:text-slate-200 leading-none">
                        ${inv.shelfLocation}
                      </span>
                    </div>
                  ` : ''}
                </div>

                <!-- Descrição Técnica -->
                <p class="text-xs font-medium text-slate-800 dark:text-slate-200 mt-2 line-clamp-2 leading-relaxed" title="${item.description}">
                  ${item.description}
                </p>

                <!-- Aplicações e Montadoras -->
                ${(item.automakers && item.automakers.length > 0) ? `
                  <div class="flex flex-wrap gap-1 mt-2">
                    ${item.automakers.map(a => `
                      <span class="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                        ${a}
                      </span>
                    `).join('')}
                    ${(item.models && item.models.length > 0) ? `
                      <span class="text-[10px] text-slate-500 font-medium">
                        ${item.models.slice(0, 2).join(', ')}${item.models.length > 2 ? '...' : ''}
                      </span>
                    ` : ''}
                  </div>
                ` : ''}

                <!-- Códigos OEM -->
                ${(item.oemCodes && item.oemCodes.length > 0) ? `
                  <div class="mt-2 text-[10px] font-mono text-slate-500 truncate" title="OEM: ${item.oemCodes.join(', ')}">
                    OEM: <span class="font-bold text-slate-600 dark:text-slate-400">${item.oemCodes.slice(0, 2).join(', ')}</span>
                  </div>
                ` : ''}
              </div>

              <!-- Seção de Preços (Visível ou Oculta pelo Modo Cliente) -->
              <div class="pt-2 border-t border-slate-100 dark:border-slate-800">
                ${this.clientMode ? `
                  <div class="py-1 text-center bg-slate-100 dark:bg-slate-800/80 rounded-lg">
                    <span class="text-[11px] font-mono text-slate-400">Preço Oculto (Modo Cliente)</span>
                  </div>
                ` : `
                  <div class="flex items-baseline justify-between">
                    <div>
                      <span class="text-[10px] font-bold text-slate-400 uppercase block">Venda</span>
                      <span class="font-mono text-lg font-black text-emerald-600 dark:text-emerald-400">
                        ${sellingFormatted}
                      </span>
                    </div>
                    <div class="text-right">
                      <span class="text-[9px] font-semibold text-slate-400 uppercase block">Custo (-130%)</span>
                      <span class="font-mono text-xs text-slate-500 dark:text-slate-400">
                        ${costFormatted}
                      </span>
                    </div>
                  </div>
                `}

                <!-- Badge de Vínculos Multimarca -->
                ${totalRelations > 0 ? `
                  <div class="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 p-1.5 rounded-lg">
                    ${icons.link('w-3 h-3')}
                    <span>${totalRelations} vínculos (equivalentes / acoplamentos)</span>
                  </div>
                ` : ''}

                <!-- Botões de Ação do Card -->
                <div class="mt-3 flex items-center gap-2">
                  <button
                    class="btn-whatsapp flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition shadow-sm"
                    data-sku="${item.sku}"
                    data-desc="${item.description}"
                    data-shelf="${inv.shelfLocation}"
                    data-price="${this.clientMode ? '' : sellingFormatted}"
                    title="Copiar resumo formatado para o WhatsApp"
                  >
                    ${icons.whatsapp('w-3.5 h-3.5')}
                    <span>WhatsApp</span>
                  </button>

                  <button
                    class="btn-edit-product p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition"
                    data-id="${item.id}"
                    title="Editar Peça"
                  >
                    ${icons.edit('w-4 h-4')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      })
    );

    grid.innerHTML = cardsHtml.join('');

    // 1. Controles Interativos de Ângulos nos Cards (Chevrons < / > e Pontos Indicadores)
    grid.querySelectorAll<HTMLElement>('.card-preview-container').forEach(container => {
      const allUrlsJson = container.getAttribute('data-all-urls');
      if (!allUrlsJson) return;

      let urls: string[] = [];
      try {
        urls = JSON.parse(decodeURIComponent(allUrlsJson));
      } catch {
        urls = [];
      }
      if (urls.length <= 1) return;

      const img = container.querySelector<HTMLImageElement>('.card-preview-img');
      const badge = container.querySelector<HTMLElement>('.card-angle-badge');
      const dots = container.querySelectorAll<HTMLButtonElement>('.card-dot-btn');
      const prevBtn = container.querySelector<HTMLButtonElement>('.btn-card-prev-angle');
      const nextBtn = container.querySelector<HTMLButtonElement>('.btn-card-next-angle');

      const setAngle = (idx: number) => {
        let newIdx = idx;
        if (newIdx < 0) newIdx = urls.length - 1;
        if (newIdx >= urls.length) newIdx = 0;

        container.setAttribute('data-current-idx', String(newIdx));
        if (img) img.src = urls[newIdx];
        if (badge) badge.textContent = `${newIdx + 1} / ${urls.length}`;

        dots.forEach((dot, dIdx) => {
          if (dIdx === newIdx) {
            dot.className = 'card-dot-btn w-2.5 h-2 rounded-full transition-all cursor-pointer bg-blue-500 scale-125';
          } else {
            dot.className = 'card-dot-btn w-2 h-2 rounded-full transition-all cursor-pointer bg-slate-400/70 hover:bg-white';
          }
        });
      };

      prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cur = parseInt(container.getAttribute('data-current-idx') || '0', 10);
        setAngle(cur - 1);
      });

      nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cur = parseInt(container.getAttribute('data-current-idx') || '0', 10);
        setAngle(cur + 1);
      });

      dots.forEach((dot) => {
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const dotIdx = parseInt(dot.getAttribute('data-dot-idx') || '0', 10);
          setAngle(dotIdx);
        });
      });
    });

    // 2. Abertura do Lightbox com TODOS os Ângulos da Peça
    grid.querySelectorAll<HTMLElement>('.card-preview-container').forEach(container => {
      const img = container.querySelector<HTMLImageElement>('.card-preview-img');
      const allUrlsJson = container.getAttribute('data-all-urls');
      const title = container.getAttribute('data-title') || 'Visualização da Peça';

      const openLightboxForCard = () => {
        let urls: string[] = [];
        if (allUrlsJson) {
          try {
            urls = JSON.parse(decodeURIComponent(allUrlsJson));
          } catch {
            urls = [];
          }
        }
        if (urls.length === 0 && img?.src) {
          urls = [img.src];
        }
        const currentIdx = parseInt(container.getAttribute('data-current-idx') || '0', 10);
        lightbox.open(urls, title, currentIdx);
      };

      img?.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightboxForCard();
      });
    });

    grid.querySelectorAll('.btn-edit-product').forEach(btn => {
      btn.addEventListener('click', () => {
        const prodId = btn.getAttribute('data-id')!;
        const prod = this.allProducts.find(p => p.id === prodId);
        if (prod) {
          productFormModal.open(prod, async () => {
            await this.refreshData();
            this.executeSearch();
          });
        }
      });
    });

    grid.querySelectorAll('.btn-whatsapp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sku = btn.getAttribute('data-sku')!;
        const desc = btn.getAttribute('data-desc')!;
        const shelf = btn.getAttribute('data-shelf')!;
        const price = btn.getAttribute('data-price')!;

        let msg = `*Auto Peças Tucano*\n`;
        msg += `*Código:* ${sku}\n`;
        msg += `*Peça:* ${desc}\n`;
        if (shelf) msg += `*Localização:* Caixa ${shelf}\n`;
        if (price) msg += `*Preço:* ${price}\n`;

        navigator.clipboard.writeText(msg).then(() => {
          const originalText = btn.innerHTML;
          btn.innerHTML = `${icons.check('w-3.5 h-3.5')} <span>Copiado!</span>`;
          setTimeout(() => {
            btn.innerHTML = originalText;
          }, 1800);
        });
      });
    });
  }
}

// Inicializa Aplicação
const app = new App();
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
