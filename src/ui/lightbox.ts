import { icons } from './icons';

export class Lightbox {
  private overlay: HTMLElement | null = null;
  private currentZoom = 1.0;
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private translateX = 0;
  private translateY = 0;
  private images: string[] = [];
  private currentIndex = 0;
  private title = '';

  public open(imagesInput: string[] | string, title: string, initialIndex = 0): void {
    this.close();
    this.images = Array.isArray(imagesInput) ? imagesInput : [imagesInput];
    if (this.images.length === 0) return;

    this.currentIndex = Math.max(0, Math.min(initialIndex, this.images.length - 1));
    this.title = title;
    this.currentZoom = 1.0;
    this.translateX = 0;
    this.translateY = 0;

    this.overlay = document.createElement('div');
    this.overlay.className = 'fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-3 select-none animate-fadeIn';

    this.render();
    document.body.appendChild(this.overlay);
    this.bindEvents();
  }

  private render(): void {
    if (!this.overlay) return;
    const currentUrl = this.images[this.currentIndex];
    const totalAngles = this.images.length;

    this.overlay.innerHTML = `
      <!-- Top Navigation Bar -->
      <div class="w-full flex items-center justify-between text-white py-2 px-4 z-20 bg-slate-950/60 rounded-xl backdrop-blur-sm">
        <div class="flex items-center gap-3">
          <span class="font-mono text-sm uppercase tracking-wider text-slate-200 font-bold">${this.title}</span>
          ${totalAngles > 1 ? `
            <span id="lb-angle-counter" class="bg-blue-600 text-white text-xs px-2.5 py-0.5 rounded-full font-mono font-bold">
              Ângulo ${this.currentIndex + 1} de ${totalAngles}
            </span>
          ` : ''}
          <span id="lb-zoom-label" class="bg-slate-800 text-xs px-2 py-0.5 rounded font-mono text-blue-400">100%</span>
        </div>

        <div class="flex items-center gap-2">
          <button id="lb-zoom-out" class="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition cursor-pointer" title="Reduzir Zoom (50%)">
            ${icons.zoomOut('w-5 h-5')}
          </button>
          <button id="lb-zoom-in" class="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition cursor-pointer" title="Aumentar Zoom (400%)">
            ${icons.zoomIn('w-5 h-5')}
          </button>
          <button id="lb-zoom-reset" class="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 rounded text-slate-300 hover:text-white transition cursor-pointer">
            Reset
          </button>
          <button id="lb-close" class="p-2 hover:bg-red-600 rounded-lg text-slate-300 hover:text-white transition ml-2 cursor-pointer" title="Fechar (Esc)">
            ${icons.close('w-6 h-6')}
          </button>
        </div>
      </div>

      <!-- Main Viewport with Navigation Chevrons -->
      <div id="lb-viewport" class="flex-1 w-full h-full flex items-center justify-center overflow-hidden cursor-grab relative my-2">
        ${totalAngles > 1 ? `
          <button id="lb-prev-angle" class="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 bg-slate-900/80 hover:bg-blue-600 text-white rounded-full transition shadow-xl cursor-pointer hover:scale-110 active:scale-95 border border-slate-700" title="Ângulo Anterior (Seta Esquerda)">
            ${icons.chevronLeft('w-6 h-6')}
          </button>
          <button id="lb-next-angle" class="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 bg-slate-900/80 hover:bg-blue-600 text-white rounded-full transition shadow-xl cursor-pointer hover:scale-110 active:scale-95 border border-slate-700" title="Próximo Ângulo (Seta Direita)">
            ${icons.chevronRight('w-6 h-6')}
          </button>
        ` : ''}

        <img id="lb-img" src="${currentUrl}" alt="${this.title}" class="max-w-[90vw] max-h-[72vh] object-contain transition-transform duration-75 select-none pointer-events-auto drop-shadow-2xl" style="transform: translate(0px, 0px) scale(1);" draggable="false" />
      </div>

      <!-- Bottom Thumbnail Carousel and Instructions -->
      <div class="w-full flex flex-col items-center gap-2 z-20">
        ${totalAngles > 1 ? `
          <div class="flex items-center gap-2 p-1.5 bg-slate-950/80 rounded-2xl border border-slate-800 max-w-full overflow-x-auto">
            ${this.images.map((url, idx) => `
              <button class="lb-thumb-btn w-14 h-14 rounded-xl overflow-hidden border-2 transition-all p-1 bg-white cursor-pointer shrink-0 ${idx === this.currentIndex ? 'border-blue-500 scale-105 shadow-md shadow-blue-500/40 ring-2 ring-blue-500/50' : 'border-transparent opacity-60 hover:opacity-100 hover:border-slate-500'}" data-thumb-idx="${idx}">
                <img src="${url}" class="w-full h-full object-contain" />
              </button>
            `).join('')}
          </div>
        ` : ''}

        <div class="text-[11px] text-slate-400 font-sans flex items-center gap-4">
          <span>Dica: Use as setas <kbd class="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-slate-300">←</kbd> <kbd class="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-slate-300">→</kbd> do teclado para trocar de ângulo</span>
          <span>•</span>
          <span>Zoom com scroll ou arrasto da peça</span>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.overlay) return;

    const img = this.overlay.querySelector<HTMLImageElement>('#lb-img')!;
    const viewport = this.overlay.querySelector<HTMLElement>('#lb-viewport')!;
    const zoomLabel = this.overlay.querySelector<HTMLElement>('#lb-zoom-label')!;

    const updateTransform = () => {
      img.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.currentZoom})`;
      zoomLabel.textContent = `${Math.round(this.currentZoom * 100)}%`;
      if (this.currentZoom > 1.05) {
        viewport.classList.remove('cursor-grab');
        viewport.classList.add('cursor-move');
      } else {
        viewport.classList.remove('cursor-move');
        viewport.classList.add('cursor-grab');
      }
    };

