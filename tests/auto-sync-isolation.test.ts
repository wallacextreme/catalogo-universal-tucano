import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import { CatalogStorage } from '../src/storage/indexeddb';
import { Product, StoreInventoryData } from '../src/domain/types';

describe('Gate 8 — Isolamento Inviolável da Loja & Auto-Sync Incremental', () => {
  let storage: CatalogStorage;

  beforeEach(async () => {
    storage = new CatalogStorage();
    await storage.resetDatabase();
  });

  it('deve sincronizar novas fotos e metadados de fábrica SEM JAMAIS alterar preços, prateleiras ou fotos manuais', async () => {
    // 1. O lojista cadastra ou importa a peça inicialmente
    const initialProduct: Product = {
      id: 'prod-20428',
      sku: '20428',
      skuNorm: '20428',
      brand: 'Universal',
      description: 'Descrição Original Antiga',
      automakers: ['Volkswagen'],
      models: ['Gol'],
      yearRanges: [{ yearStart: 1980, yearEnd: 1994, isOngoing: false }],
      oemCodes: [],
      technicalSpecs: {},
      staticImageUrls: ['/catalog-images/universal/20428.webp'],
      removedStaticUrls: ['/catalog-images/universal/foto_antiga_ruim.webp'],
      imageAssetIds: ['manual-asset-loja-001'], // Foto tirada na loja com celular
    };

    const customizedStoreInventory: StoreInventoryData = {
      productId: 'prod-20428',
      shelfLocation: 'PRAT-ESPECIAL-A3',
      sellingPriceCents: 4500, // Preço customizado pelo lojista (R$ 45,00)
      costPriceCents: 1957,    // Custo customizado (R$ 19,57)
      stockQuantity: 15,
      internalNotes: 'Comprado do lote especial de novembro',
    };

    await storage.saveProductWithInventory(initialProduct, customizedStoreInventory);

    // 2. Um novo seed de fábrica chega (ex: scraping atualizado do Playwright com novos ângulos e descrição nova)
    const incomingFactorySeed = [
      {
        id: 'prod-20428',
        sku: '20428',
        brand: 'Universal Soluções',
        description: 'Alavanca Lingueta Dobrada Oficial Nova Descrição Rica 2026',
        automakers: ['Volkswagen', 'Uso Geral'],
        models: ['Gol', 'Parati', 'Passat'],
        staticImageUrls: [
          '/catalog-images/universal/20428.webp',
          '/catalog-images/universal/20428_2.webp', // Novo ângulo _2
          '/catalog-images/universal/20428_3.webp', // Novo ângulo _3
          '/catalog-images/universal/foto_antiga_ruim.webp', // Foto que o lojista removeu antes
        ],
        // Dados de fábrica que tentam vir com preço padrão sugerido
        shelfLocation: '000',
        sellingPriceCents: 1500,
        costPriceCents: 652,
      },
    ];

    // Executa a Sincronização Não-Destrutiva
    const syncResult = await storage.autoSeedFromMasterJson(incomingFactorySeed);
    expect(syncResult.synced).toBe(1);

    // 3. Verificações de Isolamento Inviolável (Gate 8):
    const currentData = await storage.getProductById('prod-20428');
    expect(currentData).not.toBeNull();

    // A. Preços e localização da loja DEVEM PERMANECER INTACTOS!
    expect(currentData?.storeInventory.shelfLocation).toBe('PRAT-ESPECIAL-A3');
    expect(currentData?.storeInventory.sellingPriceCents).toBe(4500);
    expect(currentData?.storeInventory.costPriceCents).toBe(1957);
    expect(currentData?.storeInventory.stockQuantity).toBe(15);
    expect(currentData?.storeInventory.internalNotes).toBe('Comprado do lote especial de novembro');

    // B. Fotos manuais subidas pelo lojista DEVEM PERMANECER INTACTAS!
    expect(currentData?.imageAssetIds).toContain('manual-asset-loja-001');

    // C. Fotos de fábrica que o lojista ocultou NÃO PODEM REAPARECER!
    expect(currentData?.staticImageUrls).not.toContain('/catalog-images/universal/foto_antiga_ruim.webp');

    // D. Novos ângulos da fábrica DEVEM SER INCORPORADOS com sucesso!
    expect(currentData?.staticImageUrls).toContain('/catalog-images/universal/20428_2.webp');
    expect(currentData?.staticImageUrls).toContain('/catalog-images/universal/20428_3.webp');

    // E. A descrição técnica e modelos foram enriquecidos!
    expect(currentData?.description).toContain('Oficial Nova Descrição');
    expect(currentData?.models).toContain('Passat');
  });
});
