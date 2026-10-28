import './setup';
import { describe, expect, it } from 'bun:test';
import { ImageGallery } from '../src/ui/image-gallery';
import { Product } from '../src/domain/types';
import { ObjectUrlManager } from '../src/media/object-url-manager';
import { convertImageToWebpStudio } from '../src/media/webp-converter';

describe('Galeria Híbrida Multi-Ângulos e Gerenciador de URLs (Gate 7)', () => {
  it('deve montar a lista de exibição com fotos estáticas e fotos manuais', async () => {
    const prod: Product = {
      id: 'prod-test-gal',
      sku: '20428',
      skuNorm: '20428',
      brand: 'Universal',
      description: 'Peça Teste',
      automakers: [],
      models: [],
      yearRanges: [],
      oemCodes: [],
      technicalSpecs: {},
      staticImageUrls: [
        '/catalog-images/universal/20428.webp',
        '/catalog-images/universal/20428_2.webp',
        '/catalog-images/universal/20428_3.webp',
      ],
      removedStaticUrls: ['/catalog-images/universal/20428_3.webp'], // Foto 3 ocultada
      coverStaticUrl: '/catalog-images/universal/20428_2.webp',     // Foto 2 como capa
      imageAssetIds: [],
    };

    const items = await ImageGallery.getDisplayItemsForProduct(prod);

    // Deve conter apenas as fotos 1 e 2 (a foto 3 foi removida pelo usuário)
    expect(items.length).toBe(2);
    expect(items[0].url).toBe('/catalog-images/universal/20428.webp');
    expect(items[1].url).toBe('/catalog-images/universal/20428_2.webp');

    // A foto 2 deve ser a capa
    expect(items[1].isCover).toBe(true);
    expect(items[0].isCover).toBe(false);
  });

  it('deve gerenciar e revogar Object URLs evitando memory leaks', () => {
    const manager = new ObjectUrlManager();
    const fakeBlob = new Blob(['teste'], { type: 'text/plain' });

    // Mock URL se necessário
    if (!globalThis.URL.createObjectURL) {
      let counter = 0;
      globalThis.URL.createObjectURL = () => `blob:http://localhost/${++counter}`;
      globalThis.URL.revokeObjectURL = () => {};
    }

    const url1 = manager.createUrl(fakeBlob);
    const url2 = manager.createUrl(fakeBlob);

    expect(manager.activeCount).toBe(2);
    manager.revokeUrl(url1);
    expect(manager.activeCount).toBe(1);

    manager.revokeAll();
    expect(manager.activeCount).toBe(0);
  });

  it('deve converter imagens client-side calculando hash SHA-256 para deduplicação', async () => {
    const sampleBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const blob = new Blob([sampleBytes], { type: 'image/png' });

    const processed = await convertImageToWebpStudio(blob);
    expect(processed.hashSha256).toBeDefined();
    expect(processed.hashSha256.length).toBe(64); // SHA-256 hex é 64 chars
    expect(processed.mimeType).toBe('image/webp');
  });
});
