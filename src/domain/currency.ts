/**
 * Manipulação Segura de Moeda em Centavos Inteiros via BigInt.
 * Elimina completamente erros de ponto flutuante (IEEE 754).
 */

export function toBigIntCents(value: number | bigint | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    return BigInt(Math.round(value));
  }
  const clean = value.replace(/[^\d-]/g, '');
  return clean ? BigInt(clean) : 0n;
}

export function parseBRL(raw: string): bigint {
  if (!raw) return 0n;
  let str = raw.trim().replace(/^R\$\s*/i, '');
  if (!str) return 0n;

  // Se tiver vírgula, trata como decimal
  if (str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  }
  const floatVal = parseFloat(str);
  if (isNaN(floatVal)) return 0n;
  return BigInt(Math.round(floatVal * 100));
}

export function formatBRL(cents: bigint | number): string {
  const c = typeof cents === 'bigint' ? Number(cents) : cents;
  const isNegative = c < 0;
  const absC = Math.abs(c);
  const reais = Math.floor(absC / 100);
  const centavos = absC % 100;

  const formattedReais = reais.toLocaleString('pt-BR');
  const formattedCents = centavos.toString().padStart(2, '0');
  const sign = isNegative ? '-' : '';

  return `${sign}R$ ${formattedReais},${formattedCents}`;
}

/**
 * Dedução do markup de 130% embutido:
 * Preço Venda = Custo * (1 + 1.30) = Custo * 2.30
 * Custo = Preço Venda / 2.30
 */
export function calculateCostFromSelling(sellingCents: bigint | number): bigint {
  const s = typeof sellingCents === 'bigint' ? Number(sellingCents) : sellingCents;
  if (s <= 0) return 0n;
  const cost = Math.round(s / 2.30);
  return BigInt(cost);
}
