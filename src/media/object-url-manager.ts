/**
 * Gerenciador de Ciclo de Vida de Object URLs (Zero Memory Leaks).
 */
export class ObjectUrlManager {
  private activeUrls: Set<string> = new Set();

  public createUrl(blob: Blob): string {
    if (typeof URL === 'undefined' || !URL.createObjectURL) {
      return '';
    }
    const url = URL.createObjectURL(blob);
    this.activeUrls.add(url);
    return url;
  }

  public revokeUrl(url: string): void {
    if (this.activeUrls.has(url)) {
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(url);
      }
      this.activeUrls.delete(url);
    }
  }

  public revokeAll(): void {
    for (const url of this.activeUrls) {
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(url);
      }
    }
    this.activeUrls.clear();
  }

  public get activeCount(): number {
    return this.activeUrls.size;
  }
}

export const urlManager = new ObjectUrlManager();
