import { icons } from './icons';
import { storage } from '../storage/indexeddb';
import { BackupRestoreManager } from './backup-restore';
import { formatBRL } from '../domain/currency';
import { AuditLog, ProductWithInventory } from '../domain/types';
import seedData from '../data/catalog-master-seed.json';

export interface ManagementModalProps {
  onClose: () => void;
  onDatabaseReload: () => void;
}

export async function renderManagementModal(props: ManagementModalProps): Promise<void> {
  const existing = document.getElementById('management-modal-root');
  if (existing) existing.remove();

  const root = document.createElement('div');
  root.id = 'management-modal-root';
  root.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn select-none';

  let activeTab: 'reajuste' | 'backup' | 'csv' | 'trash' | 'audit' = 'reajuste';
  let auditLogs: AuditLog[] = await storage.getRecentAuditLogs(50);
  let trashProducts: ProductWithInventory[] = await storage.getTrashProducts();
  let allActiveProducts: ProductWithInventory[] = await storage.getAllProductsWithInventory(false);

  let currentMarkupPct = 30.0;
  let currentReajusteMode: 'markupOnCost' | 'percentOnPrice' = 'markupOnCost';

  // Amostra real de produtos para simulação em tempo real
  const sampleProducts = allActiveProducts.slice(0, 6).map(p => ({
    name: p.description || p.sku,
    sku: p.sku,
    cost: (p.storeInventory.costPriceCents || 0) / 100,
    currentSale: (p.storeInventory.sellingPriceCents || 0) / 100,
  }));

  function renderContent(): void {
    const totalCount = allActiveProducts.length;

    root.innerHTML = `
      <div class="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden my-auto font-sans">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <div class="flex items-center gap-3">
            <span class="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-red-600 dark:text-red-500">
              ${icons.database('w-5 h-5')}
            </span>
            <div>
              <h2 class="text-base font-bold text-slate-900 dark:text-white">Gestão, Backup & Auditoria de Balcão</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">Controle completo de integridade local, planilhas CSV e logs</p>
            </div>
          </div>
          <button id="btn-mgmt-close" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition">
            ${icons.close('w-5 h-5')}
          </button>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex items-center gap-2 px-6 pt-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold overflow-x-auto">
          <button class="tab-btn px-4 py-2 border-b-2 cursor-pointer transition-colors flex items-center gap-1.5 shrink-0 ${
            activeTab === 'reajuste'
              ? 'border-red-600 text-red-600 dark:text-red-400 font-bold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }" data-tab="reajuste">
            ${icons.tag('w-3.5 h-3.5')}
            <span>Reajuste em Massa (Markup & Preços)</span>
          </button>

          <button class="tab-btn px-4 py-2 border-b-2 cursor-pointer transition-colors shrink-0 ${
            activeTab === 'backup'
              ? 'border-red-600 text-red-600 dark:text-red-400 font-bold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }" data-tab="backup">
            Backup Criptográfico (SHA-256)
          </button>

          <button class="tab-btn px-4 py-2 border-b-2 cursor-pointer transition-colors shrink-0 ${
            activeTab === 'csv'
              ? 'border-red-600 text-red-600 dark:text-red-400 font-bold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }" data-tab="csv">
            Estoque & Preços (CSV)
          </button>

          <button class="tab-btn px-4 py-2 border-b-2 cursor-pointer transition-colors flex items-center gap-1.5 shrink-0 ${
            activeTab === 'trash'
              ? 'border-red-600 text-red-600 dark:text-red-400 font-bold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }" data-tab="trash">
            <span>Lixeira</span>
            ${trashProducts.length > 0 ? `<span class="px-1.5 py-0.2 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 text-[10px] rounded-full">${trashProducts.length}</span>` : ''}
          </button>

          <button class="tab-btn px-4 py-2 border-b-2 cursor-pointer transition-colors shrink-0 ${
            activeTab === 'audit'
              ? 'border-red-600 text-red-600 dark:text-red-400 font-bold'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }" data-tab="audit">
            Trilha de Auditoria
          </button>
        </div>

        <!-- Tab Contents -->
        <div class="flex-1 overflow-y-auto p-6">
          
          <!-- TAB 0: REAJUSTE EM MASSA (MARKUP & PREÇOS) -->
          ${
            activeTab === 'reajuste'
              ? `
            <div class="space-y-6">
              <div class="p-5 bg-gradient-to-br from-slate-50 to-red-50/30 dark:from-slate-800/60 dark:to-red-950/20 rounded-2xl border border-slate-200 dark:border-slate-800">
                <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div class="flex items-center gap-2.5">
                    <span class="p-2.5 rounded-xl bg-red-600 text-white shadow-md shadow-red-600/30">
                      ${icons.tag('w-5 h-5')}
                    </span>
                    <div>
                      <h3 class="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-tight">
                        Reajuste Global de Preços & Markup em Massa
                      </h3>
                      <p class="text-xs text-slate-500 dark:text-slate-400">
                        Altere a margem de lucro e os preços de todos os ${totalCount} produtos do balcão de uma só vez
                      </p>
                    </div>
                  </div>
                  <span class="px-3 py-1 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 text-xs font-bold rounded-xl flex items-center gap-1">
                    ${icons.sparkles('w-3.5 h-3.5')} Sub-50ms Atômico
                  </span>
                </div>

                <!-- Modo de Reajuste -->
                <div class="mt-4 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                  <label class="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Modo de Aplicação:
                  </label>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      currentReajusteMode === 'markupOnCost'
                        ? 'bg-red-50/70 dark:bg-red-950/30 border-red-500 ring-1 ring-red-500'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }" id="label-mode-cost">
                      <input type="radio" name="reajuste-mode" value="markupOnCost" ${
                        currentReajusteMode === 'markupOnCost' ? 'checked' : ''
                      } class="mt-0.5 text-red-600 cursor-pointer" />
                      <div>
                        <span class="text-xs font-bold text-slate-900 dark:text-white block">Markup sobre Preço de Custo (Recomendado)</span>
                        <span class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug block mt-0.5">Recalcula os preços de venda aplicando o Markup sobre o custo de cada produto (Preço = Custo × (1 + Markup%))</span>
                      </div>
                    </label>

                    <label class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      currentReajusteMode === 'percentOnPrice'
                        ? 'bg-red-50/70 dark:bg-red-950/30 border-red-500 ring-1 ring-red-500'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }" id="label-mode-price">
                      <input type="radio" name="reajuste-mode" value="percentOnPrice" ${
                        currentReajusteMode === 'percentOnPrice' ? 'checked' : ''
                      } class="mt-0.5 text-red-600 cursor-pointer" />
                      <div>
                        <span class="text-xs font-bold text-slate-900 dark:text-white block">Reajuste Linear sobre Preço Atual</span>
                        <span class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug block mt-0.5">Aumenta ou reduz o preço de venda atual de todos os produtos na porcentagem informada (ex: inflação ou reajuste de tabela)</span>
                      </div>
                    </label>
                  </div>
                </div>

                <!-- Valor da Porcentagem & Atalhos Rápidos -->
                <div class="mt-4 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <label class="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                      Porcentagem do Reajuste (%):
                    </label>
                    <span class="text-xs text-slate-500 dark:text-slate-400">Ex: 30% = +30% sobre o custo</span>
                  </div>

                  <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div class="relative max-w-xs w-full">
                      <input
                        type="number"
                        step="0.5"
                        id="global-markup-input"
                        value="${currentMarkupPct.toFixed(1)}"
                        class="w-full text-xl font-black bg-slate-50 dark:bg-slate-900 border-2 border-red-500/50 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                      />
                      <span class="absolute right-4 top-3 font-bold text-slate-400">%</span>
                    </div>

                    <!-- Botões de Atalho Rápido -->
                    <div class="flex flex-wrap items-center gap-1.5 flex-1">
                      ${['20', '25', '30', '35', '40', '50', '100']
                        .map(
                          (pct) => `
                        <button type="button" class="btn-quick-pct px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-red-600 hover:text-white text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm" data-pct="${pct}">
                          +${pct}%
                        </button>
                      `
                        )
                        .join('')}
                    </div>
                  </div>
                </div>

                <!-- Simulador de Prévia em Tempo Real -->
                <div class="mt-4 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 uppercase">
                      ${icons.eye('w-3.5 h-3.5 text-red-600')} Simulação em Tempo Real (Amostra de Produtos):
                    </span>
                    <span class="text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">Total no Catálogo: ${totalCount} produtos</span>
                  </div>

                  <div id="reajuste-preview-table" class="space-y-2 text-xs">
                    <!-- Gerado dinamicamente -->
                  </div>
                </div>

                <!-- Botão de Confirmação e Aplicação -->
                <div class="mt-5 flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                  <div id="reajuste-status-msg" class="text-xs font-bold"></div>
                  <button
                    id="btn-apply-global-markup"
                    type="button"
                    class="w-full sm:w-auto px-6 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black shadow-lg shadow-red-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    ${icons.check('w-4 h-4')}
                    <span>Aplicar Reajuste em Todos os Produtos (${totalCount} Peças)</span>
                  </button>
                </div>

              </div>
            </div>
          `
              : ''
          }

          <!-- TAB 1: BACKUP SHA-256 -->
          ${
            activeTab === 'backup'
              ? `
            <div class="space-y-6">
              <div class="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800">
                <div class="flex items-center gap-2 mb-2">
                  ${icons.shieldCheck('w-5 h-5 text-emerald-600')}
                  <h3 class="text-sm font-bold text-slate-900 dark:text-white">Exportação Segura de Dados (SHA-256)</h3>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                  Exporta toda a base de produtos, imagens customizadas e o inventário de balcão (preços, estoque e localização) em um arquivo JSON assinado com hash de integridade SHA-256.
                </p>
                <button id="btn-export-backup" class="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20 cursor-pointer">
                  ${icons.download('w-4 h-4')} Baixar Arquivo de Backup Criptografado
                </button>
              </div>

              <div class="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800">
                <h3 class="text-sm font-bold text-slate-900 dark:text-white mb-2">Restaurar Backup</h3>
                <p class="text-xs text-slate-600 dark:text-slate-300 mb-4">
                  Selecione um arquivo de backup (.json) para restaurar todos os produtos e inventário no banco local.
                </p>
                <input type="file" id="backup-file-input" accept=".json" class="hidden" />
                <button id="btn-trigger-import-backup" class="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 cursor-pointer">
                  ${icons.upload('w-4 h-4')} Selecionar Arquivo JSON de Backup
                </button>
                <div id="backup-status-msg" class="mt-3 text-xs hidden"></div>
              </div>

              <div class="p-4 bg-red-50/50 dark:bg-red-950/20 rounded-2xl border border-red-200 dark:border-red-900/50">
                <h3 class="text-sm font-bold text-red-700 dark:text-red-400 mb-1">Restauração de Fábrica (Preservando Estoque)</h3>
                <p class="text-xs text-slate-600 dark:text-slate-400 mb-3">
                  Recarrega todos os 766 produtos oficiais do catálogo Universal Tucano diretamente do arquivo mestre, mas preserva 100% dos seus preços, quantidades de estoque e localizações de balcão atuais.
                </p>
                <button id="btn-factory-reset" class="flex items-center gap-2 px-4 py-2 bg-red-600/90 hover:bg-red-700 text-white rounded-xl text-xs font-semibold cursor-pointer">
                  ${icons.refresh('w-4 h-4')} Restaurar Catálogo Original
                </button>
              </div>
            </div>
          `
              : ''
          }

          <!-- TAB 2: CSV ESTOQUE & PREÇOS -->
          ${
            activeTab === 'csv'
              ? `
            <div class="space-y-6">
              <div class="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800">
                <h3 class="text-sm font-bold text-slate-900 dark:text-white mb-2">Exportar Tabela de Estoque em CSV</h3>
                <p class="text-xs text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                  Baixe uma planilha compatível com Microsoft Excel, LibreOffice e Google Sheets com todos os SKUs, preços de balcão e quantidades em estoque para auditoria física de prateleira.
                </p>
                <button id="btn-export-csv" class="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer">
                  ${icons.download('w-4 h-4')} Exportar Planilha CSV
                </button>
              </div>

              <div class="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800">
                <h3 class="text-sm font-bold text-slate-900 dark:text-white mb-2">Importar Atualização em Lote (CSV)</h3>
                <p class="text-xs text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                  Importe uma planilha CSV editada com novas quantidades de estoque, novos preços e localizações físicas para atualizar todos os itens de uma só vez.
                </p>
                <input type="file" id="csv-file-input" accept=".csv" class="hidden" />
                <button id="btn-trigger-import-csv" class="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 cursor-pointer">
                  ${icons.upload('w-4 h-4')} Selecionar Planilha CSV
                </button>
                <div id="csv-status-msg" class="mt-3 text-xs hidden"></div>
              </div>
            </div>
          `
              : ''
          }

          <!-- TAB 3: LIXEIRA -->
          ${
            activeTab === 'trash'
              ? `
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-slate-500 uppercase">Itens na Lixeira (${trashProducts.length})</span>
              </div>

              ${
                trashProducts.length > 0
                  ? `
                <div class="space-y-2">
                  ${trashProducts
                    .map(
                      (p) => `
                    <div class="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
                      <div>
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-xs font-bold text-red-600">${p.sku}</span>
                          <span class="text-xs font-semibold text-slate-900 dark:text-white">${p.description}</span>
                        </div>
                        <span class="text-[11px] text-slate-400 font-mono">Preço: ${formatBRL(p.storeInventory.sellingPriceCents)} | Caixa: ${p.storeInventory.shelfLocation}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <button class="btn-restore-item px-3 py-1.5 text-xs font-bold bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-white rounded-lg cursor-pointer" data-id="${p.id}">
                          Restaurar
                        </button>
                        <button class="btn-hard-delete-item px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer" data-id="${p.id}" data-sku="${p.sku}">
                          Excluir Definitivo
                        </button>
                      </div>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              `
                  : `
                <div class="py-12 text-center text-xs text-slate-400">
                  <div class="w-10 h-10 mx-auto mb-2 opacity-30 flex items-center justify-center">
                    ${icons.trash('w-8 h-8')}
                  </div>
                  A lixeira está vazia. Nenhum item foi excluído.
                </div>
              `
              }
            </div>
          `
              : ''
          }

          <!-- TAB 4: TRILHA DE AUDITORIA -->
          ${
            activeTab === 'audit'
              ? `
            <div class="space-y-3">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-bold text-slate-500 uppercase">Últimas 50 Operações Registradas</span>
              </div>

              <div class="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-50 dark:bg-slate-800/80 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th class="p-3">Data / Hora</th>
                      <th class="p-3">Ação</th>
                      <th class="p-3">Entidade</th>
                      <th class="p-3">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    ${auditLogs
                      .map(
                        (log) => `
                      <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                        <td class="p-3 text-slate-400 font-sans">${new Date(log.timestamp).toLocaleString('pt-BR')}</td>
                        <td class="p-3">
                          <span class="px-2 py-0.5 rounded-md font-bold text-[10px] ${
                            log.action === 'CREATE'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                              : log.action === 'DELETE'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-400'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-400'
                          }">
                            ${log.action}
                          </span>
                        </td>
                        <td class="p-3 font-bold text-blue-600 dark:text-blue-400">${log.entity}</td>
                        <td class="p-3 font-sans text-slate-600 dark:text-slate-300">${log.details}</td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `
              : ''
          }

        </div>

      </div>
    `;

    // Bindings de Abas
    root.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab') as typeof activeTab;
        renderContent();
      });
    });

    const closeBtn = root.querySelector('#btn-mgmt-close');
    closeBtn?.addEventListener('click', () => {
      root.remove();
      props.onClose();
    });

    // Reajuste em Massa Bindings
    if (activeTab === 'reajuste') {
      const globalInput = root.querySelector<HTMLInputElement>('#global-markup-input');
      const previewTable = root.querySelector<HTMLElement>('#reajuste-preview-table');
      const applyBtn = root.querySelector<HTMLButtonElement>('#btn-apply-global-markup');
      const statusMsg = root.querySelector<HTMLElement>('#reajuste-status-msg');

      function updatePreview() {
        if (!previewTable) return;
        const pct = parseFloat(globalInput?.value || '0');
        currentMarkupPct = pct;

        previewTable.innerHTML = `
          <div class="grid grid-cols-12 gap-2 pb-1.5 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-400 uppercase">
            <span class="col-span-4">Produto</span>
            <span class="col-span-2 text-right">Custo Loja</span>
            <span class="col-span-2 text-right">Preço Atual</span>
            <span class="col-span-2 text-right text-emerald-600 dark:text-emerald-400">Novo Preço</span>
            <span class="col-span-2 text-right text-indigo-600 dark:text-indigo-400">Nova Margem</span>
          </div>
          ${sampleProducts
            .map((p) => {
              let newSale = 0;
              if (currentReajusteMode === 'markupOnCost') {
                newSale = Math.round(p.cost * (1 + pct / 100) * 100) / 100;
              } else {
                newSale = Math.round(p.currentSale * (1 + pct / 100) * 100) / 100;
              }
              const margin = newSale > 0 ? Math.round(((newSale - p.cost) / newSale) * 10000) / 100 : 0;
              return `
                <div class="grid grid-cols-12 gap-2 items-center py-1.5 border-b border-slate-100 dark:border-slate-800 text-xs">
                  <span class="col-span-4 font-semibold text-slate-800 dark:text-slate-200 truncate" title="${p.name}">
                    <strong class="font-mono text-blue-600 dark:text-blue-400 mr-1">${p.sku}</strong> ${p.name}
                  </span>
                  <span class="col-span-2 text-right text-slate-500 font-mono">R$ ${p.cost.toFixed(2)}</span>
                  <span class="col-span-2 text-right text-slate-400 font-mono line-through">R$ ${p.currentSale.toFixed(2)}</span>
                  <span class="col-span-2 text-right font-bold text-emerald-600 dark:text-emerald-400 font-mono">R$ ${newSale.toFixed(2)}</span>
                  <span class="col-span-2 text-right font-bold text-indigo-600 dark:text-indigo-400 font-mono">${margin.toFixed(1)}%</span>
                </div>
              `;
            })
            .join('')}
        `;
      }

      updatePreview();

      globalInput?.addEventListener('input', () => {
        updatePreview();
      });

      root.querySelectorAll('.btn-quick-pct').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pct = btn.getAttribute('data-pct');
          if (pct && globalInput) {
            globalInput.value = parseFloat(pct).toFixed(1);
            updatePreview();
          }
        });
      });

      root.querySelectorAll('input[name="reajuste-mode"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          currentReajusteMode = (e.target as HTMLInputElement).value as typeof currentReajusteMode;
          renderContent();
        });
      });

      applyBtn?.addEventListener('click', async () => {
        const pct = parseFloat(globalInput?.value || '0');
        if (isNaN(pct)) return;

        const confirmMsg =
          currentReajusteMode === 'markupOnCost'
            ? `Confirma aplicar o Markup de ${pct >= 0 ? '+' : ''}${pct}% sobre o preço de custo em TODOS os ${totalCount} produtos do catálogo?`
            : `Confirma aplicar o reajuste linear de ${pct >= 0 ? '+' : ''}${pct}% sobre o preço de venda atual de TODOS os ${totalCount} produtos?`;

        if (!confirm(confirmMsg)) return;

        applyBtn.disabled = true;
        applyBtn.classList.add('opacity-50');
        if (statusMsg) {
          statusMsg.className = 'text-xs text-blue-600 font-bold';
          statusMsg.textContent = 'Processando reajuste global em lote...';
        }

        const res = await storage.applyGlobalMarkupOrPriceAdjustment({
          mode: currentReajusteMode,
          percent: pct,
        });

        if (statusMsg) {
          statusMsg.className = 'text-xs text-emerald-600 font-bold';
          statusMsg.textContent = `Sucesso! Preços de ${res.updatedCount} produtos foram reajustados com ${currentReajusteMode === 'markupOnCost' ? 'Markup' : 'Ajuste'} de ${pct >= 0 ? '+' : ''}${pct}%.`;
        }

        allActiveProducts = await storage.getAllProductsWithInventory(false);
        props.onDatabaseReload();
        applyBtn.disabled = false;
        applyBtn.classList.remove('opacity-50');
        updatePreview();
      });
    }

    // Backup actions
    const exportBackupBtn = root.querySelector('#btn-export-backup');
    exportBackupBtn?.addEventListener('click', async () => {
      await BackupRestoreManager.exportBackupFile();
    });

    const triggerImportBackupBtn = root.querySelector('#btn-trigger-import-backup');
    const backupFileInput = root.querySelector<HTMLInputElement>('#backup-file-input');
    const backupStatusMsg = root.querySelector<HTMLElement>('#backup-status-msg');

    triggerImportBackupBtn?.addEventListener('click', () => backupFileInput?.click());
    backupFileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        if (backupStatusMsg) {
          backupStatusMsg.className = 'mt-3 text-xs text-blue-600 block';
          backupStatusMsg.textContent = 'Processando e validando integridade SHA-256...';
        }
        try {
          const success = await BackupRestoreManager.restoreBackupFromFile(file);
          if (backupStatusMsg) {
            backupStatusMsg.className = `mt-3 text-xs font-bold block ${success ? 'text-emerald-600' : 'text-red-600'}`;
            backupStatusMsg.textContent = success ? 'Backup restaurado com sucesso!' : 'Falha na validação do backup.';
          }
          if (success) {
            allActiveProducts = await storage.getAllProductsWithInventory(false);
            trashProducts = await storage.getTrashProducts();
            auditLogs = await storage.getRecentAuditLogs(50);
            props.onDatabaseReload();
            setTimeout(() => renderContent(), 1200);
          }
        } catch (err: any) {
          if (backupStatusMsg) {
            backupStatusMsg.className = 'mt-3 text-xs font-bold text-red-600 block';
            backupStatusMsg.textContent = err.message || 'Erro ao restaurar backup.';
          }
        }
      }
    });

    const factoryResetBtn = root.querySelector('#btn-factory-reset');
    factoryResetBtn?.addEventListener('click', async () => {
      if (confirm('Deseja recarregar o catálogo oficial Universal Tucano? Seus preços e estoques atuais serão preservados.')) {
        await storage.resetToFactorySeedPreservingStore(seedData);
        allActiveProducts = await storage.getAllProductsWithInventory(false);
        props.onDatabaseReload();
        alert('Catálogo de fábrica restaurado com sucesso!');
        renderContent();
      }
    });

    // CSV actions
    const exportCsvBtn = root.querySelector('#btn-export-csv');
    exportCsvBtn?.addEventListener('click', async () => {
      await BackupRestoreManager.exportInventoryCsv();
    });

    const triggerImportCsvBtn = root.querySelector('#btn-trigger-import-csv');
    const csvFileInput = root.querySelector<HTMLInputElement>('#csv-file-input');
    const csvStatusMsg = root.querySelector<HTMLElement>('#csv-status-msg');

    triggerImportCsvBtn?.addEventListener('click', () => csvFileInput?.click());
    csvFileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const updatedCount = await BackupRestoreManager.importInventoryCsv(file);
          if (csvStatusMsg) {
            csvStatusMsg.className = 'mt-3 text-xs text-emerald-600 font-bold block';
            csvStatusMsg.textContent = `Sucesso! ${updatedCount} itens atualizados com base no CSV.`;
          }
          allActiveProducts = await storage.getAllProductsWithInventory(false);
          props.onDatabaseReload();
        } catch (err: any) {
          if (csvStatusMsg) {
            csvStatusMsg.className = 'mt-3 text-xs text-red-600 font-bold block';
            csvStatusMsg.textContent = `Erro ao importar CSV: ${err.message}`;
          }
        }
      }
    });

    // Trash actions
    root.querySelectorAll('.btn-restore-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          await storage.restoreProductFromTrash(id);
          trashProducts = await storage.getTrashProducts();
          allActiveProducts = await storage.getAllProductsWithInventory(false);
          props.onDatabaseReload();
          renderContent();
        }
      });
    });

    root.querySelectorAll('.btn-hard-delete-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const sku = btn.getAttribute('data-sku');
        if (id && confirm(`Excluir permanentemente o produto ${sku}? Esta ação não pode ser desfeita.`)) {
          await storage.hardDeleteProduct(id);
          trashProducts = await storage.getTrashProducts();
          allActiveProducts = await storage.getAllProductsWithInventory(false);
          props.onDatabaseReload();
          renderContent();
        }
      });
    });
  }

  renderContent();
  document.body.appendChild(root);
}
