/**
 * Regras Estritas de Normalização de Códigos e Referências Automotivas.
 */

/**
 * Normaliza o código para formato alfanumérico estrito:
 * - Converte para maiúsculas (UPPERCASE).
 * - Remove pontos, traços, barras e espaços.
 * - PRESERVA 100% dos zeros à esquerda ('00123' -> '00123').
 */
export function normalizeCodeStrict(rawCode: string | null | undefined): string {
  if (!rawCode) return '';
  return rawCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Normalização em minúsculas para compatibilidade de arquivos (Linux / URLs).
 */
export function normalizeCodeStrictLower(rawCode: string | null | undefined): string {
  return normalizeCodeStrict(rawCode).toLowerCase();
}

/**
 * Expansão de Códigos Compostos por Barra (OEMs e Referências Cruzadas).
 * Exemplos:
 * - "377.837.205.A/B" -> ["377837205A", "377837205B"]
 * - "20397/98" -> ["20397", "20398"]
 * - "15/17" -> ["15", "17"]
 */
export function expandCompoundOemCodes(rawCode: string | null | undefined): string[] {
  if (!rawCode) return [];
  const trimmed = rawCode.trim();
  if (!trimmed.includes('/')) {
    const norm = normalizeCodeStrict(trimmed);
    return norm ? [norm] : [];
  }

  const parts = trimmed.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    const norm = normalizeCodeStrict(trimmed);
    return norm ? [norm] : [];
  }

  const basePart = parts[0];
  const results: Set<string> = new Set();
  const baseNorm = normalizeCodeStrict(basePart);
  if (baseNorm) results.add(baseNorm);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    // Se o sufixo for apenas 1 letra (ex: 'A/B/C')
    if (part.length === 1 && /[A-Z]/i.test(part)) {
      const parent = baseNorm.slice(0, -1);
      results.add(normalizeCodeStrict(parent + part));
    }
    // Se o sufixo for 2 dígitos substituindo os 2 últimos da base (ex: '20397/98' -> '20398')
    else if (/^\d{2}$/.test(part) && baseNorm.length > 2) {
      const parent = baseNorm.slice(0, -2);
      results.add(normalizeCodeStrict(parent + part));
    }
    // Se for código autônomo
    else {
      const normPart = normalizeCodeStrict(part);
      if (normPart) results.add(normPart);
    }
  }

  return Array.from(results);
}

/**
 * Mapeamento de Homóglifos para busca tolerante a erros de digitação:
 * Converte O <-> 0, I <-> 1 para gerar chaves de busca aproximada.
 */
export function normalizeCodeHomoglyph(rawCode: string | null | undefined): string {
  if (!rawCode) return '';
  const norm = normalizeCodeStrict(rawCode);
  return norm
    .replace(/[O]/g, '0')
    .replace(/[I]/g, '1');
}

/**
 * Sanitiza lista de códigos de referência cruzada, removendo nulos,
 * pontuações espúrias e códigos curtos demais.
 */
export function sanitizeCrossReferenceCodes(codes: Array<string | null | undefined>): string[] {
  const result: Set<string> = new Set();
  for (const c of codes) {
    if (!c) continue;
    const expanded = expandCompoundOemCodes(c);
    for (const exp of expanded) {
      if (exp.length >= 2) {
        result.add(exp);
      }
    }
  }
  return Array.from(result);
}
