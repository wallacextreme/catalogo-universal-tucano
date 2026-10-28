import { describe, expect, it } from 'bun:test';
import { RelationsEngine } from '../src/relations/relations-engine';
import { Product, RelationLink } from '../src/domain/types';

describe('Motor de Relacionamentos e 4 Naturezas de Vínculos (Gate 7)', () => {
  const engine = new RelationsEngine();

  const prodReservatorio: Product = {
    id: 'prod-res-1',
    sku: 'G-1001',
    skuNorm: 'G1001',
    brand: 'Gonel',
    category: 'Reservatório',
    description: 'Reservatório Expansão Água Gol',
    automakers: ['Volkswagen'],
    models: ['Gol'],
    yearRanges: [],
    oemCodes: ['377.121.407.A'],
    technicalSpecs: {},
    staticImageUrls: [],
  };

  const prodTampaUniversal: Product = {
    id: 'prod-tampa-uni',
    sku: '20428',
    skuNorm: '20428',
    brand: 'Universal',
    category: 'Tampa',
    description: 'Tampa Reservatório Água 1.4 Bar Azul',
    automakers: ['Volkswagen'],
    models: ['Gol'],
    yearRanges: [],
    oemCodes: ['20428-OEM'],
    technicalSpecs: {},
    staticImageUrls: [],
  };

  const prodTampaClick: Product = {
    id: 'prod-tampa-click',
    sku: 'TC-3060',
    skuNorm: 'TC3060',
    brand: 'Click',
    category: 'Tampa',
    description: 'Tampa Reservatório Água Click 1.4 Bar',
    automakers: ['Volkswagen'],
    models: ['Gol'],
    yearRanges: [],
    oemCodes: ['20428-OEM'],
    technicalSpecs: {},
    staticImageUrls: [],
  };

  const prodFarol: Product = {
    id: 'prod-farol',
    sku: 'FL-900',
    skuNorm: 'FL900',
    brand: 'Outro',
    category: 'Farol',
    description: 'Farol Dianteiro Gol',
    automakers: ['Volkswagen'],
    models: ['Gol'],
    yearRanges: [],
    oemCodes: [],
    technicalSpecs: {},
    staticImageUrls: [],
  };

  it('🔵 deve criar Equivalência Direta entre peças de mesma categoria e OEM estrito', () => {
    const link = engine.createDirectEquivalence(prodTampaUniversal, prodTampaClick, '20428-OEM');
    expect(link.relationType).toBe('EQUIVALENCIA_DIRETA');
    expect(link.sourceSku).toBe('20428');
    expect(link.targetSku).toBe('TC3060');
  });

  it('deve BLOQUEAR defensivamente Equivalência Direta entre categorias distintas', () => {
    // Tenta equivaler Tampa com Farol
    expect(() => {
      engine.createDirectEquivalence(prodTampaUniversal, prodFarol);
    }).toThrow(/Bloqueio defensivo/i);
  });

  it('🟢 deve criar Vínculo de Acoplamento / Montagem Conjunta (Tampa <-> Reservatório)', () => {
    const link = engine.createCouplingCompatibility(prodReservatorio, prodTampaUniversal, 'Tampa monta no bocal do reservatório');
    expect(link.relationType).toBe('COMPATIBILIDADE_ACOPLAMENTO');
    expect(link.sourceSku).toBe('G1001');
    expect(link.targetSku).toBe('20428');
  });

  it('🟣 deve criar Vínculo de Composição de Kit (Kit Comercial e Componente Filho)', () => {
    const kitProd: Product = {
      ...prodReservatorio,
      id: 'prod-kit-1',
      sku: 'KIT-100',
      skuNorm: 'KIT100',
      category: 'Kit',
      description: 'Kit Reservatório + Tampa',
    };

    const link = engine.createKitComposition(kitProd, prodTampaUniversal);
    expect(link.relationType).toBe('COMPOSICAO_KIT');
    expect(link.sourceSku).toBe('KIT100');
    expect(link.targetSku).toBe('20428');
  });

  it('⚫ deve criar Vínculo de Variante de Família (-S, -F, -C)', () => {
    const variantProd: Product = {
      ...prodReservatorio,
      id: 'prod-res-sensor',
      sku: 'G-1001-S',
      skuNorm: 'G1001S',
      description: 'Reservatório Expansão com Furo de Sensor',
    };

    const link = engine.createProductVariant(prodReservatorio, variantProd, 'Versão COM Furo de Sensor');
    expect(link.relationType).toBe('VARIANTE_PRODUTO');
    expect(link.sourceSku).toBe('G1001');
    expect(link.targetSku).toBe('G1001S');
  });

  it('deve sugerir acoplamento transitivo Cross-Brand', () => {
    // Acoplamento: Reservatório G-1001 <-> Tampa Universal 20428
    const linkAcopl = engine.createCouplingCompatibility(prodReservatorio, prodTampaUniversal);
    // Equivalência: Tampa Universal 20428 <-> Tampa Click TC-3060
    const linkEquiv = engine.createDirectEquivalence(prodTampaUniversal, prodTampaClick);

    const allLinks: RelationLink[] = [linkAcopl, linkEquiv];
    // Pergunta: Para o Reservatório G1001, quais tampas compatíveis transitivas existem?
    const suggestions = engine.getTransitiveCouplingSuggestions('G1001', allLinks);

    expect(suggestions.length).toBeGreaterThan(0);
    const suggestedTarget = suggestions.find(s => s.targetSku === 'TC3060');
    expect(suggestedTarget).toBeDefined();
    expect(suggestedTarget?.notes).toContain('Sugestão Transitiva');
  });
});
