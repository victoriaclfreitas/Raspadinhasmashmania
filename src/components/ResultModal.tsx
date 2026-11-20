import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Award, MessageCircle, Sparkles, Utensils } from 'lucide-react';
import type { Participation, Prize } from '../types/promo';

interface ResultModalProps {
  isOpen: boolean;
  prize: Prize | null;
  participation: Participation | null;
  brandName: string;
  onClose: () => void;
}

export function ResultModal({
  isOpen,
  prize,
  participation,
  brandName,
  onClose,
}: ResultModalProps) {
  useEffect(() => {
    if (isOpen && prize && !prize.isNoWin) {
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [isOpen, prize]);

  if (!isOpen || !prize) return null;

  const isWin = !prize.isNoWin;
  const code = participation?.redemptionCode || 'SMASH-PRMO';
  const whatsappText = encodeURIComponent(
    `Olá ${brandName}! Ganhei na Raspadinha Digital! Meu prêmio: ${prize.name}. Código de resgate: ${code}`
  );
  const whatsappHref = `https://wa.me/5562982606386?text=${whatsappText}`;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-prize-title"
    >
      <div className="bg-[#121212] border border-neutral-800 rounded-3xl max-w-sm w-full p-6 text-center space-y-5 shadow-2xl relative overflow-hidden">
        <div className="w-20 h-20 mx-auto rounded-full bg-[#ED2525]/10 border border-[#ED2525]/40 flex items-center justify-center shadow-inner">
          {isWin ? (
            <Award className="w-10 h-10 text-[#FFD700]" />
          ) : (
            <Utensils className="w-9 h-9 text-neutral-400" />
          )}
        </div>

        <div className="space-y-1">
          <div
            className={`text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 ${
              isWin ? 'text-[#FFD700]' : 'text-neutral-400'
            }`}
          >
            {isWin && <Sparkles className="w-3.5 h-3.5" />}
            <span>{isWin ? 'PARABÉNS! VOCÊ GANHOU!' : 'QUE PENA!'}</span>
          </div>
          <h3
            id="result-prize-title"
            className="font-impact text-3xl sm:text-4xl text-white uppercase leading-none pt-1 text-balance"
          >
            {prize.name}
          </h3>
          <p className="text-xs text-neutral-300 pt-2 leading-relaxed">
            {isWin
              ? 'Apresente o código promocional no balcão ou envie no WhatsApp para resgatar!'
              : 'Não foi dessa vez! Mas não desanime, seu próximo Smash está te esperando.'}
          </p>
        </div>

        {isWin && (
          <div className="bg-neutral-900 border border-dashed border-[#FFD700]/60 p-3.5 rounded-xl space-y-1">
            <span className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold block">
              CÓDIGO DE RESGATE ÚNICO
            </span>
            <div className="font-mono tabular-nums font-bold text-2xl text-[#FFD700] tracking-wider select-all">
              {code}
            </div>
            <div className="text-[11px] text-neutral-400">
              Validade: 7 dias após emissão
            </div>
          </div>
        )}

        <div className="space-y-2.5 pt-1">
          {isWin && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[44px] py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 shadow-lg whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span>Resgatar pelo WhatsApp</span>
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold text-xs rounded-xl transition whitespace-nowrap"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
