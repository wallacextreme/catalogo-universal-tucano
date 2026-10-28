import { describe, expect, it } from 'bun:test';
import {
  expandCompoundOemCodes,
  normalizeCodeHomoglyph,
  normalizeCodeStrict,
  normalizeCodeStrictLower,
  sanitizeCrossReferenceCodes,
} from '../src/domain/normalizer';

describe('Normalizador de Códigos Automotivos (Gate 7)', () => {
  it('deve preservar 100% dos zeros à esquerda e remover pontuação', () => {
    expect(normalizeCodeStrict('00123')).toBe('00123');
    expect(normalizeCodeStrict('000456-A')).toBe('000456A');
    expect(normalizeCodeStrict('  020.428 / VW ')).toBe('020428VW');
    expect(normalizeCodeStrictLower('G-1001')).toBe('g1001');
  });

  it('deve expandir códigos compostos por barra (A/B/C, 15/17, 397/98)', () => {
    // Sufixo alfabético A/B
    const exp1 = expandCompoundOemCodes('377.837.205.A/B');
    expect(exp1).toContain('377837205A');
    expect(exp1).toContain('377837205B');

    // Substituição de 2 dígitos finais (20397/98 -> 20397, 20398)
    const exp2 = expandCompoundOemCodes('20397/98');
    expect(exp2).toContain('20397');
    expect(exp2).toContain('20398');

    // Códigos independentes (15/17)
    const exp3 = expandCompoundOemCodes('15/17');
    expect(exp3).toContain('15');
    expect(exp3).toContain('17');
  });

  it('deve converter homóglifos (O <-> 0, I <-> 1) para busca aproximada', () => {
    expect(normalizeCodeHomoglyph('GOL100')).toBe('G0L100');
    expect(normalizeCodeHomoglyph('OIL-99')).toBe('01L99');
    expect(normalizeCodeHomoglyph('20428')).toBe('20428');
  });

  it('deve sanitizar lista de referências cruzadas', () => {
    const list = [' 20428 ', null, '', '377.837.205.A/B', 'x'];
    const sanitized = sanitizeCrossReferenceCodes(list);
    expect(sanitized).toContain('20428');
    expect(sanitized).toContain('377837205A');
    expect(sanitized).toContain('377837205B');
    expect(sanitized).not.toContain('');
    expect(sanitized).not.toContain('X');
  });
});
