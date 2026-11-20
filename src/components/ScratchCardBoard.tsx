import { useEffect, useRef, useState } from 'react';
import { Gift, Hand, Ticket, XCircle } from 'lucide-react';
import type { Prize } from '../types/promo';

interface ScratchCardBoardProps {
  cardResults: Prize[];
  brandName: string;
  primaryColor: string;
  onAllRevealed: () => void;
}

interface SingleCardProps {
  prize: Prize;
  brandName: string;
  primaryColor: string;
  isDone: boolean;
  onComplete: () => void;
}

function ScratchCardTile({
  prize,
  brandName,
  primaryColor,
  isDone,
  onComplete,
}: SingleCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const completedRef = useRef(false);
  const drawingRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(Math.floor(rect.width), 140);
    const height = Math.max(Math.floor(rect.height), 140);
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = primaryColor || '#ED2525';
    ctx.fillRect(0, 0, width, height);

    // Subtle diagonal pattern on foil
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    for (let i = -height; i < width + height; i += 18) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    ctx.fillStyle = '#121212';
    const fontSize = width < 120 ? 11 : 15;
    ctx.font = `900 ${fontSize}px Montserrat, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RASPE AQUI', width / 2, height / 2);

    const getBrushPos = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      const scaleX = canvas.width / r.width;
      const scaleY = canvas.height / r.height;
      return {
        x: (clientX - r.left) * scaleX,
        y: (clientY - r.top) * scaleY,
      };
    };

    const checkPercentage = () => {
      if (completedRef.current || canvas.width <= 0 || canvas.height <= 0) return;
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imgData.data;
        let transparentPixels = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] === 0) transparentPixels++;
        }
        const totalPixels = pixels.length / 4;
        const clearedPercent = (transparentPixels / totalPixels) * 100;
        if (clearedPercent >= 60) {
          completedRef.current = true;
          onComplete();
        }
      } catch {
        // Ignore security/dimension edge cases
      }
    };

    const scratchAt = (clientX: number, clientY: number) => {
      if (completedRef.current) return;
      const pos = getBrushPos(clientX, clientY);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 24, 0, Math.PI * 2);
      ctx.fill();
      checkPercentage();
    };

    const handlePointerDown = (e: PointerEvent) => {
      drawingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      scratchAt(e.clientX, e.clientY);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      scratchAt(e.clientX, e.clientY);
    };

    const handlePointerUp = () => {
      drawingRef.current = false;
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [prize, primaryColor, onComplete]);

  return (
    <div
      ref={containerRef}
      className="relative bg-[#121212] border border-neutral-800 rounded-xl sm:rounded-2xl overflow-hidden shadow-xl aspect-square flex flex-col items-center justify-center p-1.5 sm:p-3 select-none"
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900 text-center p-1.5 sm:p-3 z-0">
        <div className="mb-1 sm:mb-2">
          {prize.isNoWin ? (
            <XCircle className="w-7 h-7 sm:w-10 sm:h-10 text-neutral-500 mx-auto" />
          ) : (
            <Gift className="w-7 h-7 sm:w-10 sm:h-10 text-[#FFD700] mx-auto" />
          )}
        </div>
        <div className="font-impact text-sm sm:text-2xl text-white uppercase leading-tight text-balance">
          {prize.name}
        </div>
        <div className="text-[9px] sm:text-[10px] text-neutral-400 mt-1 uppercase tracking-wider font-bold">
          {brandName}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className={`scratch-canvas relative z-10 w-full h-full rounded-lg sm:rounded-xl transition-opacity duration-500 ${
          isDone ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />
    </div>
  );
}

export function ScratchCardBoard({
  cardResults,
  brandName,
  primaryColor,
  onAllRevealed,
}: ScratchCardBoardProps) {
  const [doneFlags, setDoneFlags] = useState<[boolean, boolean, boolean]>([
    false,
    false,
    false,
  ]);
  const revealedRef = useRef(false);

  const markCardDone = (index: number) => {
    setDoneFlags((prev) => {
      if (prev[index]) return prev;
      const next: [boolean, boolean, boolean] = [...prev] as [boolean, boolean, boolean];
      next[index] = true;
      if (next.every(Boolean) && !revealedRef.current) {
        revealedRef.current = true;
        setTimeout(() => {
          onAllRevealed();
        }, 550);
      }
      return next;
    });
  };

  return (
    <section className="w-full max-w-2xl mx-auto text-center space-y-5">
      <div className="space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FFD700] uppercase tracking-widest">
          <Ticket className="w-4 h-4" />
          <span>Raspadinha Ativa</span>
        </div>
        <h2 className="font-impact text-4xl sm:text-5xl text-white tracking-wide uppercase pt-1 text-balance">
          É HORA DE <span className="text-brand-red">RASPAR!</span>
        </h2>
        <p className="text-neutral-300 text-xs sm:text-sm font-semibold">
          Encontre <span className="text-[#FFD700] font-bold uppercase">3 prêmios iguais</span> para ganhar!
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3.5 my-4 max-w-xl mx-auto">
        {cardResults.map((prize, idx) => (
          <ScratchCardTile
            key={`${prize.id}-${idx}`}
            prize={prize}
            brandName={brandName}
            primaryColor={primaryColor}
            isDone={doneFlags[idx]}
            onComplete={() => markCardDone(idx)}
          />
        ))}
      </div>

      <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-3 text-xs text-neutral-300 flex items-center justify-center gap-2 max-w-md mx-auto">
        <Hand className="w-4 h-4 text-brand-red shrink-0" />
        <span>Raspe os 3 quadradinhos até 60% para conferir seu resultado!</span>
      </div>
    </section>
  );
}
