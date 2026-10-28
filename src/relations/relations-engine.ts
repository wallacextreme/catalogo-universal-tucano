import { Product, RelationLink } from '../domain/types';
import { normalizeCodeStrict } from '../domain/normalizer';

export class RelationsEngine {
  /**
   * 🔵 EQUIVALENCIA_DIRETA:
   * Substitutos entre marcas concorrentes pelo mesmo OEM estrito.
   * Regra Defensiva Obrigatória: Bloqueia equivalência entre categorias sabidamente incompatíveis.
   */
  public createDirectEquivalence(
    sourceProd: Product,
    targetProd: Product,
    oemCode?: string
  ): RelationLink {
    if (sourceProd.id === targetProd.id || sourceProd.skuNorm === targetProd.skuNorm) {
      throw new Error('Não é possível vincular um produto a ele mesmo.');
    }

    // Bloqueio Defensivo: Categorias explicitamente divergentes
    if (
      sourceProd.category &&
      targetProd.category &&
      sourceProd.category.trim().toLowerCase() !== 'geral' &&
      targetProd.category.trim().toLowerCase() !== 'geral' &&
      sourceProd.category.trim().toLowerCase() !== targetProd.category.trim().toLowerCase()
    ) {
      throw new Error(
        `Bloqueio defensivo: Não é permitida equivalência direta entre categorias distintas ('${sourceProd.category}' vs '${targetProd.category}').`
      );
    }

    const sSku = normalizeCodeStrict(sourceProd.sku);
    const tSku = normalizeCodeStrict(targetProd.sku);

    return {
      id: `rel-eq-${sSku}-${tSku}`,
      sourceSku: sSku,
      targetSku: tSku,
      relationType: 'EQUIVALENCIA_DIRETA',
      notes: oemCode ? `OEM Estrito: ${oemCode}` : 'Equivalente Direto Multimarca',
    };
  }

  /**
   * 🟢 COMPATIBILIDADE_ACOPLAMENTO:
   * Peças complementares que montam juntas ("Serve em", ex.: Tampa <-> Reservatório, Maçaneta <-> Cabo).
   */
  public createCouplingCompatibility(
    partA: Product,
    partB: Product,
    notes?: string
  ): RelationLink {
    const sSku = normalizeCodeStrict(partA.sku);
    const tSku = normalizeCodeStrict(partB.sku);

    return {
      id: `rel-acopl-${sSku}-${tSku}`,
      sourceSku: sSku,
      targetSku: tSku,
      relationType: 'COMPATIBILIDADE_ACOPLAMENTO',
      notes: notes || 'Acoplamento / Montagem Conjunta',
    };
  }

  /**
   * 🟣 COMPOSICAO_KIT:
   * Kits comerciais e seus componentes filhos.
   */
  public createKitComposition(
    kitProd: Product,
    componentProd: Product,
    notes?: string
  ): RelationLink {
    const sSku = normalizeCodeStrict(kitProd.sku);
    const tSku = normalizeCodeStrict(componentProd.sku);

    return {
      id: `rel-kit-${sSku}-${tSku}`,
      sourceSku: sSku,
      targetSku: tSku,
      relationType: 'COMPOSICAO_KIT',
      notes: notes || 'Componente Integrante do Kit',
    };
  }

  /**
   * ⚫ VARIANTE_PRODUTO:
   * Variações da mesma família base (-S com sensor, -F fixo, -C cromado).
   */
  public createProductVariant(
    baseProd: Product,
    variantProd: Product,
    variantLabel: string
  ): RelationLink {
    const sSku = normalizeCodeStrict(baseProd.sku);
    const tSku = normalizeCodeStrict(variantProd.sku);

    return {
      id: `rel-var-${sSku}-${tSku}`,
      sourceSku: sSku,
      targetSku: tSku,
      relationType: 'VARIANTE_PRODUTO',
      notes: variantLabel || 'Variação de Família',
    };
  }

  /**
   * Sugestão Transitiva Cross-Brand:
   * Se a Peça A acopla com a Peça B, e a Peça B possui Equivalente Direto B',
   * então B' é sugerido como acoplamento transitivo para A.
   */
  public getTransitiveCouplingSuggestions(
    targetSku: string,
    allLinks: RelationLink[]
  ): RelationLink[] {
    const normTarget = normalizeCodeStrict(targetSku);
    const directCouplings: string[] = [];

    for (const link of allLinks) {
      if (link.relationType === 'COMPATIBILIDADE_ACOPLAMENTO') {
        if (link.sourceSku === normTarget) directCouplings.push(link.targetSku);
        else if (link.targetSku === normTarget) directCouplings.push(link.sourceSku);
      }
    }

    const suggestions: RelationLink[] = [];
    for (const coupledSku of directCouplings) {
      for (const link of allLinks) {
        if (link.relationType === 'EQUIVALENCIA_DIRETA') {
          let equivalentSku = '';
          if (link.sourceSku === coupledSku) equivalentSku = link.targetSku;
          else if (link.targetSku === coupledSku) equivalentSku = link.sourceSku;

          if (equivalentSku && equivalentSku !== normTarget && !directCouplings.includes(equivalentSku)) {
            suggestions.push({
              id: `rel-transitive-${normTarget}-${equivalentSku}`,
              sourceSku: normTarget,
              targetSku: equivalentSku,
              relationType: 'COMPATIBILIDADE_ACOPLAMENTO',
              notes: `Sugestão Transitiva (Equivalente de ${coupledSku})`,
            });
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Separa e organiza todos os relacionamentos de um produto por natureza.
   */
  public organizeRelations(
    productSku: string,
    allLinks: RelationLink[]
  ): {
    equivalences: RelationLink[];
    couplings: RelationLink[];
    kits: RelationLink[];
    variants: RelationLink[];
    transitiveSuggestions: RelationLink[];
  } {
    const norm = normalizeCodeStrict(productSku);
    const equivalences: RelationLink[] = [];
    const couplings: RelationLink[] = [];
    const kits: RelationLink[] = [];
    const variants: RelationLink[] = [];

    for (const link of allLinks) {
      if (link.sourceSku !== norm && link.targetSku !== norm) continue;

      switch (link.relationType) {
        case 'EQUIVALENCIA_DIRETA':
          equivalences.push(link);
          break;
        case 'COMPATIBILIDADE_ACOPLAMENTO':
          couplings.push(link);
          break;
        case 'COMPOSICAO_KIT':
          kits.push(link);
          break;
        case 'VARIANTE_PRODUTO':
          variants.push(link);
          break;
      }
    }

    const transitiveSuggestions = this.getTransitiveCouplingSuggestions(norm, allLinks);

    return {
      equivalences,
      couplings,
      kits,
      variants,
      transitiveSuggestions,
    };
  }
}

export const relationsEngine = new RelationsEngine();
