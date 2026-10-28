import { describe, expect, it } from 'bun:test';
import {
  calculateCostFromSelling,
  formatBRL,
  parseBRL,
  toBigIntCents,
} from '../src/domain/currency';

describe('Manipulação Segura de Moeda em Centavos e Markup (Gate 7)', () => {
  it('deve converter valores para centavos inteiros via BigInt sem erros de ponto flutuante', () => {
    expect(toBigIntCents(1500)).toBe(1500n);
    expect(toBigIntCents(15.99)).toBe(16n);
    expect(toBigIntCents('1500')).toBe(1500n);
  });

  it('deve fazer parse de strings em Real (BRL) para centavos', () => {
    expect(parseBRL('R$ 15,00')).toBe(1500n);
    expect(parseBRL('25,50')).toBe(2550n);
    expect(parseBRL('R$ 1.250,75')).toBe(125075n);
    expect(parseBRL('')).toBe(0n);
  });

  it('deve formatar centavos para padrão brasileiro R$ com vírgula', () => {
    expect(formatBRL(1500n)).toBe('R$ 15,00');
    expect(formatBRL(2550n)).toBe('R$ 25,50');
    expect(formatBRL(740n)).toBe('R$ 7,40');
    expect(formatBRL(0n)).toBe('R$ 0,00');
  });

  it('deve calcular o Preço de Custo deduzindo 130% de markup (Venda / 2.30)', () => {
    // Venda R$ 15,00 (1500 centavos) / 2.30 = 652 centavos (R$ 6,52)
    const cost1 = calculateCostFromSelling(1500n);
    expect(cost1).toBe(652n);
    expect(formatBRL(cost1)).toBe('R$ 6,52');

    // Venda R$ 25,00 (2500 centavos) / 2.30 = 1087 centavos (R$ 10,87)
    const cost2 = calculateCostFromSelling(2500n);
    expect(cost2).toBe(1087n);
    expect(formatBRL(cost2)).toBe('R$ 10,87');

    // Venda R$ 110,00 (11000 centavos) / 2.30 = 4783 centavos (R$ 47,83)
    const cost3 = calculateCostFromSelling(11000n);
    expect(cost3).toBe(4783n);
    expect(formatBRL(cost3)).toBe('R$ 47,83');
  });
});
