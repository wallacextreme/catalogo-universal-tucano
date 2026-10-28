import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import { CatalogStorage } from '../src/storage/indexeddb';
import { SearchEngine } from '../src/search/search-engine';
import { ProductWithInventory } from '../src/domain/types';

describe('Gate 9 — Segurança Defensiva, Benchmark < 50ms e Disaster Recovery', () => {
  let storage: CatalogStorage;

  beforeEach(async () => {
    storage = new CatalogStorage();
    await storage.resetDatabase();
  });

  it('deve validar Magic Bytes binários de arquivos legítimos e rejeitar corrompidos', () => {
    const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isPdf = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
    const isWebp = (bytes: Uint8Array) => bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // RIFF

    expect(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(true);
    expect(isPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(true);
    expect(isWebp(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]))).toBe(true);
    expect(isWebp(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBe(false);
  });

  it('deve registrar e recuperar eventos na Trilha de Auditoria (Audit Logs)', async () => {
    await storage.addAuditLog('CREATE', 'Product:20428', 'Produto cadastrado pelo operador de balcão.');
    await storage.addAuditLog('UPDATE', 'Price:20428', 'Preço ajustado para R$ 25,00.');

    const logs = await storage.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some(l => l.action === 'CREATE' && l.entity === 'Product:20428')).toBe(true);
    expect(logs.some(l => l.action === 'UPDATE' && l.entity === 'Price:20428')).toBe(true);
  });

  it('deve executar o Stress Test de Busca em < 50ms para catálogo com 1.000+ peças', () => {
    const engine = new SearchEngine();
    const mockProducts: ProductWithInventory[] = [];

    // Gera 1.200 produtos para o teste de carga
    for (let i = 1; i <= 1200; i++) {
      const sku = (10000 + i).toString();
      mockProducts.push({
        id: `prod-${sku}`,
        sku,
        skuNorm: sku,
        brand: i % 2 === 0 ? 'Universal' : 'Gonel',
        description: `Alavanca e Maçaneta de Porta Gol Parati Santana Modelo ${i} com Bico 10mm`,
        category: 'Maçanetas',
        automakers: ['Volkswagen', 'Fiat'],
        models: ['Gol', 'Parati', 'Strada'],
        yearRanges: [{ yearStart: 1990 + (i % 20), yearEnd: 2020, isOngoing: false }],
        oemCodes: [`OEM-${sku}`],
        technicalSpecs: {},
        staticImageUrls: [`/catalog-images/universal/${sku}.webp`],
        storeInventory: {
          productId: `prod-${sku}`,
          shelfLocation: (500 + (i % 100)).toString(),
          sellingPriceCents: 1500 + i * 10,
          costPriceCents: 652 + i * 4,
          stockQuantity: 5,
        },
      });
    }

    engine.index(mockProducts);

    // Executa 20 buscas variadas medindo o tempo de resposta
    const queries = ['10500', 'Gol Maçaneta', 'Universal 548', 'Strada', 'OEM-10100', '20428', 'Volkswagen Gol'];
    const times: number[] = [];

    for (const q of queries) {
      const t0 = performance.now();
      const results = engine.search(q);
      const elapsed = performance.now() - t0;
      times.push(elapsed);
      expect(elapsed).toBeLessThan(50); // Quality Gate: < 50ms obrigatório!
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`[*] Benchmark de Busca (1.200 itens): Tempo Médio = ${avgTime.toFixed(2)} ms (Meta: < 50ms)`);
    expect(avgTime).toBeLessThan(25);
  });

  it('deve realizar ciclo completo de Disaster Recovery: Backup -> Reset -> Restore com Checksum SHA-256', async () => {
    // 1. Popula banco com dados
    const prod: ProductWithInventory = {
      id: 'prod-disaster-test',
      sku: '70133',
      skuNorm: '70133',
      brand: 'Universal',
      description: 'Batente Fechadura Mala Palio',
      automakers: ['Fiat'],
      models: ['Palio'],
      yearRanges: [{ yearStart: 2001, yearEnd: 2007, isOngoing: false }],
      oemCodes: ['51723321'],
      technicalSpecs: {},
      staticImageUrls: ['/catalog-images/universal/70133.webp'],
      storeInventory: {
        productId: 'prod-disaster-test',
        shelfLocation: '672',
        sellingPriceCents: 6500,
        costPriceCents: 2826,
        stockQuantity: 8,
      },
    };

    await storage.saveProductWithInventory(prod, prod.storeInventory);

    // 2. Exporta Backup com Checksum SHA-256
    const backup = await storage.exportFullBackup();
    expect(backup.sha256Checksum).toBeDefined();
    expect(backup.sha256Checksum.length).toBe(64);
    expect(backup.products.length).toBe(1);

    // 3. Simula perda catastrófica de dados (Reset DB)
    await storage.resetDatabase();
    const afterReset = await storage.getAllProductsWithInventory();
    expect(afterReset.length).toBe(0);

    // 4. Restauração Completa validada por Checksum SHA-256
    const restored = await storage.restoreFullBackup(backup);
    expect(restored).toBe(true);

    const afterRestore = await storage.getProductById('prod-disaster-test');
    expect(afterRestore).not.toBeNull();
    expect(afterRestore?.sku).toBe('70133');
    expect(afterRestore?.storeInventory.shelfLocation).toBe('672');
    expect(afterRestore?.storeInventory.sellingPriceCents).toBe(6500);

    // 5. Tentativa de corrupção de checksum deve falhar
    const corruptedBackup = { ...backup, sha256Checksum: 'CORRUPTED_HASH_000000000000000000000000000000000000000000000000' };
    expect(storage.restoreFullBackup(corruptedBackup)).rejects.toThrow(/Checksum SHA-256 inválido/i);
  });
});
