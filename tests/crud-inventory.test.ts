import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import { CatalogStorage } from '../src/storage/indexeddb';
import { Product, StoreInventoryData } from '../src/domain/types';

describe('CRUD Completo e Gestão de Inventário da Loja (Gate 7)', () => {
  let storage: CatalogStorage;

  beforeEach(async () => {
    storage = new CatalogStorage();
    await storage.resetDatabase();
  });

  it('deve cadastrar uma nova peça com dados técnicos e inventário de loja', async () => {
    const prod: Product = {
      id: 'prod-20428',
      sku: '20428',
      skuNorm: '20428',
      brand: 'Universal',
      description: 'Alavanca Acionamento Fechadura Gol',
      category: 'Fechaduras',
      automakers: ['Volkswagen'],
      models: ['Gol', 'Parati'],
      yearRanges: [{ yearStart: 1980, yearEnd: 1994, isOngoing: false }],
      oemCodes: ['305.827.505.1'],
      technicalSpecs: {},
      staticImageUrls: ['/catalog-images/universal/20428.webp'],
      removedStaticUrls: [],
      imageAssetIds: [],
      isTrash: false,
    };

    const inv: StoreInventoryData = {
      productId: 'prod-20428',
      shelfLocation: '548',
      sellingPriceCents: 1500, // R$ 15,00
      costPriceCents: 652,     // R$ 6,52 (-130% markup)
      stockQuantity: 10,
    };

    await storage.saveProductWithInventory(prod, inv);

    const fetched = await storage.getProductById('prod-20428');
    expect(fetched).not.toBeNull();
    expect(fetched?.sku).toBe('20428');
    expect(fetched?.storeInventory.shelfLocation).toBe('548');
    expect(fetched?.storeInventory.sellingPriceCents).toBe(1500);
    expect(fetched?.storeInventory.costPriceCents).toBe(652);
    expect(fetched?.storeInventory.stockQuantity).toBe(10);
  });

  it('deve duplicar um produto gerando novo SKU e mantendo histórico', async () => {
    const prod: Product = {
      id: 'prod-70419',
      sku: '70419',
      skuNorm: '70419',
      brand: 'Universal',
      description: 'Alça Capô Palio',
      category: 'Maçanetas',
      automakers: ['Fiat'],
      models: ['Palio', 'Strada'],
      yearRanges: [{ yearStart: 1996, yearEnd: 2026, isOngoing: true }],
      oemCodes: [],
      technicalSpecs: {},
      staticImageUrls: ['/catalog-images/universal/70419.webp'],
      isTrash: false,
    };

    const inv: StoreInventoryData = {
      productId: 'prod-70419',
      shelfLocation: '774',
      sellingPriceCents: 2500,
      costPriceCents: 1087,
      stockQuantity: 5,
    };

    await storage.saveProductWithInventory(prod, inv);
    const duplicated = await storage.duplicateProduct('prod-70419', '70419-C');

    expect(duplicated.sku).toBe('70419-C');
    expect(duplicated.skuNorm).toBe('70419C');
    expect(duplicated.description).toContain('(Cópia)');
    expect(duplicated.storeInventory.shelfLocation).toBe('774');
    expect(duplicated.storeInventory.sellingPriceCents).toBe(2500);
  });

  it('deve mover produto para a lixeira, restaurar e excluir definitivamente', async () => {
    const prod: Product = {
      id: 'prod-test-trash',
      sku: '99999',
      skuNorm: '99999',
      brand: 'Universal',
      description: 'Peça Teste Lixeira',
      automakers: [],
      models: [],
      yearRanges: [],
      oemCodes: [],
      technicalSpecs: {},
      staticImageUrls: [],
      isTrash: false,
    };

    const inv: StoreInventoryData = {
      productId: 'prod-test-trash',
      shelfLocation: '99',
      sellingPriceCents: 1000,
      costPriceCents: 435,
      stockQuantity: 1,
    };

    await storage.saveProductWithInventory(prod, inv);

    // 1. Move para a lixeira
    await storage.softDeleteProduct('prod-test-trash');
    let fetched = await storage.getProductById('prod-test-trash');
    expect(fetched?.isTrash).toBe(true);

    // Listagem normal (sem lixeira) não deve incluir
    const activeList = await storage.getAllProductsWithInventory(false);
    expect(activeList.find(p => p.id === 'prod-test-trash')).toBeUndefined();

    // 2. Restaura da lixeira
    await storage.restoreProductFromTrash('prod-test-trash');
    fetched = await storage.getProductById('prod-test-trash');
    expect(fetched?.isTrash).toBe(false);

    // 3. Exclusão definitiva permanente
    await storage.hardDeleteProduct('prod-test-trash');
    fetched = await storage.getProductById('prod-test-trash');
    expect(fetched).toBeNull();
  });
});
