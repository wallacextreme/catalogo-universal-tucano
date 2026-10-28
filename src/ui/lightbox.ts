import { icons } from './icons';

export class Lightbox {
  private overlay: HTMLElement | null = null;
  private currentZoom = 1.0;
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private translateX = 0;
  private translateY = 0;

  public open(imageUrl: string, title: string): void {
    this.close();
    this.currentZoom = 1.0;
    this.translateX = 0;
    this.translateY = 0;

    this.overlay = document.createElement('div');
    this.overlay.className = 'fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-between p-4 select-none animate-fadeIn';

    this.overlay.innerHTML = `
      <div class="w-full flex items-center justify-between text-white py-2 px-4 z-10">
        <div class="flex items-center gap-3">
          <span class="font-mono text-sm uppercase tracking-wider text-slate-300">${title}</span>
          <span id="lb-zoom-label" class="bg-slate-800 text-xs px-2 py-0.5 rounded font-mono text-blue-400">100%</span>
        </div>
        <div class="flex items-center gap-2">
          <button id="lb-zoom-out" class="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition" title="Reduzir Zoom (50%)">
            ${icons.zoomOut('w-5 h-5')}
          </button>
          <button id="lb-zoom-in" class="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition" title="Aumentar Zoom (400%)">
            ${icons.zoomIn('w-5 h-5')}
          </button>
          <button id="lb-zoom-reset" class="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 rounded text-slate-300 hover:text-white transition">
            Reset
          </button>
          <button id="lb-close" class="p-2 hover:bg-red-600 rounded-lg text-slate-300 hover:text-white transition ml-2" title="Fechar (Esc)">
            ${icons.close('w-6 h-6')}
          </button>
        </div>
      </div>

      <div id="lb-viewport" class="flex-1 w-full h-full flex items-center justify-center overflow-hidden cursor-grab relative">
        <img id="lb-img" src="${imageUrl}" alt="${title}" class="max-w-[90vw] max-h-[80vh] object-contain transition-transform duration-75 select-none pointer-events-auto" style="transform: translate(0px, 0px) scale(1);" draggable="false" />
      </div>

      <div class="text-xs text-slate-400 py-1 text-center font-sans">
        Dica: Arraste para mover a imagem ampliada. Use o scroll do mouse ou os botões para zoom até 400%.
      </div>
    `;

    document.body.appendChild(this.overlay);

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

    // Zoom In
    this.overlay.querySelector('#lb-zoom-in')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.currentZoom = Math.min(4.0, this.currentZoom + 0.5);
      updateTransform();
    });

    // Zoom Out
    this.overlay.querySelector('#lb-zoom-out')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.currentZoom = Math.max(0.5, this.currentZoom - 0.5);
      if (this.currentZoom <= 1.0) {
        this.translateX = 0;
        this.translateY = 0;
      }
      updateTransform();
    });

    // Reset Zoom
    this.overlay.querySelector('#lb-zoom-reset')!.addEventListener('click', (e) => {
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
    this.overlay.querySelector('#lb-close')!.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay || e.target === viewport) {
        this.close();
      }
    });

    // Close on Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        window.removeEventListener('keydown', onKey);
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
