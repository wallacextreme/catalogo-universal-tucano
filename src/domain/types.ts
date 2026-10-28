export interface YearRange {
  yearStart: number;
  yearEnd: number;
  isOngoing: boolean;
}

export type RelationType =
  | 'EQUIVALENCIA_DIRETA'
  | 'COMPATIBILIDADE_ACOPLAMENTO'
  | 'COMPOSICAO_KIT'
  | 'VARIANTE_PRODUTO';

export interface RelationLink {
  id: string;
  sourceSku: string;
  targetSku: string;
  relationType: RelationType;
  notes?: string;
}

export interface StoreInventoryData {
  productId: string;
  shelfLocation: string;
  sellingPriceCents: number; // Centavos inteiros
  costPriceCents: number;    // Centavos inteiros (com dedução de 130% de markup)
  stockQuantity: number;
  internalNotes?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  sku: string;
  skuNorm: string;
  brand: string;
  description: string;
  category?: string;
  automakers: string[];
  models: string[];
  yearRanges: YearRange[];
  oemCodes: string[];
  technicalSpecs: Record<string, string | number | boolean | string[]>;
  staticImageUrls: string[];
  removedStaticUrls?: string[];
  coverStaticUrl?: string;
  imageAssetIds?: string[];
  isTrash?: boolean;
  sourcePages?: number[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductWithInventory extends Product {
  storeInventory: StoreInventoryData;
}

export interface ImageAsset {
  id: string;
  hashSha256: string;
  masterBlob: Blob;
  thumbBlob: Blob;
  mimeType: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'SYNC' | 'BACKUP' | 'IMPORT_CSV';
  entity: string;
  details: string;
}

export interface BackupPayload {
  version: string;
  exportedAt: string;
  sha256Checksum: string;
  products: Product[];
  storeInventories: StoreInventoryData[];
  relations: RelationLink[];
  auditLogs: AuditLog[];
  images: Array<{
    id: string;
    hashSha256: string;
    mimeType: string;
    width: number;
    height: number;
    masterBase64: string;
    thumbBase64: string;
    createdAt: string;
  }>;
}
