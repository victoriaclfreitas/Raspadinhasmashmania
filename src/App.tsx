import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Info,
  Lock,
  X,
  XCircle,
} from 'lucide-react';
import { AdminDashboard, type AdminTab } from './components/AdminDashboard';
import { BrandLogo } from './components/BrandLogo';
import { ResultModal } from './components/ResultModal';
import { ScratchCardBoard } from './components/ScratchCardBoard';
import {
  adminChangePassword,
  adminDeletePrize,
  adminSaveConfig,
  adminSavePrize,
  adminToggleRedeemed,
  fetchAdminDashboard,
  fetchPublicPromoData,
  getDefaultState,
  playScratchcardSecure,
  sanitizeHexColor,
  sanitizeHttpUrl,
  saveLocalPublicCache,
  verifyAdminPassword,
} from './services/promoService';
import type {
  BrandConfig,
  CampaignSettings,
  DataStatus,
  Participation,
  Prize,
  PromoState,
  ToastMessage,
  ToastType,
} from './types/promo';

type ViewMode = 'home' | 'scratch' | 'admin';

interface ActiveSession {
  phone: string;
  prizeOutcome: Prize | null;
  cardResults: Prize[];
  participation: Participation | null;
}

function formatPhoneInput(raw: string): string {
  let value = raw.replace(/\D/g, '');
  if (value.length > 11) value = value.slice(0, 11);

  if (value.length > 10) {
    return value.replace(/^(\d{2})(\d{5})(\d{4}).*/, '($1) $2-$3');
  }
  if (value.length > 6) {
    return value.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3');
  }
  if (value.length > 2) {
    return value.replace(/^(\d{2})(\d{0,5}).*/, '($1) $2');
  }
  if (value.length > 0) {
    return value.replace(/^(\d{0,2}).*/, '($1');
  }
  return '';
}

function isValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length === 11;
}

