import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FileSpreadsheet,
  Gift,
  KeyRound,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
  Trophy,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { SUPABASE_BASE_URL, SUPABASE_SECURITY_SQL } from '../lib/supabase';
import type {
  BrandConfig,
  CampaignSettings,
  DataStatus,
  Participation,
  Prize,
  PromoState,
  ToastType,
} from '../types/promo';

export type AdminTab =
  | 'prizes'
  | 'participations'
  | 'branding'
  | 'settings'
  | 'database';

interface AdminDashboardProps {
  state: PromoState;
  dataStatus: DataStatus;
  initialTab?: AdminTab;
  isSyncing: boolean;
  onBackHome: () => void;
  onSavePrize: (prize: Prize) => Promise<void>;
  onDeletePrize: (id: string) => Promise<void>;
  onToggleRedeemed: (id: string) => Promise<void>;
  onSaveBranding: (branding: BrandConfig) => Promise<void>;
  onSaveSettings: (settings: CampaignSettings) => Promise<void>;
  onChangePassword: (newPassword: string) => Promise<boolean>;
  onRefreshSupabase: () => Promise<void>;
  onShowToast: (message: string, type?: ToastType) => void;
}

function escapeCsvCell(raw: string): string {
  const str = String(raw ?? '');
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

export function AdminDashboard({
  state,
  dataStatus,
  initialTab = 'prizes',
  isSyncing,
  onBackHome,
  onSavePrize,
  onDeletePrize,
  onToggleRedeemed,
  onSaveBranding,
  onSaveSettings,
  onChangePassword,
  onRefreshSupabase,
  onShowToast,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [searchPhone, setSearchPhone] = useState('');
  const [partFilter, setPartFilter] = useState<
    'all' | 'won' | 'lost' | 'pending' | 'redeemed'
  >('all');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Prize Modal State
  const [prizeModalOpen, setPrizeModalOpen] = useState(false);
  const [editingPrizeId, setEditingPrizeId] = useState<string>('');
  const [prizeName, setPrizeName] = useState('');
  const [prizeQty, setPrizeQty] = useState('50');
  const [prizeProb, setPrizeProb] = useState('10');
  const [prizeActive, setPrizeActive] = useState<'true' | 'false'>('true');
  const [savingPrize, setSavingPrize] = useState(false);

  // Branding Form State
  const [brandName, setBrandName] = useState(state.branding.name);
  const [brandLogoUrl, setBrandLogoUrl] = useState(state.branding.logoUrl);
  const [brandColor, setBrandColor] = useState(state.branding.primaryColor);
  const [brandSubtitle, setBrandSubtitle] = useState(state.branding.subtitle);
  const [savingBranding, setSavingBranding] = useState(false);

  // Settings Form State
  const [campaignActive, setCampaignActive] = useState(state.settings.active);
  const [maxPerPhone, setMaxPerPhone] = useState(
    String(state.settings.maxPerPhone || 1)
  );
  const [startDate, setStartDate] = useState(state.settings.startDate);
  const [endDate, setEndDate] = useState(state.settings.endDate);
  const [savingSettings, setSavingSettings] = useState(false);

  // Password Rotation Form State
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setBrandName(state.branding.name);
    setBrandLogoUrl(state.branding.logoUrl);
    setBrandColor(state.branding.primaryColor);
    setBrandSubtitle(state.branding.subtitle);
  }, [state.branding]);

  useEffect(() => {
    setCampaignActive(state.settings.active);
    setMaxPerPhone(String(state.settings.maxPerPhone || 1));
    setStartDate(state.settings.startDate);
    setEndDate(state.settings.endDate);
  }, [state.settings]);

  const totalParticipations = state.participations.length;
  const winnersCount = state.participations.filter(
    (p) => p.result === 'Ganhou'
  ).length;
  const lostCount = state.participations.filter(
    (p) => p.result === 'Perdeu'
  ).length;
  const redeemedCount = state.participations.filter(
    (p) => p.result === 'Ganhou' && p.redeemed
  ).length;
  const pendingCount = state.participations.filter(
    (p) => p.result === 'Ganhou' && !p.redeemed
  ).length;

  const filteredParticipations: Participation[] = state.participations.filter(
    (p) => {
      if (partFilter === 'won' && p.result !== 'Ganhou') return false;
      if (partFilter === 'lost' && p.result !== 'Perdeu') return false;
      if (partFilter === 'pending' && (p.result !== 'Ganhou' || p.redeemed))
        return false;
      if (partFilter === 'redeemed' && (p.result !== 'Ganhou' || !p.redeemed))
        return false;

      const q = searchPhone.trim().toLowerCase();
      if (!q) return true;
      return (
        p.displayPhone.toLowerCase().includes(q) || p.cleanPhone.includes(q)
      );
    }
  );

  const openCreatePrize = () => {
    setEditingPrizeId('');
    setPrizeName('');
    setPrizeQty('50');
    setPrizeProb('10');
    setPrizeActive('true');
    setPrizeModalOpen(true);
  };

  const openEditPrize = (prize: Prize) => {
    setEditingPrizeId(prize.id);
    setPrizeName(prize.name);
    setPrizeQty(String(prize.qty));
    setPrizeProb(String(prize.probability));
    setPrizeActive(prize.active ? 'true' : 'false');
    setPrizeModalOpen(true);
  };

  const handlePrizeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prizeName.trim()) return;
    setSavingPrize(true);
    try {
      const existing = state.prizes.find((p) => p.id === editingPrizeId);
      const nextPrize: Prize = {
        id: existing ? existing.id : `p_${Date.now()}`,
        name: prizeName.trim(),
        qty: Math.max(0, parseInt(prizeQty, 10) || 0),
        distributed: existing ? existing.distributed : 0,
        probability: Math.max(0, Math.min(100, parseFloat(prizeProb) || 0)),
        active: prizeActive === 'true',
        isNoWin: existing ? existing.isNoWin : false,
      };
      await onSavePrize(nextPrize);
      setPrizeModalOpen(false);
    } finally {
      setSavingPrize(false);
    }
  };

  const handleBrandingSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSavingBranding(true);
    try {
      await onSaveBranding({
        name: brandName.trim() || 'Smash Mania',
        logoUrl: brandLogoUrl.trim(),
        primaryColor: brandColor.trim() || '#ED2525',
        subtitle: brandSubtitle.trim(),
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSettingsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await onSaveSettings({
        active: campaignActive,
        maxPerPhone: Math.max(1, Math.min(100, parseInt(maxPerPhone, 10) || 1)),
        startDate,
        endDate,
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newAdminPassword.length < 8) {
      onShowToast('A nova senha deve ter pelo menos 8 caracteres.', 'warning');
      return;
    }
    if (newAdminPassword !== confirmAdminPassword) {
      onShowToast('A confirmação da senha não confere.', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      const ok = await onChangePassword(newAdminPassword);
      if (ok) {
        setNewAdminPassword('');
        setConfirmAdminPassword('');
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const exportToCSV = () => {
    if (state.participations.length === 0) {
      onShowToast('Não há participações registradas para exportar.', 'warning');
      return;
    }

    let csv =
      'ID;Telefone;Data_Hora;Resultado;Premio;Status_Resgate;Codigo_Resgate\n';
    state.participations.forEach((p) => {
      csv += [
        escapeCsvCell(p.id),
        escapeCsvCell(p.displayPhone),
        escapeCsvCell(p.timestamp),
        escapeCsvCell(p.result),
        escapeCsvCell(p.prizeName),
        escapeCsvCell(p.redeemed ? 'Resgatado' : 'Pendente'),
        escapeCsvCell(p.redemptionCode),
      ].join(';') + '\n';
    });

    const blob = new Blob(['\ufeff' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smash_mania_participacoes_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onShowToast('Relatório CSV baixado com sucesso!', 'success');
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SECURITY_SQL);
      setCopiedSql(true);
      onShowToast('Script SQL de segurança copiado!', 'success');
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      onShowToast('Não foi possível copiar automaticamente.', 'warning');
    }
  };

  const { security } = dataStatus;

  return (
    <section className="w-full max-w-5xl mx-auto space-y-6 py-2">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#121212] border border-neutral-800 p-4 sm:p-6 rounded-2xl">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-impact text-3xl text-white tracking-wide">
              PAINEL ADMINISTRATIVO
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                security.rlsLockedDown ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              {security.rlsLockedDown ? (
                <ShieldCheck className="w-4 h-4" />
              ) : (
                <ShieldAlert className="w-4 h-4" />
              )}
              <span>
                {security.rlsLockedDown
                  ? 'RLS Restrito & RPCs Ativos'
                  : 'Ação de Segurança Pendente (RLS Permissivo)'}
              </span>
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Gerencie prêmios, parâmetros de campanha e relatórios de participações.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefreshSupabase}
            disabled={isSyncing}
            className="min-h-[40px] px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-60 text-neutral-100 text-xs font-bold rounded-lg transition flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Sincronizar</span>
          </button>
          <button
            type="button"
            onClick={exportToCSV}
            className="min-h-[40px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
          <button
            type="button"
            onClick={onBackHome}
            className="min-h-[40px] px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-bold rounded-lg transition flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Sair do Admin</span>
          </button>
        </div>
      </div>

      {/* Security Warning Banner when RLS is still permissive */}
      {!security.rlsLockedDown && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-bold text-amber-300 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Políticas RLS abertas detectadas no Supabase</span>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              As políticas iniciais permitem acesso direto à chave pública. Execute o script de endurecimento RLS + RPCs no SQL Editor para bloquear leitura direta de telefones (LGPD), hash admin e manipulação de estoque.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('database')}
            className="min-h-[40px] px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-lg transition whitespace-nowrap shrink-0"
          >
            Ver Auditoria e SQL
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-neutral-800 gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('prizes')}
          className={`min-h-[40px] px-4 py-2 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'prizes'
              ? 'bg-brand-red text-white'
              : 'bg-neutral-900 text-neutral-400 hover:text-white'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>Prêmios</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('participations')}
          className={`min-h-[40px] px-4 py-2 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'participations'
              ? 'bg-brand-red text-white'
              : 'bg-neutral-900 text-neutral-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Participações e LGPD</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('branding')}
          className={`min-h-[40px] px-4 py-2 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'branding'
              ? 'bg-brand-red text-white'
              : 'bg-neutral-900 text-neutral-400 hover:text-white'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Personalização da Marca</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`min-h-[40px] px-4 py-2 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'settings'
              ? 'bg-brand-red text-white'
              : 'bg-neutral-900 text-neutral-400 hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Configurações e Senha</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('database')}
          className={`min-h-[40px] px-4 py-2 text-xs font-bold rounded-t-lg transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'database'
              ? 'bg-brand-red text-white'
              : 'bg-neutral-900 text-neutral-400 hover:text-white'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Segurança & RLS</span>
        </button>
      </div>

      {/* TAB 1: PRIZES */}
      {activeTab === 'prizes' && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3 bg-neutral-900 p-4 rounded-xl border border-neutral-800">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Gift className="w-4 h-4 text-[#FFD700]" />
              <span>Lista de Prêmios Configurados</span>
            </h3>
            <button
              type="button"
              onClick={openCreatePrize}
              className="min-h-[40px] px-3.5 py-2 bg-brand-red hover:bg-brand-red-dark text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Adicionar Prêmio</span>
            </button>
          </div>

          <div className="overflow-x-auto bg-[#121212] border border-neutral-800 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-900 text-neutral-400 font-bold border-b border-neutral-800 uppercase tracking-wider">
                <tr>
                  <th className="p-3.5">Nome do Prêmio</th>
                  <th className="p-3.5 text-right">Estoque Restante</th>
                  <th className="p-3.5 text-right">Distribuídos</th>
                  <th className="p-3.5 text-right">Probabilidade</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {state.prizes.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-900/50 transition">
                    <td className="p-3.5 font-bold text-white">
                      <span>{p.name}</span>
                      {p.isNoWin && (
                        <span className="text-[11px] font-normal text-neutral-400 ml-2">
                          (Sem prêmio)
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right font-mono tabular-nums font-bold text-neutral-200">
                      {p.qty}
                    </td>
                    <td className="p-3.5 text-right font-mono tabular-nums text-[#FFD700] font-bold">
                      {p.distributed || 0}
                    </td>
                    <td className="p-3.5 text-right font-mono tabular-nums text-neutral-200">
                      {p.probability}%
                    </td>
                    <td className="p-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                          p.active ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {p.active ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5" />
                        )}
                        <span>{p.active ? 'Ativo' : 'Inativo'}</span>
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditPrize(p)}
                          aria-label={`Editar ${p.name}`}
                          className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {!p.isNoWin &&
                          (pendingDeleteId === p.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeletePrize(p.id);
                                  setPendingDeleteId(null);
                                }}
                                className="px-2 py-1 bg-brand-red text-white text-[11px] font-bold rounded"
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteId(null)}
                                className="px-2 py-1 bg-neutral-800 text-neutral-300 text-[11px] font-bold rounded"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(p.id)}
                              aria-label={`Excluir ${p.name}`}
                              className="p-2 text-neutral-500 hover:text-brand-red rounded-lg hover:bg-neutral-800 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: PARTICIPATIONS */}
      {activeTab === 'participations' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="bg-[#121212] border border-neutral-800 rounded-xl p-3.5">
              <div className="text-neutral-400 text-[11px]">Total</div>
              <div className="font-mono tabular-nums font-bold text-lg text-white mt-0.5">
                {totalParticipations}
              </div>
            </div>
            <div className="bg-[#121212] border border-neutral-800 rounded-xl p-3.5">
              <div className="text-neutral-400 text-[11px]">Ganhadores</div>
              <div className="font-mono tabular-nums font-bold text-lg text-emerald-400 mt-0.5">
                {winnersCount}
              </div>
            </div>
            <div className="bg-[#121212] border border-neutral-800 rounded-xl p-3.5">
              <div className="text-neutral-400 text-[11px]">Não Ganharam</div>
              <div className="font-mono tabular-nums font-bold text-lg text-neutral-300 mt-0.5">
                {lostCount}
              </div>
            </div>
            <div className="bg-[#121212] border border-neutral-800 rounded-xl p-3.5">
              <div className="text-neutral-400 text-[11px]">Resgatados</div>
              <div className="font-mono tabular-nums font-bold text-lg text-[#FFD700] mt-0.5">
                {redeemedCount}
              </div>
            </div>
            <div className="bg-[#121212] border border-neutral-800 rounded-xl p-3.5">
              <div className="text-neutral-400 text-[11px]">Pendentes</div>
              <div className="font-mono tabular-nums font-bold text-lg text-amber-300 mt-0.5">
                {pendingCount}
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-3 bg-neutral-900 p-4 rounded-xl border border-neutral-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['all', 'Todos'],
                  ['won', 'Ganhadores'],
                  ['pending', 'Pendentes'],
                  ['redeemed', 'Resgatados'],
                  ['lost', 'Sem Prêmio'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPartFilter(key)}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                    partFilter === key
                      ? 'bg-brand-red text-white'
                      : 'bg-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder="Buscar por telefone..."
                className="pl-8 pr-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-brand-red w-full lg:w-64"
              />
            </div>
          </div>

          <div className="overflow-x-auto bg-[#121212] border border-neutral-800 rounded-xl max-h-[28rem]">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-900 text-neutral-400 font-bold border-b border-neutral-800 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="p-3.5">Telefone / WhatsApp</th>
                  <th className="p-3.5">Data e Horário</th>
                  <th className="p-3.5">Resultado</th>
                  <th className="p-3.5">Prêmio</th>
                  <th className="p-3.5 text-center">Status do Resgate</th>
                  <th className="p-3.5 text-right">Código</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {filteredParticipations.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-6 text-center text-neutral-500 text-xs"
                    >
                      Nenhuma participação registrada até o momento.
                    </td>
                  </tr>
                ) : (
                  filteredParticipations.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-neutral-900/50 transition"
                    >
                      <td className="p-3.5 font-mono tabular-nums text-neutral-200">
                        {item.displayPhone}
                      </td>
                      <td className="p-3.5 font-mono tabular-nums text-neutral-400 text-[11px]">
                        {item.timestamp}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            item.result === 'Ganhou'
                              ? 'text-emerald-400'
                              : 'text-neutral-400'
                          }`}
                        >
                          {item.result === 'Ganhou' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          <span>{item.result}</span>
                        </span>
                      </td>
                      <td className="p-3.5 font-sans text-white font-semibold">
                        {item.prizeName}
                      </td>
                      <td className="p-3.5 text-center">
                        {item.result === 'Ganhou' ? (
                          <button
                            type="button"
                            onClick={() => onToggleRedeemed(item.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${
                              item.redeemed
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-amber-950 text-amber-300 border border-amber-800'
                            }`}
                          >
                            {item.redeemed ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            <span>
                              {item.redeemed ? 'Resgatado' : 'Pendente'}
                            </span>
                          </button>
                        ) : (
                          <span className="text-neutral-500 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="p-3.5 text-right font-mono tabular-nums text-[#FFD700] text-[11px]">
                        {item.redemptionCode}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: BRANDING */}
      {activeTab === 'branding' && (
        <form
          onSubmit={handleBrandingSubmit}
          className="bg-[#121212] border border-neutral-800 p-6 rounded-xl space-y-4 max-w-2xl"
        >
          <h3 className="font-bold text-sm text-white border-b border-neutral-800 pb-2.5 flex items-center gap-2">
            <Palette className="w-4 h-4 text-[#FFD700]" />
            <span>Personalizar Texto e Identidade Visual</span>
          </h3>

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Nome da Hamburgueria / Marca
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white focus:outline-none focus:border-brand-red"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                URL / Caminho da Imagem da Logo (apenas http/https)
              </label>
              <input
                type="text"
                value={brandLogoUrl}
                onChange={(e) => setBrandLogoUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white focus:outline-none focus:border-brand-red"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Cor Principal (HEX)
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-10 w-12 bg-neutral-900 border border-neutral-700 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="flex-grow px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Subtítulo da Tela Inicial
              </label>
              <textarea
                rows={3}
                value={brandSubtitle}
                onChange={(e) => setBrandSubtitle(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white focus:outline-none focus:border-brand-red"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingBranding}
            className="min-h-[42px] px-4 py-2 bg-brand-red hover:bg-brand-red-dark disabled:opacity-60 text-white text-xs font-bold rounded-lg transition"
          >
            {savingBranding ? 'Salvando...' : 'Salvar Alterações de Marca'}
          </button>
        </form>
      )}

      {/* TAB 4: CAMPAIGN SETTINGS & PASSWORD */}
      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-2xl">
          <form
            onSubmit={handleSettingsSubmit}
            className="bg-[#121212] border border-neutral-800 p-6 rounded-xl space-y-4"
          >
            <h3 className="font-bold text-sm text-white border-b border-neutral-800 pb-2.5 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#FFD700]" />
              <span>Regras e Controle da Campanha</span>
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-3.5 bg-neutral-900 rounded-lg border border-neutral-800 gap-4">
                <div>
                  <div className="text-xs font-bold text-white">
                    Status da Campanha
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    Ativar ou pausar a participação pública instantaneamente
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={campaignActive}
                    onChange={(e) => setCampaignActive(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-red" />
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Limite Máximo de Participações por Telefone
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxPerPhone}
                  onChange={(e) => setMaxPerPhone(e.target.value)}
                  className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white font-mono tabular-nums"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Data de Início
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Data de Término
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-xl text-xs text-amber-200/90 space-y-1.5">
              <div className="font-bold flex items-center gap-1.5 text-amber-400">
                <Scale className="w-4 h-4 shrink-0" />
                <span>Nota de Conformidade Legal (Brasil / SPA-MF)</span>
              </div>
              <p className="leading-relaxed text-[11px]">
                Certifique-se de que a promoção comercial cumpre a Lei nº 5.768/71
                e a Portaria SEAE/ME nº 7.638/2022. Caso trate-se de promoção
                comercial vinculada a compras ou sorteios sem valor de compra
                prévio, requisite a devida autorização junto ao SPA/MF.
              </p>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="min-h-[42px] px-4 py-2 bg-brand-red hover:bg-brand-red-dark disabled:opacity-60 text-white text-xs font-bold rounded-lg transition"
            >
              {savingSettings
                ? 'Salvando...'
                : 'Salvar Configurações da Campanha'}
            </button>
          </form>

          <form
            onSubmit={handlePasswordSubmit}
            className="bg-[#121212] border border-neutral-800 p-6 rounded-xl space-y-4"
          >
            <h3 className="font-bold text-sm text-white border-b border-neutral-800 pb-2.5 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#FFD700]" />
              <span>Alterar Senha do Painel Administrativo</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Nova Senha (mín. 8 caracteres)
                </label>
                <input
                  type="password"
                  minLength={8}
                  required
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Confirmar Nova Senha
                </label>
                <input
                  type="password"
                  minLength={8}
                  required
                  value={confirmAdminPassword}
                  onChange={(e) => setConfirmAdminPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="min-h-[42px] px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg transition"
            >
              {savingPassword ? 'Atualizando...' : 'Atualizar Senha'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 5: SECURITY & RLS AUDIT */}
      {activeTab === 'database' && (
        <div className="bg-[#121212] border border-neutral-800 p-6 rounded-xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-4">
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-[#FFD700]" />
                <span>Auditoria de Segurança e RLS (Supabase)</span>
              </h3>
              <p className="text-xs text-neutral-400 mt-1 font-mono">
                Projeto: {SUPABASE_BASE_URL}
              </p>
            </div>
            <button
              type="button"
              onClick={onRefreshSupabase}
              disabled={isSyncing}
              className="min-h-[40px] px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
              />
              <span>Reverificar Políticas RLS</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3.5">
              <div className="text-neutral-400 text-[11px]">
                Leitura direta de Participações (LGPD)
              </div>
              <div
                className={`font-bold mt-1 flex items-center gap-1.5 ${
                  security.directParticipationsBlocked
                    ? 'text-emerald-400'
                    : 'text-red-400'
                }`}
              >
                {security.directParticipationsBlocked ? (
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {security.directParticipationsBlocked
                    ? 'Bloqueado (Seguro)'
                    : 'Exposto (Vulnerável)'}
                </span>
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3.5">
              <div className="text-neutral-400 text-[11px]">
                Leitura direta de Hash Admin
              </div>
              <div
                className={`font-bold mt-1 flex items-center gap-1.5 ${
                  security.directConfigHashBlocked
                    ? 'text-emerald-400'
                    : 'text-red-400'
                }`}
              >
                {security.directConfigHashBlocked ? (
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {security.directConfigHashBlocked
                    ? 'Bloqueado (Seguro)'
                    : 'Exposto (Vulnerável)'}
                </span>
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3.5">
              <div className="text-neutral-400 text-[11px]">
                Sorteio e Admin via RPC Servidor
              </div>
              <div
                className={`font-bold mt-1 flex items-center gap-1.5 ${
                  security.rpcReady ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {security.rpcReady ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {security.rpcReady ? 'Ativo' : 'Pendente'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-white">
                  Script SQL de Endurecimento RLS + RPCs Seguras
                </h4>
                <p className="text-[11px] text-neutral-400">
                  Remove políticas <code className="font-mono">USING (true)</code>, bloqueia acesso direto às tabelas para a chave pública e move sorteio, estoque e autenticação administrativa para funções <code className="font-mono">SECURITY DEFINER</code> no PostgreSQL.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopySql}
                className="min-h-[38px] px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5"
              >
                {copiedSql ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedSql ? 'Copiado!' : 'Copiar SQL'}</span>
              </button>
            </div>
            <pre className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-[11px] font-mono text-neutral-300 overflow-x-auto max-h-72 leading-relaxed">
              {SUPABASE_SECURITY_SQL}
            </pre>
          </div>
        </div>
      )}

      {/* ADD / EDIT PRIZE MODAL */}
      {prizeModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#121212] border border-neutral-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-neutral-800 pb-3">
              <h3 className="font-impact text-2xl text-white">
                {editingPrizeId ? 'EDITAR PRÊMIO' : 'ADICIONAR PRÊMIO'}
              </h3>
              <button
                type="button"
                onClick={() => setPrizeModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePrizeSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-neutral-300 mb-1">
                  Nome do Prêmio
                </label>
                <input
                  type="text"
                  required
                  value={prizeName}
                  onChange={(e) => setPrizeName(e.target.value)}
                  placeholder="Ex: 1 Batata Grátis"
                  className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-neutral-300 mb-1">
                    Estoque Disponível
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={prizeQty}
                    onChange={(e) => setPrizeQty(e.target.value)}
                    className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-neutral-300 mb-1">
                    Probabilidade (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    required
                    value={prizeProb}
                    onChange={(e) => setPrizeProb(e.target.value)}
                    className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-neutral-300 mb-1">
                  Status de Ativação
                </label>
                <select
                  value={prizeActive}
                  onChange={(e) =>
                    setPrizeActive(e.target.value as 'true' | 'false')
                  }
                  className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white"
                >
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPrizeModalOpen(false)}
                  className="w-1/2 min-h-[42px] py-2 bg-neutral-800 text-neutral-200 font-bold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPrize}
                  className="w-1/2 min-h-[42px] py-2 bg-brand-red text-white font-bold rounded-lg hover:bg-brand-red-dark disabled:opacity-60"
                >
                  {savingPrize ? 'Salvando...' : 'Salvar Prêmio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
