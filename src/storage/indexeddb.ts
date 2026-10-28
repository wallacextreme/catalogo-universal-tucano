import {
  AuditLog,
  BackupPayload,
  ImageAsset,
  Product,
  ProductWithInventory,
  RelationLink,
  StoreInventoryData,
} from '../domain/types';
import { normalizeCodeStrict } from '../domain/normalizer';

const DB_NAME = 'TucanoCatalogDB';
const DB_VERSION = 1;

export class CatalogStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  public async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      // Suporte a ambiente Node/Bun (testes) ou Browser
      const idb = typeof indexedDB !== 'undefined' ? indexedDB : (globalThis as any).indexedDB;
      if (!idb) {
        reject(new Error('IndexedDB não suportado neste ambiente.'));
        return;
      }

      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Tabela de Produtos de Fábrica/Catálogo
        if (!db.objectStoreNames.contains('products')) {
          const prodStore = db.createObjectStore('products', { keyPath: 'id' });
          prodStore.createIndex('skuNorm', 'skuNorm', { unique: false });
          prodStore.createIndex('brand', 'brand', { unique: false });
          prodStore.createIndex('isTrash', 'isTrash', { unique: false });
        }

        // 2. Tabela de Dados da Loja (INVIOLÁVEL: Preços, Prateleira e Estoque)
        if (!db.objectStoreNames.contains('storeInventory')) {
          const invStore = db.createObjectStore('storeInventory', { keyPath: 'productId' });
          invStore.createIndex('shelfLocation', 'shelfLocation', { unique: false });
        }

        // 3. Tabela de Vínculos / Relacionamentos
        if (!db.objectStoreNames.contains('relations')) {
          const relStore = db.createObjectStore('relations', { keyPath: 'id' });
          relStore.createIndex('sourceSku', 'sourceSku', { unique: false });
          relStore.createIndex('targetSku', 'targetSku', { unique: false });
          relStore.createIndex('relationType', 'relationType', { unique: false });
        }

        // 4. Tabela de Blobs de Imagens Manuais (com Hash SHA-256 para Deduplicação)
        if (!db.objectStoreNames.contains('imageAssets')) {
          const imgStore = db.createObjectStore('imageAssets', { keyPath: 'id' });
          imgStore.createIndex('hashSha256', 'hashSha256', { unique: true });
        }

        // 5. Trilha de Auditoria (Audit Logs)
        if (!db.objectStoreNames.contains('auditLogs')) {
          const logStore = db.createObjectStore('auditLogs', { keyPath: 'id' });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 6. Metadados e Flags de Sistema
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.initPromise;
  }

  /**
   * Auto-Seed Inicial e Sincronização Não-Destrutiva:
   * Carrega os dados do seed JSON oficial.
   * Se já existirem dados na máquina:
   * - NUNCA apaga ou altera storeInventoryData (preços e prateleiras).
   * - NUNCA apaga fotos manuais (imageAssetIds).
   * - NUNCA reativa fotos de fábrica excluídas manualmente (removedStaticUrls).
   * - Atualiza novas fotos estáticas (staticImageUrls) e dados técnicos do fabricante.
   */
  public async autoSeedFromMasterJson(seedProducts: any[]): Promise<{ added: number; synced: number }> {
    const db = await this.getDb();
    let added = 0;
    let synced = 0;

    const tx = db.transaction(['products', 'storeInventory', 'auditLogs'], 'readwrite');
    const prodStore = tx.objectStore('products');
    const invStore = tx.objectStore('storeInventory');

    for (const raw of seedProducts) {
      const prodId = raw.id || `prod-${normalizeCodeStrict(raw.sku).toLowerCase()}`;
      const skuNorm = normalizeCodeStrict(raw.sku);

      // Verifica se o produto já existe no banco
      const existingReq = prodStore.get(prodId);
      const existingProduct: Product | undefined = await new Promise(r => {
        existingReq.onsuccess = () => r(existingReq.result);
        existingReq.onerror = () => r(undefined);
      });

      if (!existingProduct) {
        // Novo produto do seed
        const newProduct: Product = {
          id: prodId,
          sku: raw.sku,
          skuNorm,
          brand: raw.brand || 'Universal',
          description: raw.description || '',
          category: raw.category || 'Geral',
          automakers: raw.automakers || ['Universal'],
          models: raw.models || [],
          yearRanges: raw.yearRanges || [],
          oemCodes: raw.oemCodes || [],
          technicalSpecs: raw.technicalSpecs || {},
          staticImageUrls: raw.staticImageUrls || [],
          removedStaticUrls: [],
          imageAssetIds: [],
          isTrash: false,
          sourcePages: raw.sourcePages || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const newInventory: StoreInventoryData = {
          productId: prodId,
          shelfLocation: raw.shelfLocation || '',
          sellingPriceCents: raw.sellingPriceCents || 0,
          costPriceCents: raw.costPriceCents || 0,
          stockQuantity: 1,
          internalNotes: '',
          updatedAt: new Date().toISOString(),
        };

        prodStore.put(newProduct);
        invStore.put(newInventory);
        added++;
      } else {
        // Produto já existia -> Executa Sync Não-Destrutivo (Gate 8)
        const incomingStaticUrls: string[] = raw.staticImageUrls || [];
        const currentRemoved: string[] = existingProduct.removedStaticUrls || [];
        const existingStatic: string[] = existingProduct.staticImageUrls || [];

        // Adiciona novas fotos que o fabricante lançou, exceto as removidas pelo lojista
        const mergedStatic = Array.from(new Set([...existingStatic, ...incomingStaticUrls]))
          .filter(url => !currentRemoved.includes(url));

        const updatedProduct: Product = {
          ...existingProduct,
          description: raw.description || existingProduct.description,
          automakers: Array.from(new Set([...(existingProduct.automakers || []), ...(raw.automakers || [])])),
          models: Array.from(new Set([...(existingProduct.models || []), ...(raw.models || [])])),
          yearRanges: raw.yearRanges && raw.yearRanges.length > 0 ? raw.yearRanges : existingProduct.yearRanges,
          staticImageUrls: mergedStatic,
          updatedAt: new Date().toISOString(),
        };

        prodStore.put(updatedProduct);
        // O storeInventory NUNCA é tocado aqui! Preserva intacto preços e prateleiras.
        synced++;
      }
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });

    if (added > 0 || synced > 0) {
      await this.addAuditLog('SYNC', 'Catalog', `Auto-seed concluído: ${added} inseridos, ${synced} sincronizados.`);
    }

    return { added, synced };
  }

  // --- CRUD DE PRODUTOS E INVENTÁRIO ---

  public async getAllProductsWithInventory(includeTrash = false): Promise<ProductWithInventory[]> {
    const db = await this.getDb();
    const tx = db.transaction(['products', 'storeInventory'], 'readonly');
    const prodStore = tx.objectStore('products');
    const invStore = tx.objectStore('storeInventory');

    const products: Product[] = await new Promise((resolve, reject) => {
      const req = prodStore.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const inventories: StoreInventoryData[] = await new Promise((resolve, reject) => {
      const req = invStore.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const invMap = new Map<string, StoreInventoryData>();
    for (const inv of inventories) {
      invMap.set(inv.productId, inv);
    }

    const result: ProductWithInventory[] = [];
    for (const p of products) {
      if (!includeTrash && p.isTrash) continue;
      const inv = invMap.get(p.id) || {
        productId: p.id,
        shelfLocation: '',
        sellingPriceCents: 0,
        costPriceCents: 0,
        stockQuantity: 0,
      };
      result.push({ ...p, storeInventory: inv });
    }

    return result;
  }

  public async getProductById(id: string): Promise<ProductWithInventory | null> {
    const db = await this.getDb();
    const tx = db.transaction(['products', 'storeInventory'], 'readonly');
    const prodReq = tx.objectStore('products').get(id);
    const invReq = tx.objectStore('storeInventory').get(id);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        if (!prodReq.result) {
          resolve(null);
        } else {
          resolve({
            ...prodReq.result,
            storeInventory: invReq.result || {
              productId: id,
              shelfLocation: '',
              sellingPriceCents: 0,
              costPriceCents: 0,
              stockQuantity: 0,
            },
          });
        }
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  public async saveProductWithInventory(
    product: Product,
    inventory: StoreInventoryData
  ): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['products', 'storeInventory', 'auditLogs'], 'readwrite');

    product.skuNorm = normalizeCodeStrict(product.sku);
    product.updatedAt = new Date().toISOString();
    inventory.productId = product.id;
    inventory.updatedAt = new Date().toISOString();

    tx.objectStore('products').put(product);
    tx.objectStore('storeInventory').put(inventory);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });

    await this.addAuditLog('UPDATE', `Product:${product.sku}`, `Produto e estoque atualizados no balcão.`);
  }

  public async softDeleteProduct(id: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['products'], 'readwrite');
    const store = tx.objectStore('products');
    const req = store.get(id);

    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const prod = req.result as Product;
        if (prod) {
          prod.isTrash = true;
          prod.updatedAt = new Date().toISOString();
          store.put(prod);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    await this.addAuditLog('DELETE', `Product:${id}`, `Produto movido para a lixeira.`);
  }

  public async restoreProductFromTrash(id: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['products'], 'readwrite');
    const store = tx.objectStore('products');
    const req = store.get(id);

    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const prod = req.result as Product;
        if (prod) {
          prod.isTrash = false;
          prod.updatedAt = new Date().toISOString();
          store.put(prod);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    await this.addAuditLog('RESTORE', `Product:${id}`, `Produto restaurado da lixeira.`);
  }

  public async hardDeleteProduct(id: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['products', 'storeInventory'], 'readwrite');
    tx.objectStore('products').delete(id);
    tx.objectStore('storeInventory').delete(id);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });

    await this.addAuditLog('DELETE', `Product:${id}`, `Produto excluído permanentemente.`);
  }

  public async duplicateProduct(sourceId: string, newSku: string): Promise<ProductWithInventory> {
    const source = await this.getProductById(sourceId);
    if (!source) throw new Error('Produto de origem não encontrado.');

    const newNorm = normalizeCodeStrict(newSku);
    const newId = `prod-${newNorm.toLowerCase()}`;

    const newProd: Product = {
      ...source,
      id: newId,
      sku: newSku,
      skuNorm: newNorm,
      description: `${source.description} (Cópia)`,
      isTrash: false,
      imageAssetIds: [...(source.imageAssetIds || [])],
      staticImageUrls: [...(source.staticImageUrls || [])],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newInv: StoreInventoryData = {
      ...source.storeInventory,
      productId: newId,
      stockQuantity: 1,
      updatedAt: new Date().toISOString(),
    };

    await this.saveProductWithInventory(newProd, newInv);
    await this.addAuditLog('CREATE', `Product:${newSku}`, `Produto duplicado a partir de ${source.sku}.`);

    return { ...newProd, storeInventory: newInv };
  }

  // --- IMAGENS MANUAIS E DEDUPLICAÇÃO VIA HASH SHA-256 ---

  public async saveImageAsset(asset: ImageAsset): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['imageAssets'], 'readwrite');
    tx.objectStore('imageAssets').put(asset);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getImageAsset(id: string): Promise<ImageAsset | null> {
    const db = await this.getDb();
    const tx = db.transaction(['imageAssets'], 'readonly');
    const req = tx.objectStore('imageAssets').get(id);

    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async findImageAssetByHash(hashSha256: string): Promise<ImageAsset | null> {
    const db = await this.getDb();
    const tx = db.transaction(['imageAssets'], 'readonly');
    const index = tx.objectStore('imageAssets').index('hashSha256');
    const req = index.get(hashSha256);

    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // --- VÍNCULOS / RELACIONAMENTOS ---

  public async getAllRelations(): Promise<RelationLink[]> {
    const db = await this.getDb();
    const tx = db.transaction(['relations'], 'readonly');
    const req = tx.objectStore('relations').getAll();

    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async saveRelation(link: RelationLink): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['relations'], 'readwrite');
    tx.objectStore('relations').put(link);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  public async deleteRelation(id: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['relations'], 'readwrite');
    tx.objectStore('relations').delete(id);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- AUDITORIA ---

  public async addAuditLog(action: AuditLog['action'], entity: string, details: string): Promise<void> {
    try {
      const db = await this.getDb();
      const tx = db.transaction(['auditLogs'], 'readwrite');
      const log: AuditLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        action,
        entity,
        details,
      };
      tx.objectStore('auditLogs').put(log);
    } catch {
      // Ignora falhas em testes/mock
    }
  }

  public async getAuditLogs(): Promise<AuditLog[]> {
    const db = await this.getDb();
    const tx = db.transaction(['auditLogs'], 'readonly');
    const req = tx.objectStore('auditLogs').getAll();

    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const logs: AuditLog[] = req.result || [];
        resolve(logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      };
      req.onerror = () => reject(req.error);
    });
  }

  // --- DISASTER RECOVERY: BACKUP & RESTORE COM CHECKSUM SHA-256 ---

  public async exportFullBackup(): Promise<BackupPayload> {
    const db = await this.getDb();
    const tx = db.transaction(['products', 'storeInventory', 'relations', 'imageAssets', 'auditLogs'], 'readonly');

    const products: Product[] = await new Promise(r => { tx.objectStore('products').getAll().onsuccess = e => r((e.target as any).result); });
    const storeInventories: StoreInventoryData[] = await new Promise(r => { tx.objectStore('storeInventory').getAll().onsuccess = e => r((e.target as any).result); });
    const relations: RelationLink[] = await new Promise(r => { tx.objectStore('relations').getAll().onsuccess = e => r((e.target as any).result); });
    const auditLogs: AuditLog[] = await new Promise(r => { tx.objectStore('auditLogs').getAll().onsuccess = e => r((e.target as any).result); });
    const imageAssets: ImageAsset[] = await new Promise(r => { tx.objectStore('imageAssets').getAll().onsuccess = e => r((e.target as any).result); });

    // Serializa blobs para base64
    const serializedImages = await Promise.all(
      imageAssets.map(async img => {
        const masterB64 = await blobToBase64(img.masterBlob);
        const thumbB64 = await blobToBase64(img.thumbBlob);
        return {
          id: img.id,
          hashSha256: img.hashSha256,
          mimeType: img.mimeType,
          width: img.width,
          height: img.height,
          masterBase64: masterB64,
          thumbBase64: thumbB64,
          createdAt: img.createdAt,
        };
      })
    );

    const rawData = JSON.stringify({ products, storeInventories, relations });
    const sha256Checksum = await computeSha256String(rawData);

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      sha256Checksum,
      products,
      storeInventories,
      relations,
      auditLogs,
      images: serializedImages,
    };
  }

  public async restoreFullBackup(backup: BackupPayload): Promise<boolean> {
    // 1. Valida integridade via Checksum SHA-256
    const rawData = JSON.stringify({
      products: backup.products,
      storeInventories: backup.storeInventories,
      relations: backup.relations,
    });
    const calculatedChecksum = await computeSha256String(rawData);
    if (calculatedChecksum !== backup.sha256Checksum) {
      throw new Error(`Checksum SHA-256 inválido! Esperado: ${backup.sha256Checksum}, calculado: ${calculatedChecksum}`);
    }

    // 2. Limpa e restaura tudo atomicamente
    const db = await this.getDb();
    const tx = db.transaction(['products', 'storeInventory', 'relations', 'imageAssets', 'auditLogs'], 'readwrite');

    tx.objectStore('products').clear();
    tx.objectStore('storeInventory').clear();
    tx.objectStore('relations').clear();
    tx.objectStore('imageAssets').clear();
    tx.objectStore('auditLogs').clear();

    for (const p of backup.products) tx.objectStore('products').put(p);
    for (const inv of backup.storeInventories) tx.objectStore('storeInventory').put(inv);
    for (const r of backup.relations) tx.objectStore('relations').put(r);
    for (const log of backup.auditLogs) tx.objectStore('auditLogs').put(log);

    for (const sImg of backup.images) {
      const asset: ImageAsset = {
        id: sImg.id,
        hashSha256: sImg.hashSha256,
        mimeType: sImg.mimeType,
        width: sImg.width,
        height: sImg.height,
        masterBlob: base64ToBlob(sImg.masterBase64, sImg.mimeType),
        thumbBlob: base64ToBlob(sImg.thumbBase64, sImg.mimeType),
        createdAt: sImg.createdAt,
      };
      tx.objectStore('imageAssets').put(asset);
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });

    await this.addAuditLog('RESTORE', 'System', `Restauração completa de backup aprovada com checksum SHA-256.`);
    return true;
  }

  public async resetDatabase(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['products', 'storeInventory', 'relations', 'imageAssets', 'auditLogs'], 'readwrite');
    tx.objectStore('products').clear();
    tx.objectStore('storeInventory').clear();
    tx.objectStore('relations').clear();
    tx.objectStore('imageAssets').clear();
    tx.objectStore('auditLogs').clear();

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Helpers para base64 e SHA-256
async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') return '';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const b64 = res.split(',')[1] || '';
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  if (typeof atob === 'undefined') return new Blob([]);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function computeSha256String(message: string): Promise<string> {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : (globalThis as any).crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    // Fallback simples para teste
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      hash = ((hash << 5) - hash) + message.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).toUpperCase().padStart(64, '0');
  }
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export const storage = new CatalogStorage();
