import { ProductWithInventory } from '../domain/types';
import { normalizeCodeHomoglyph, normalizeCodeStrict } from '../domain/normalizer';

export interface SearchFilters {
  automaker?: string;
  model?: string;
  year?: number;
  brand?: string;
  shelf?: string;
  priceStatus?: 'all' | 'with_price' | 'without_price';
}

export interface SearchMatch {
  product: ProductWithInventory;
  score: number;
  matchLevel: 1 | 2 | 3 | 4;
  matchReason: string;
}

export class SearchEngine {
  private indexedProducts: Array<{
    item: ProductWithInventory;
    skuNorm: string;
    skuHomoglyph: string;
    oemNorms: string[];
    shelfNorm: string;
    searchCorpus: string;
  }> = [];

  public index(products: ProductWithInventory[]): void {
    this.indexedProducts = products.map(item => {
      const skuNorm = normalizeCodeStrict(item.sku);
      const skuHomoglyph = normalizeCodeHomoglyph(item.sku);
      const oemNorms = (item.oemCodes || []).map(o => normalizeCodeStrict(o));
      const shelfNorm = normalizeCodeStrict(item.storeInventory?.shelfLocation || '');

      const searchCorpus = [
        item.sku,
        skuNorm,
        item.brand,
        item.description,
        ...(item.automakers || []),
        ...(item.models || []),
        ...(item.yearRanges || []).map(y => `${y.yearStart} ${y.yearEnd}`),
        ...(item.oemCodes || []),
        item.storeInventory?.shelfLocation || '',
      ]
        .join(' ')
        .toLowerCase();

      return {
        item,
        skuNorm,
        skuHomoglyph,
        oemNorms,
        shelfNorm,
        searchCorpus,
      };
    });
  }

  public search(query: string, filters: SearchFilters = {}): SearchMatch[] {
    const trimmed = query.trim();
    const queryNorm = normalizeCodeStrict(trimmed);
    const queryHomoglyph = normalizeCodeHomoglyph(trimmed);
    const rawTokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);

    const results: SearchMatch[] = [];

    for (const entry of this.indexedProducts) {
      const { item, skuNorm, skuHomoglyph, oemNorms, shelfNorm, searchCorpus } = entry;

      // Aplicação de filtros combinados
      if (filters.automaker && filters.automaker !== 'all') {
        const hasAutomaker = (item.automakers || []).some(
          a => a.toLowerCase() === filters.automaker!.toLowerCase()
        );
        if (!hasAutomaker) continue;
      }

      if (filters.brand && filters.brand !== 'all') {
        if (item.brand.toLowerCase() !== filters.brand.toLowerCase()) continue;
      }

      if (filters.model && filters.model !== 'all') {
        const hasModel = (item.models || []).some(
          m => m.toLowerCase().includes(filters.model!.toLowerCase())
        );
        if (!hasModel) continue;
      }

      if (filters.shelf) {
        const targetShelf = filters.shelf.trim().toLowerCase();
        const currentShelf = (item.storeInventory?.shelfLocation || '').toLowerCase();
        if (!currentShelf.includes(targetShelf)) continue;
      }

      if (filters.year) {
        const targetYear = filters.year;
        const matchesYear = (item.yearRanges || []).some(
          yr => targetYear >= yr.yearStart && targetYear <= yr.yearEnd
        );
        if (!matchesYear && item.yearRanges && item.yearRanges.length > 0) continue;
      }

      if (filters.priceStatus === 'with_price') {
        if (!item.storeInventory?.sellingPriceCents || item.storeInventory.sellingPriceCents <= 0) continue;
      } else if (filters.priceStatus === 'without_price') {
        if (item.storeInventory?.sellingPriceCents && item.storeInventory.sellingPriceCents > 0) continue;
      }

      // Se a query de busca estiver vazia, retorna pelo filtro
      if (!trimmed) {
        results.push({
          product: item,
          score: 10,
          matchLevel: 3,
          matchReason: 'Filtro',
        });
        continue;
      }

      // 1º NÍVEL: Match Exato SKU / OEM / Prateleira
      if (skuNorm === queryNorm) {
        results.push({
          product: item,
          score: 1000,
          matchLevel: 1,
          matchReason: 'Match Exato SKU',
        });
        continue;
      }

      if (oemNorms.includes(queryNorm)) {
        results.push({
          product: item,
          score: 900,
          matchLevel: 1,
          matchReason: 'Match Exato OEM',
        });
        continue;
      }

      if (shelfNorm && shelfNorm === queryNorm) {
        results.push({
          product: item,
          score: 850,
          matchLevel: 1,
          matchReason: 'Match Exato Prateleira/Caixa',
        });
        continue;
      }

      // 2º NÍVEL: Prefixo / Barra
      if (queryNorm.length >= 2 && skuNorm.startsWith(queryNorm)) {
        results.push({
          product: item,
          score: 500 + (queryNorm.length / skuNorm.length) * 50,
          matchLevel: 2,
          matchReason: 'Prefixo SKU',
        });
        continue;
      }

      const matchingOemPrefix = oemNorms.find(o => queryNorm.length >= 2 && o.startsWith(queryNorm));
      if (matchingOemPrefix) {
        results.push({
          product: item,
          score: 450,
          matchLevel: 2,
          matchReason: 'Prefixo OEM',
        });
        continue;
      }

      // 3º NÍVEL: Multi-Token Veículo + Tipo + Spec
      if (rawTokens.length > 0) {
        const allTokensFound = rawTokens.every(tok => searchCorpus.includes(tok));
        if (allTokensFound) {
          results.push({
            product: item,
            score: 200 + rawTokens.length * 30,
            matchLevel: 3,
            matchReason: 'Multi-Token',
          });
          continue;
        }
      }

      // 4º NÍVEL: Homóglifo Sinalizado (O <-> 0, I <-> 1)
      if (queryHomoglyph.length >= 3 && skuHomoglyph === queryHomoglyph) {
        results.push({
          product: item,
          score: 80,
          matchLevel: 4,
          matchReason: 'Aproximação Homóglifo (O↔0/I↔1)',
        });
        continue;
      }
    }

    // Ordenação decrescente por score
    return results.sort((a, b) => b.score - a.score);
  }
}

export const searchEngine = new SearchEngine();