    const changeAngle = (newIndex: number) => {
      if (newIndex < 0) newIndex = this.images.length - 1;
      if (newIndex >= this.images.length) newIndex = 0;
      this.currentIndex = newIndex;
      this.currentZoom = 1.0;
      this.translateX = 0;
      this.translateY = 0;
      this.render();
      this.bindEvents();
    };

    // Navegação de Ângulos
    this.overlay.querySelector('#lb-prev-angle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      changeAngle(this.currentIndex - 1);
    });

    this.overlay.querySelector('#lb-next-angle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      changeAngle(this.currentIndex + 1);
    });

    // Thumbnails
    this.overlay.querySelectorAll('.lb-thumb-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-thumb-idx') || '0', 10);
        changeAngle(idx);
      });
    });

    // Zoom In
    this.overlay.querySelector('#lb-zoom-in')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.currentZoom = Math.min(4.0, this.currentZoom + 0.5);
      updateTransform();
    });

    // Zoom Out
    this.overlay.querySelector('#lb-zoom-out')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.currentZoom = Math.max(0.5, this.currentZoom - 0.5);
      if (this.currentZoom <= 1.0) {
        this.translateX = 0;
        this.translateY = 0;
      }
      updateTransform();
    });

    // Reset Zoom
    this.overlay.querySelector('#lb-zoom-reset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.currentZoom = 1.0;
      this.translateX = 0;
      this.translateY = 0;
      updateTransform();
    });

    // Drag to Pan
    viewport.addEventListener('mousedown', (e) => {
      if (this.currentZoom <= 1.0) return;
      this.isDragging = true;
      this.startX = e.clientX - this.translateX;
      this.startY = e.clientY - this.translateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.translateX = e.clientX - this.startX;
      this.translateY = e.clientY - this.startY;
      updateTransform();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Wheel Zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      this.currentZoom = Math.min(4.0, Math.max(0.5, this.currentZoom + delta));
      if (this.currentZoom <= 1.0) {
        this.translateX = 0;
        this.translateY = 0;
      }
      updateTransform();
    }, { passive: false });

    // Close on button or backdrop click
    this.overlay.querySelector('#lb-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay || e.target === viewport) {
        this.close();
      }
    });

    // Teclado: ArrowLeft / ArrowRight para trocar ângulos, Escape para fechar
    const onKey = (e: KeyboardEvent) => {
      if (!this.overlay) {
        window.removeEventListener('keydown', onKey);
        return;
      }
      if (e.key === 'Escape') {
        this.close();
        window.removeEventListener('keydown', onKey);
      } else if (e.key === 'ArrowLeft' && this.images.length > 1) {
        e.preventDefault();
        changeAngle(this.currentIndex - 1);
      } else if (e.key === 'ArrowRight' && this.images.length > 1) {
        e.preventDefault();
        changeAngle(this.currentIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
  }

  public close(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
    }
  }
}

export const lightbox = new Lightbox();