function formatDateBR(isoDate: string): string {
  if (!isoDate || !isoDate.includes('-')) return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export default function App() {
  const [promoState, setPromoState] = useState<PromoState>(getDefaultState);
  const [dataStatus, setDataStatus] = useState<DataStatus>({
    source: 'local_fallback',
    tablesReady: false,
    security: {
      rlsLockedDown: false,
      rpcReady: false,
      directParticipationsBlocked: false,
      directConfigHashBlocked: false,
    },
  });
  const [view, setView] = useState<ViewMode>('home');
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>('prizes');
  const [isSyncing, setIsSyncing] = useState(true);
  const [isSubmittingPhone, setIsSubmittingPhone] = useState(false);

  const [phoneInput, setPhoneInput] = useState('');
  const [phoneError, setPhoneError] = useState(false);

  const [session, setSession] = useState<ActiveSession>({
    phone: '',
    prizeOutcome: null,
    cardResults: [],
    participation: null,
  });
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);

  // Admin auth stored strictly in volatile memory during active session
  const [adminAuthOpen, setAdminAuthOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminSessionSecret, setAdminSessionSecret] = useState<string | null>(
    null
  );
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const loadPublicData = useCallback(async () => {
    setIsSyncing(true);
    try {
      const { state, status } = await fetchPublicPromoData();
      setPromoState(state);
      setDataStatus(status);
      return status;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const refreshAdminView = useCallback(
    async (secret: string, currentStatus?: DataStatus) => {
      setIsSyncing(true);
      try {
        const statusToUse = currentStatus ?? (await loadPublicData());
        const res = await fetchAdminDashboard(secret, statusToUse);
        if (res.ok) {
          setPromoState(res.state);
          saveLocalPublicCache(res.state);
        } else {
          showToast(res.error, 'error');
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [loadPublicData, showToast]
  );

  useEffect(() => {
    void loadPublicData();
  }, [loadPublicData]);

  useEffect(() => {
    const color = sanitizeHexColor(promoState.branding.primaryColor);
    document.documentElement.style.setProperty('--color-brand-red', color);
    document.title = `${promoState.branding.name} - Raspadinha Digital`;
  }, [promoState.branding.primaryColor, promoState.branding.name]);

  const handlePhoneSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const rawPhone = phoneInput.trim();

    if (!isValidPhone(rawPhone)) {
      setPhoneError(true);
      showToast(
        'Insira um número de WhatsApp válido com 11 dígitos (DDD + 9 dígitos).',
        'error'
      );
      return;
    }

    setPhoneError(false);
    setIsSubmittingPhone(true);

    try {
      const cleanPhone = rawPhone.replace(/\D/g, '');
      const outcome = await playScratchcardSecure(
        cleanPhone,
        rawPhone,
        promoState,
        dataStatus
      );

      if (!outcome.ok) {
        showToast(outcome.message, 'warning');
        return;
      }

      setSession({
        phone: rawPhone,
        prizeOutcome: outcome.prize,
        cardResults: outcome.cardResults,
        participation: outcome.participation,
      });
      setResultModalOpen(false);
      setView('scratch');
      window.scrollTo(0, 0);
      showToast(
        'Raspadinha liberada! Raspe os 3 quadradinhos até 60%.',
        'success'
      );
      void loadPublicData();
    } finally {
      setIsSubmittingPhone(false);
    }
  };

  const handleOpenAdminModal = (tab: AdminTab = 'prizes') => {
    setAdminInitialTab(tab);
    if (adminSessionSecret) {
      setView('admin');
      void refreshAdminView(adminSessionSecret);
      return;
    }
    setAdminAuthOpen(true);
  };

  const handleAdminLogin = async (e: FormEvent) => {
    e.preventDefault();
    const input = adminPasswordInput.trim();
    if (!input) return;

    setIsAuthenticating(true);
    try {
      const valid = await verifyAdminPassword(input);
      if (!valid) {
        showToast('Senha incorreta!', 'error');
        return;
      }

      setAdminSessionSecret(input);
      setAdminPasswordInput('');
      setAdminAuthOpen(false);
      setView('admin');
      await refreshAdminView(input, dataStatus);
      showToast('Autenticado com sucesso como Administrador!', 'success');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleExitAdmin = () => {
    setAdminSessionSecret(null);
    setView('home');
    void loadPublicData();
  };

  const handleSavePrize = async (prize: Prize) => {
    if (!adminSessionSecret) return;
    const res = await adminSavePrize(adminSessionSecret, prize, dataStatus);
    if (!res.ok) {
      showToast(`Erro no Supabase: ${res.error}`, 'error');
      return;
    }
    await refreshAdminView(adminSessionSecret, dataStatus);
    showToast('Prêmio salvo com sucesso!', 'success');
  };

  const handleDeletePrize = async (id: string) => {
    if (!adminSessionSecret) return;
    const res = await adminDeletePrize(adminSessionSecret, id, dataStatus);
    if (!res.ok) {
      showToast(`Erro no Supabase: ${res.error}`, 'error');
      return;
    }
    await refreshAdminView(adminSessionSecret, dataStatus);
    showToast('Prêmio removido com sucesso.', 'info');
  };

  const handleToggleRedeemed = async (id: string) => {
    if (!adminSessionSecret) return;
    const target = promoState.participations.find((p) => p.id === id);
    if (!target) return;
    const nextRedeemed = !target.redeemed;
    const res = await adminToggleRedeemed(
      adminSessionSecret,
      id,
      nextRedeemed,
      dataStatus
    );
    if (!res.ok) {
      showToast(`Erro no Supabase: ${res.error}`, 'error');
      return;
    }
    await refreshAdminView(adminSessionSecret, dataStatus);
    showToast('Status de resgate atualizado!', 'success');
  };

  const handleSaveBranding = async (branding: BrandConfig) => {
    if (!adminSessionSecret) return;
    const cleanBranding: BrandConfig = {
      name: branding.name,
      logoUrl: sanitizeHttpUrl(branding.logoUrl),
      primaryColor: sanitizeHexColor(branding.primaryColor),
      subtitle: branding.subtitle,
    };
    const res = await adminSaveConfig(
      adminSessionSecret,
      cleanBranding,
      promoState.settings,
      dataStatus
    );
    if (!res.ok) {
      showToast(`Erro no Supabase: ${res.error}`, 'error');
      return;
    }
    await refreshAdminView(adminSessionSecret, dataStatus);
    showToast('Configurações de marca atualizadas!', 'success');
  };

  const handleSaveSettings = async (settings: CampaignSettings) => {
    if (!adminSessionSecret) return;
    const res = await adminSaveConfig(
      adminSessionSecret,
      promoState.branding,
      settings,
      dataStatus
    );
    if (!res.ok) {
      showToast(`Erro no Supabase: ${res.error}`, 'error');
      return;
    }
    await refreshAdminView(adminSessionSecret, dataStatus);
    showToast('Configurações da campanha atualizadas com sucesso!', 'success');
  };

  const handleChangePassword = async (newPassword: string): Promise<boolean> => {
    if (!adminSessionSecret) return false;
    const res = await adminChangePassword(
      adminSessionSecret,
      newPassword,
      dataStatus
    );
    if (!res.ok) {
      showToast(`Erro ao atualizar senha: ${res.error}`, 'error');
      return false;
    }
    setAdminSessionSecret(newPassword);
    showToast('Senha administrativa atualizada com sucesso!', 'success');
    return true;
  };

  const activeRewardPrizes = promoState.prizes.filter(
    (p) => p.active && !p.isNoWin && p.qty > 0
  );

  return (
    <div className="min-h-screen flex flex-col justify-between text-white">
      {/* TOP HEADER */}
      <header className="w-full bg-[#0d0707]/90 backdrop-blur border-b border-red-950/40 sticky top-0 z-40 px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex justify-between items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (view === 'admin') {
                handleExitAdmin();
              } else {
                setView('home');
              }
            }}
            className="flex items-center gap-2 text-left whitespace-nowrap shrink-0 focus:outline-none"
          >
            <BrandLogo
              src={sanitizeHttpUrl(promoState.branding.logoUrl)}
              alt={promoState.branding.name}
              className="h-10 sm:h-11 w-auto object-contain rounded-md"
              fallbackSize="sm"
            />
          </button>

          <span className="text-xs font-bold text-[#e5b33a] uppercase tracking-widest whitespace-nowrap shrink-0">
            PROMOÇÃO OFICIAL
          </span>
        </div>
      </header>

      {/* TOAST CONTAINER */}
      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => {
          const styleMap: Record<ToastType, string> = {
            info: 'border-neutral-700 bg-neutral-900 text-white',
            success: 'border-emerald-800 bg-emerald-950 text-white',
            error: 'border-brand-red bg-red-950 text-white',
            warning: 'border-amber-800 bg-amber-950 text-white',
          };
          const IconComp =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error'
              ? XCircle
              : toast.type === 'warning'
              ? AlertTriangle
              : Info;

          const iconColor =
            toast.type === 'success'
              ? 'text-emerald-400'
              : toast.type === 'error'
              ? 'text-brand-red'
              : toast.type === 'warning'
              ? 'text-amber-400'
              : 'text-sky-400';

          return (
            <div
              key={toast.id}
              className={`p-3.5 rounded-xl border ${styleMap[toast.type]} shadow-2xl text-xs font-semibold flex items-center gap-3 pointer-events-auto`}
            >
              <IconComp className={`w-4 h-4 shrink-0 ${iconColor}`} />
              <span>{toast.message}</span>
            </div>
          );
        })}
      </div>

      {/* MAIN CONTENT */}
      <main className="flex-grow flex items-center justify-center px-4 py-6 relative">
        {view === 'home' && (
          <section className="w-full max-w-md mx-auto text-center space-y-5">
            <div className="flex justify-center pt-1">
              <BrandLogo
                src={sanitizeHttpUrl(promoState.branding.logoUrl)}
                alt={promoState.branding.name}
                className="h-32 sm:h-40 w-auto object-contain rounded-xl drop-shadow-[0_12px_24px_rgba(237,37,37,0.35)] hover:scale-105 transition duration-300"
                fallbackSize="lg"
              />
            </div>

            <div className="space-y-2">
              <div className="text-[#e5b33a] font-bold text-xs sm:text-sm tracking-widest uppercase">
                TEM PRÊMIO NA ÁREA
              </div>

              <h1 className="font-impact text-6xl sm:text-7xl text-white tracking-wider uppercase leading-none drop-shadow-lg text-balance">
                RASPOU.
                <br />
                <span className="text-brand-red drop-shadow-[0_4px_15px_rgba(237,37,37,0.5)]">
                  GANHOU?
                </span>
              </h1>

              <p className="text-neutral-300 text-sm leading-relaxed max-w-xs mx-auto pt-1">
                {promoState.branding.subtitle}
              </p>
            </div>

            <div className="w-full max-w-sm mx-auto space-y-3.5">
              <form onSubmit={handlePhoneSubmit} className="space-y-3.5">
                <div>
                  <input
                    type="text"
                    value={phoneInput}
                    onChange={(e) => {
                      setPhoneInput(formatPhoneInput(e.target.value));
                      if (phoneError) setPhoneError(false);
                    }}
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                    inputMode="numeric"
                    required
                    aria-label="WhatsApp com DDD"
                    className={`w-full py-3.5 px-4 bg-[#111111]/90 border rounded-2xl text-white placeholder-neutral-600 focus:outline-none focus:border-brand-red font-impact text-2xl tracking-widest text-center transition shadow-inner ${
                      phoneError ? 'border-brand-red' : 'border-neutral-700/80'
                    }`}
                  />
                  {phoneError && (
                    <p className="text-xs text-brand-red font-semibold mt-2 flex items-center justify-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Por favor, insira um número de WhatsApp válido.
                      </span>
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingPhone}
                  className="w-full min-h-[56px] py-3.5 bg-brand-red hover:bg-brand-red-dark disabled:opacity-60 text-white font-impact tracking-widest text-3xl uppercase rounded-2xl btn-glow active:scale-95 shadow-xl"
                >
                  {isSubmittingPhone ? 'VALIDANDO...' : 'QUERO RASPAR'}
                </button>
              </form>

              <p className="text-[11px] text-neutral-400 leading-tight pt-1 flex items-center justify-center gap-1.5">
                <Lock className="w-3 h-3 text-[#d4af37] shrink-0" />
                <span>
                  Seu número é usado apenas para validar sua participação no resgate.
                </span>
              </p>

              <div className="pt-4 text-xs text-neutral-400 space-y-1">
                <div className="font-impact tracking-wider text-neutral-300 uppercase">
                  © {promoState.branding.name}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => setRulesModalOpen(true)}
                    className="inline-flex items-center gap-1 text-neutral-400 hover:text-white transition text-[11px]"
                  >
                    <ChevronDown className="w-3 h-3" />
                    <span>Regulamento</span>
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500 leading-tight pt-2 max-w-xs mx-auto">
                  Promoção válida enquanto durarem os estoques. Limite de{' '}
                  {promoState.settings.maxPerPhone} participação(ões) por
                  telefone conforme regulamento.
                </p>
              </div>
            </div>
          </section>
        )}

        {view === 'scratch' && (
          <ScratchCardBoard
            cardResults={session.cardResults}
            brandName={promoState.branding.name}
            primaryColor={sanitizeHexColor(promoState.branding.primaryColor)}
            onAllRevealed={() => setResultModalOpen(true)}
          />
        )}

        {view === 'admin' && adminSessionSecret && (
          <AdminDashboard
            state={promoState}
            dataStatus={dataStatus}
            initialTab={adminInitialTab}
            isSyncing={isSyncing}
            onBackHome={handleExitAdmin}
            onSavePrize={handleSavePrize}
            onDeletePrize={handleDeletePrize}
            onToggleRedeemed={handleToggleRedeemed}
            onSaveBranding={handleSaveBranding}
            onSaveSettings={handleSaveSettings}
            onChangePassword={handleChangePassword}
            onRefreshSupabase={async () => {
              await refreshAdminView(adminSessionSecret);
              showToast('Auditoria e dados atualizados!', 'info');
            }}
            onShowToast={showToast}
          />
        )}
      </main>

      {/* RESULT MODAL */}
      <ResultModal
        isOpen={resultModalOpen}
        prize={session.prizeOutcome}
        participation={session.participation}
        brandName={promoState.branding.name}
        onClose={() => {
          setResultModalOpen(false);
          setView('home');
        }}
      />

      {/* REGULATION MODAL */}
      {rulesModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#121212] border border-neutral-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-left">
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#FFD700]" />
                <h3 className="font-impact text-2xl text-white tracking-wide">
                  REGULAMENTO DA CAMPANHA
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRulesModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg"
                aria-label="Fechar regulamento"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
              <p>
                <strong className="text-white">Promotora:</strong>{' '}
                {promoState.branding.name}
              </p>
              <p>
                <strong className="text-white">Vigência:</strong> de{' '}
                <span className="font-mono tabular-nums text-white">
                  {formatDateBR(promoState.settings.startDate)}
                </span>{' '}
                até{' '}
                <span className="font-mono tabular-nums text-white">
                  {formatDateBR(promoState.settings.endDate)}
                </span>{' '}
                (ou enquanto durarem os estoques).
              </p>
              <p>
                <strong className="text-white">Limite de participação:</strong>{' '}
                até{' '}
                <span className="font-mono tabular-nums text-white">
                  {promoState.settings.maxPerPhone}
                </span>{' '}
                jogada(s) por número de WhatsApp cadastrado.
              </p>
              <p>
                <strong className="text-white">Resgate:</strong> ao ganhar, o
                código único exibido na tela tem validade de 7 dias e deve ser
                apresentado no balcão ou enviado pelo WhatsApp oficial.
              </p>

              <div className="pt-1">
                <div className="text-white font-bold mb-1.5">
                  Prêmios disponíveis no momento:
                </div>
                {activeRewardPrizes.length === 0 ? (
                  <p className="text-neutral-500">
                    Nenhum prêmio disponível no estoque atual.
                  </p>
                ) : (
                  <ul className="space-y-1 text-neutral-300">
                    {activeRewardPrizes.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between border-b border-neutral-800/70 py-1"
                      >
                        <span>{p.name}</span>
                        <span className="font-mono tabular-nums text-neutral-400">
                          {p.qty} un.
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setRulesModalOpen(false)}
              className="w-full min-h-[42px] py-2 bg-brand-red hover:bg-brand-red-dark text-white text-xs font-bold rounded-lg transition"
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      {/* ADMIN AUTH MODAL */}
      {adminAuthOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#121212] border border-neutral-800 rounded-2xl max-w-xs w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 bg-neutral-900 border border-neutral-700 rounded-full flex items-center justify-center text-brand-red mx-auto">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-impact text-2xl text-white">
                ACESSO ADMINISTRATIVO
              </h3>
              <p className="text-xs text-neutral-400">
                Insira a senha do gerente para prosseguir.
              </p>
            </div>
            <form onSubmit={handleAdminLogin} className="space-y-3">
              <input
                type="password"
                value={adminPasswordInput}
                onChange={(e) => setAdminPasswordInput(e.target.value)}
                placeholder="Senha de acesso"
                required
                autoFocus
                className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-center text-sm focus:outline-none focus:border-brand-red"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdminAuthOpen(false);
                    setAdminPasswordInput('');
                  }}
                  className="w-1/2 min-h-[40px] py-2 bg-neutral-800 text-neutral-300 text-xs font-bold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-1/2 min-h-[40px] py-2 bg-brand-red text-white text-xs font-bold rounded-lg hover:bg-brand-red-dark disabled:opacity-60"
                >
                  {isAuthenticating ? 'Verificando...' : 'Entrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="w-full bg-[#121212]/90 border-t border-neutral-800/80 py-4 px-4 text-center text-xs text-neutral-500">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            © {promoState.branding.name.toUpperCase()} — Todos os direitos
            reservados.
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleOpenAdminModal('prizes')}
              className="hover:text-brand-red transition"
            >
              Acesso Administrativo
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => handleOpenAdminModal('database')}
              className="hover:text-[#FFD700] transition"
            >
              Segurança & RLS
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
