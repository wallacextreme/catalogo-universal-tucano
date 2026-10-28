import { storage } from '../storage/indexeddb';
import { BackupPayload, ProductWithInventory } from '../domain/types';
import { formatBRL, parseBRL, calculateCostFromSelling } from '../domain/currency';
import { icons } from './icons';

export class BackupRestoreManager {
  /**
   * Exporta arquivo de backup JSON criptograficamente auditado via SHA-256.
   */
  public static async exportBackupFile(): Promise<void> {
    const backup: BackupPayload = await storage.exportFullBackup();
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_catalogo_tucano_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Restaura arquivo de backup com validação de Checksum SHA-256.
   */
  public static async restoreBackupFromFile(file: File): Promise<boolean> {
    const text = await file.text();
    const backup: BackupPayload = JSON.parse(text);

    if (!backup.sha256Checksum || !backup.products || !backup.storeInventories) {
      throw new Error('Arquivo de backup inválido ou incompatível.');
    }

    return await storage.restoreFullBackup(backup);
  }

  /**
   * Exporta tabela CSV de Preços e Estoque da Loja.
   */
  public static async exportInventoryCsv(): Promise<void> {
    const products: ProductWithInventory[] = await storage.getAllProductsWithInventory();
    const headers = ['SKU', 'Marca', 'Descricao', 'Prateleira_Caixa', 'Preco_Venda', 'Preco_Custo', 'Estoque'];
    const rows = products.map(p => {
      const inv = p.storeInventory;
      return [
        `"${p.sku}"`,
        `"${p.brand}"`,
        `"${(p.description || '').replace(/"/g, '""')}"`,
        `"${inv.shelfLocation}"`,
        `"${formatBRL(inv.sellingPriceCents)}"`,
        `"${formatBRL(inv.costPriceCents)}"`,
        inv.stockQuantity.toString(),
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `inventario_tucano_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Importa CSV atualizando preços e prateleiras.
   */
  public static async importInventoryCsv(file: File): Promise<number> {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return 0;

    let updatedCount = 0;
    const allProducts = await storage.getAllProductsWithInventory();
    const productBySku = new Map<string, ProductWithInventory>();
    for (const p of allProducts) {
      productBySku.set(p.sku.toUpperCase(), p);
    }

    // Pula header
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(';').map(col => col.replace(/^"|"$/g, '').trim());
      if (parts.length >= 5) {
        const sku = parts[0].toUpperCase();
        const shelf = parts[3];
        const sellingPriceStr = parts[4];
        const costPriceStr = parts[5];
        const stockStr = parts[6];

        const prod = productBySku.get(sku);
        if (prod) {
          const inv = prod.storeInventory;
          if (shelf) inv.shelfLocation = shelf;
          if (sellingPriceStr) {
            inv.sellingPriceCents = Number(parseBRL(sellingPriceStr));
            inv.costPriceCents = costPriceStr ? Number(parseBRL(costPriceStr)) : Number(calculateCostFromSelling(inv.sellingPriceCents));
          }
          if (stockStr && !isNaN(parseInt(stockStr, 10))) {
            inv.stockQuantity = parseInt(stockStr, 10);
          }
          await storage.saveProductWithInventory(prod, inv);
          updatedCount++;
        }
      }
    }

    await storage.addAuditLog('IMPORT_CSV', 'Inventory', `Importação CSV concluída com ${updatedCount} itens atualizados.`);
    return updatedCount;
  }

  /**
   * Modal de Trilha de Auditoria (Audit Logs).
   */
  public static async openAuditLogsModal(): Promise<void> {
    const logs = await storage.getAuditLogs();
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';

    overlay.innerHTML = `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden my-8 animate-fadeIn flex flex-col max-h-[85vh]">
        <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
          <div class="flex items-center gap-2">
            <span class="p-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg">
              ${icons.database('w-5 h-5')}
            </span>
            <h2 class="text-lg font-bold text-slate-900 dark:text-white">Trilha de Auditoria do Balcão</h2>
          </div>
          <button id="audit-close-btn" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            ${icons.close('w-6 h-6')}
          </button>
        </div>

        <div class="p-6 overflow-y-auto flex-1 space-y-3 font-sans">
          ${logs.length === 0 ? `
            <div class="text-center py-8 text-slate-400 text-sm">Nenhum evento registrado ainda.</div>
          ` : `
            <div class="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              ${logs.map(l => `
                <div class="py-2.5 flex items-start justify-between gap-4">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                        l.action === 'CREATE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' :
                        l.action === 'DELETE' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
                      }">${l.action}</span>
                      <span class="font-semibold text-slate-800 dark:text-slate-200">${l.entity}</span>
                    </div>
                    <p class="text-xs text-slate-600 dark:text-slate-400 mt-0.5">${l.details}</p>
                  </div>
                  <span class="text-[11px] font-mono text-slate-400 whitespace-nowrap">
                    ${new Date(l.timestamp).toLocaleString('pt-BR')}
                  </span>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#audit-close-btn')!.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
  }
}
