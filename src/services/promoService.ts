import { supabase } from '../lib/supabase';
import type {
  BrandConfig,
  CampaignSettings,
  DataStatus,
  Participation,
  Prize,
  PromoState,
  SecurityAudit,
} from '../types/promo';

const LOCAL_PUBLIC_CACHE_KEY = 'smash_mania_public_cache';

export const DEFAULT_LOGO_URL =
  'https://i.ibb.co/m10SpFH/Logo-hamburgueria-moderno-3-2.jpg';

export function sanitizeHttpUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return DEFAULT_LOGO_URL;
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Fallback below
  }
  return DEFAULT_LOGO_URL;
}

export function sanitizeHexColor(color: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test((color || '').trim())
    ? color.trim()
    : '#ED2525';
}

export function getDefaultState(): PromoState {
  const today = new Date().toLocaleDateString('en-CA');
  const thirtyDaysLater = new Date(Date.now() + 30 * 86400000)
    .toLocaleDateString('en-CA');

  return {
    branding: {
      name: 'Smash Mania',
      logoUrl: DEFAULT_LOGO_URL,
      primaryColor: '#ED2525',
      subtitle:
        'A sorte está no seu próximo smash. Digite seu WhatsApp e descubra o que preparamos pra você.',
    },
    settings: {
      active: true,
      maxPerPhone: 1,
      startDate: today,
      endDate: thirtyDaysLater,
    },
    prizes: [
      {
        id: 'p1',
        name: '1 Smash Grátis',
        qty: 25,
        distributed: 4,
        probability: 10,
        active: true,
        isNoWin: false,
      },
      {
        id: 'p2',
        name: '1 Batata Grátis',
        qty: 50,
        distributed: 12,
        probability: 20,
        active: true,
        isNoWin: false,
      },
      {
        id: 'p3',
        name: '1 Refrigerante Grátis',
        qty: 100,
        distributed: 30,
        probability: 30,
        active: true,
        isNoWin: false,
      },
      {
        id: 'p4',
        name: '10% de Desconto',
        qty: 200,
        distributed: 45,
        probability: 20,
        active: true,
        isNoWin: false,
      },
      {
        id: 'p5',
        name: 'Não foi dessa vez!',
        qty: 9999,
        distributed: 80,
        probability: 20,
        active: true,
        isNoWin: true,
      },
    ],
    participations: [],
  };
}

export function loadLocalCache(): PromoState {
  try {
    const saved = localStorage.getItem(LOCAL_PUBLIC_CACHE_KEY);
    if (!saved) return getDefaultState();
    const parsed = JSON.parse(saved) as Partial<PromoState>;
    const defaults = getDefaultState();
    return {
      branding: {
        ...defaults.branding,
        ...parsed.branding,
        logoUrl: sanitizeHttpUrl(parsed.branding?.logoUrl || defaults.branding.logoUrl),
        primaryColor: sanitizeHexColor(
          parsed.branding?.primaryColor || defaults.branding.primaryColor
        ),
      },
      settings: { ...defaults.settings, ...parsed.settings },
      prizes:
        Array.isArray(parsed.prizes) && parsed.prizes.length > 0
          ? parsed.prizes
          : defaults.prizes,
      participations: [],
    };
  } catch {
    return getDefaultState();
  }
}

export function saveLocalPublicCache(state: PromoState): void {
  try {
    // Nunca persistir participações/PII em localStorage
    const safeCache: PromoState = {
      branding: state.branding,
      settings: state.settings,
      prizes: state.prizes,
      participations: [],
    };
    localStorage.setItem(LOCAL_PUBLIC_CACHE_KEY, JSON.stringify(safeCache));
  } catch {
    // Ignore storage quota issues
  }
}

async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isMissingFunctionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    (error.message ?? '').toLowerCase().includes('could not find the function')
  );
}

interface LegacyConfigRow {
  brand_name: string;
  logo_url: string;
  primary_color: string;
  subtitle: string;
  campaign_active: boolean;
  max_per_phone: number;
  start_date: string;
  end_date: string;
}

interface LegacyPrizeRow {
  id: string;
  name: string;
  qty: number;
  distributed: number;
  probability: number | string;
  active: boolean;
  is_no_win: boolean;
}

export async function runSecurityAudit(): Promise<SecurityAudit> {
  const [rpcTest, partsProbe, hashProbe] = await Promise.all([
    supabase.rpc('get_public_campaign'),
    supabase.from('participations').select('id').limit(1),
    supabase.from('campaign_config').select('admin_password_hash').limit(1),
  ]);

  const rpcReady = !rpcTest.error;
  const directParticipationsBlocked = Boolean(partsProbe.error);
  const directConfigHashBlocked = Boolean(hashProbe.error);

  return {
    rpcReady,
    directParticipationsBlocked,
    directConfigHashBlocked,
    rlsLockedDown:
      rpcReady && directParticipationsBlocked && directConfigHashBlocked,
  };
}

export async function fetchPublicPromoData(): Promise<{
  state: PromoState;
  status: DataStatus;
}> {
  const cached = loadLocalCache();

  try {
    const security = await runSecurityAudit();

    if (security.rpcReady) {
      const { data, error } = await supabase.rpc('get_public_campaign');
      if (!error && data) {
        const payload = data as {
          branding: BrandConfig;
          settings: CampaignSettings;
          prizes: Array<{
            id: string;
            name: string;
            qty: number;
            active: boolean;
            isNoWin: boolean;
          }>;
        };

        const nextState: PromoState = {
          branding: {
            name: payload.branding?.name || cached.branding.name,
            logoUrl: sanitizeHttpUrl(payload.branding?.logoUrl),
            primaryColor: sanitizeHexColor(payload.branding?.primaryColor),
            subtitle: payload.branding?.subtitle || cached.branding.subtitle,
          },
          settings: {
            active: Boolean(payload.settings?.active),
            maxPerPhone: Number(payload.settings?.maxPerPhone || 1),
            startDate: payload.settings?.startDate || cached.settings.startDate,
            endDate: payload.settings?.endDate || cached.settings.endDate,
          },
          prizes: (payload.prizes || []).map((p) => ({
            id: p.id,
            name: p.name,
            qty: Number(p.qty),
            distributed: 0,
            probability: 0,
            active: Boolean(p.active),
            isNoWin: Boolean(p.isNoWin),
          })),
          participations: [],
        };

        saveLocalPublicCache(nextState);

        return {
          state: nextState,
          status: {
            source: 'supabase_rpc',
            tablesReady: true,
            security,
            lastSyncedAt: new Date().toLocaleTimeString('pt-BR'),
          },
        };
      }
    }

    // Fallback para tabelas legadas enquanto o usuário não executa o script RLS
    const [configRes, prizesRes] = await Promise.all([
      supabase
        .from('campaign_config')
        .select(
          'brand_name, logo_url, primary_color, subtitle, campaign_active, max_per_phone, start_date, end_date'
        )
        .eq('id', 'default')
        .maybeSingle(),
      supabase
        .from('prizes')
        .select('id, name, qty, distributed, probability, active, is_no_win')
        .order('created_at', { ascending: true }),
    ]);

    if (configRes.error && prizesRes.error) {
      return {
        state: cached,
        status: {
          source: 'local_fallback',
          tablesReady: false,
          security,
          errorMessage: configRes.error.message,
        },
      };
    }

    const cfgRow = configRes.data as LegacyConfigRow | null;
    const prizeRows = (prizesRes.data as LegacyPrizeRow[] | null) || [];

    const nextState: PromoState = {
      branding: cfgRow
        ? {
            name: cfgRow.brand_name,
            logoUrl: sanitizeHttpUrl(cfgRow.logo_url),
            primaryColor: sanitizeHexColor(cfgRow.primary_color),
            subtitle: cfgRow.subtitle,
          }
        : cached.branding,
      settings: cfgRow
        ? {
            active: Boolean(cfgRow.campaign_active),
            maxPerPhone: Number(cfgRow.max_per_phone || 1),
            startDate: cfgRow.start_date,
            endDate: cfgRow.end_date,
          }
        : cached.settings,
      prizes: prizeRows.map((p) => ({
        id: p.id,
        name: p.name,
        qty: Number(p.qty),
        distributed: Number(p.distributed),
        probability: Number(p.probability),
        active: Boolean(p.active),
        isNoWin: Boolean(p.is_no_win),
      })),
      participations: [],
    };

    saveLocalPublicCache(nextState);

    return {
      state: nextState,
      status: {
        source: 'supabase_legacy',
        tablesReady: true,
        security,
        lastSyncedAt: new Date().toLocaleTimeString('pt-BR'),
      },
    };
  } catch (err) {
    return {
      state: cached,
      status: {
        source: 'local_fallback',
        tablesReady: false,
        security: {
          rlsLockedDown: false,
          rpcReady: false,
          directParticipationsBlocked: false,
          directConfigHashBlocked: false,
        },
        errorMessage:
          err instanceof Error ? err.message : 'Erro ao conectar com o Supabase.',
      },
    };
  }
}

export async function playScratchcardSecure(
  cleanPhone: string,
  displayPhone: string,
  fallbackState: PromoState,
  status: DataStatus
): Promise<
  | {
      ok: true;
      prize: Prize;
      cardResults: Prize[];
      participation: Participation;
    }
  | { ok: false; message: string }
> {
  if (status.security.rpcReady) {
    const { data, error } = await supabase.rpc('play_scratchcard', {
      p_clean_phone: cleanPhone,
      p_display_phone: displayPhone,
    });

    if (error) {
      return { ok: false, message: `Erro ao registrar jogada: ${error.message}` };
    }

    const res = data as {
      ok: boolean;
      message?: string;
      prize?: Prize;
      cardResults?: Prize[];
      participation?: Participation;
    };

    if (!res?.ok || !res.prize || !res.cardResults || !res.participation) {
      return {
        ok: false,
        message: res?.message || 'Não foi possível liberar a raspadinha.',
      };
    }

    return {
      ok: true,
      prize: res.prize,
      cardResults: res.cardResults,
      participation: res.participation,
    };
  }

  // Fallback legado caso as RPCs ainda não tenham sido executadas no SQL Editor
  const { state: fresh } = await fetchPublicPromoData();
  const activeState = status.tablesReady ? fresh : fallbackState;

  if (!activeState.settings.active) {
    return {
      ok: false,
      message: 'A promoção está temporariamente pausada. Tente novamente mais tarde!',
    };
  }

  const todayIso = new Date().toLocaleDateString('en-CA');
  if (activeState.settings.startDate && todayIso < activeState.settings.startDate) {
    return { ok: false, message: 'Esta promoção ainda não foi iniciada.' };
  }
  if (activeState.settings.endDate && todayIso > activeState.settings.endDate) {
    return { ok: false, message: 'O período desta campanha promocional já foi encerrado.' };
  }

  if (status.tablesReady) {
    const { count } = await supabase
      .from('participations')
      .select('id', { count: 'exact', head: true })
      .eq('clean_phone', cleanPhone);

    if ((count ?? 0) >= (activeState.settings.maxPerPhone || 1)) {
      return {
        ok: false,
        message: `Este número já atingiu o limite de ${activeState.settings.maxPerPhone} participação(ões).`,
      };
    }
  }

  const activePrizes = activeState.prizes.filter((p) => p.active && p.qty > 0);
  if (activePrizes.length === 0) {
    return {
      ok: false,
      message: 'Desculpe! Não há mais raspadinhas ou prêmios disponíveis no momento.',
    };
  }

  const totalProb = activePrizes.reduce((sum, p) => sum + Number(p.probability), 0);
  let randomVal = Math.random() * totalProb;
  let chosen = activePrizes[activePrizes.length - 1];
  for (const prize of activePrizes) {
    if (randomVal < prize.probability) {
      chosen = prize;
      break;
    }
    randomVal -= prize.probability;
  }

  let cardResults: Prize[];
  if (chosen.isNoWin) {
    const winnables = activeState.prizes.filter((p) => !p.isNoWin);
    if (winnables.length >= 2) {
      const a = winnables[Math.floor(Math.random() * winnables.length)];
      let b = winnables[Math.floor(Math.random() * winnables.length)];
      while (b.id === a.id && winnables.length > 1) {
        b = winnables[Math.floor(Math.random() * winnables.length)];
      }
      cardResults = [a, a, b].sort(() => Math.random() - 0.5);
    } else {
      cardResults = [chosen, chosen, chosen];
    }
  } else {
    cardResults = [chosen, chosen, chosen];
  }

  const participation: Participation = {
    id: `part_${Date.now()}`,
    cleanPhone,
    displayPhone,
    timestamp: new Date().toLocaleString('pt-BR'),
    result: chosen.isNoWin ? 'Perdeu' : 'Ganhou',
    prizeId: chosen.id,
    prizeName: chosen.name,
    redeemed: false,
    redemptionCode: chosen.isNoWin
      ? '-'
      : `SMASH-${Math.floor(1000 + Math.random() * 9000)}`,
  };

  if (status.tablesReady) {
    await supabase
      .from('prizes')
      .update({
        qty: Math.max(0, chosen.qty - 1),
        distributed: (chosen.distributed || 0) + 1,
      })
      .eq('id', chosen.id);

    await supabase.from('participations').insert({
      id: participation.id,
      clean_phone: participation.cleanPhone,
      display_phone: participation.displayPhone,
      timestamp_label: participation.timestamp,
      result: participation.result,
      prize_id: chosen.id,
      prize_name: participation.prizeName,
      redeemed: false,
      redemption_code: participation.redemptionCode,
    });
  }

  return { ok: true, prize: chosen, cardResults, participation };
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_admin_password', {
    p_password: password,
  });

  if (!error) {
    return Boolean(data);
  }

  if (isMissingFunctionError(error)) {
    const { data: cfg } = await supabase
      .from('campaign_config')
      .select('admin_password_hash')
      .eq('id', 'default')
      .maybeSingle();

    if (cfg && typeof cfg.admin_password_hash === 'string') {
      const inputHash = await sha256Hex(password);
      return inputHash === cfg.admin_password_hash;
    }
  }

  return false;
}

export async function fetchAdminDashboard(
  adminPassword: string,
  status: DataStatus
): Promise<{ ok: true; state: PromoState } | { ok: false; error: string }> {
  if (status.security.rpcReady) {
    const { data, error } = await supabase.rpc('admin_get_dashboard', {
      p_password: adminPassword,
    });
    if (error) return { ok: false, error: error.message };
    const payload = data as PromoState;
    return {
      ok: true,
      state: {
        branding: {
          ...payload.branding,
          logoUrl: sanitizeHttpUrl(payload.branding.logoUrl),
          primaryColor: sanitizeHexColor(payload.branding.primaryColor),
        },
        settings: payload.settings,
        prizes: payload.prizes || [],
        participations: payload.participations || [],
      },
    };
  }

  // Fallback legado caso o SQL de endurecimento ainda não tenha sido aplicado
  const [cfgRes, prizesRes, partsRes] = await Promise.all([
    supabase
      .from('campaign_config')
      .select(
        'brand_name, logo_url, primary_color, subtitle, campaign_active, max_per_phone, start_date, end_date'
      )
      .eq('id', 'default')
      .maybeSingle(),
    supabase.from('prizes').select('*').order('created_at', { ascending: true }),
    supabase
      .from('participations')
      .select('*')
      .order('created_at', { ascending: false }),
  ]);

  if (cfgRes.error || prizesRes.error || partsRes.error) {
    return {
      ok: false,
      error:
        cfgRes.error?.message ||
        prizesRes.error?.message ||
        partsRes.error?.message ||
        'Erro ao carregar dados do Supabase.',
    };
  }

  const defaults = getDefaultState();
  const cfg = cfgRes.data as LegacyConfigRow | null;
  const prizes = ((prizesRes.data as LegacyPrizeRow[] | null) || []).map(
    (p) => ({
      id: p.id,
      name: p.name,
      qty: Number(p.qty),
      distributed: Number(p.distributed),
      probability: Number(p.probability),
      active: Boolean(p.active),
      isNoWin: Boolean(p.is_no_win),
    })
  );
  const participations = (
    (partsRes.data as Array<{
      id: string;
      clean_phone: string;
      display_phone: string;
      timestamp_label: string;
      result: 'Ganhou' | 'Perdeu';
      prize_id: string | null;
      prize_name: string;
      redeemed: boolean;
      redemption_code: string;
      created_at: string;
    }> | null) || []
  ).map((pt) => ({
    id: pt.id,
    cleanPhone: pt.clean_phone,
    displayPhone: pt.display_phone,
    timestamp: pt.timestamp_label,
    result: pt.result,
    prizeId: pt.prize_id,
    prizeName: pt.prize_name,
    redeemed: Boolean(pt.redeemed),
    redemptionCode: pt.redemption_code,
    createdAt: pt.created_at,
  }));

  return {
    ok: true,
    state: {
      branding: cfg
        ? {
            name: cfg.brand_name,
            logoUrl: sanitizeHttpUrl(cfg.logo_url),
            primaryColor: sanitizeHexColor(cfg.primary_color),
            subtitle: cfg.subtitle,
          }
        : defaults.branding,
      settings: cfg
        ? {
            active: Boolean(cfg.campaign_active),
            maxPerPhone: Number(cfg.max_per_phone || 1),
            startDate: cfg.start_date,
            endDate: cfg.end_date,
          }
        : defaults.settings,
      prizes,
      participations,
    },
  };
}

export async function adminSavePrize(
  adminPassword: string,
  prize: Prize,
  status: DataStatus
): Promise<{ ok: boolean; error?: string }> {
  if (status.security.rpcReady) {
    const { error } = await supabase.rpc('admin_save_prize', {
      p_password: adminPassword,
      p_id: prize.id,
      p_name: prize.name,
      p_qty: prize.qty,
      p_probability: prize.probability,
      p_active: prize.active,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabase.from('prizes').upsert(
    {
      id: prize.id,
      name: prize.name,
      qty: prize.qty,
      distributed: prize.distributed,
      probability: prize.probability,
      active: prize.active,
      is_no_win: prize.isNoWin,
    },
    { onConflict: 'id' }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function adminDeletePrize(
  adminPassword: string,
  id: string,
  status: DataStatus
): Promise<{ ok: boolean; error?: string }> {
  if (status.security.rpcReady) {
    const { error } = await supabase.rpc('admin_delete_prize', {
      p_password: adminPassword,
      p_id: id,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabase.from('prizes').delete().eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function adminToggleRedeemed(
  adminPassword: string,
  id: string,
  nextRedeemed: boolean,
  status: DataStatus
): Promise<{ ok: boolean; error?: string }> {
  if (status.security.rpcReady) {
    const { error } = await supabase.rpc('admin_toggle_redeemed', {
      p_password: adminPassword,
      p_id: id,
      p_redeemed: nextRedeemed,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabase
    .from('participations')
    .update({ redeemed: nextRedeemed })
    .eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function adminSaveConfig(
  adminPassword: string,
  branding: BrandConfig,
  settings: CampaignSettings,
  status: DataStatus
): Promise<{ ok: boolean; error?: string }> {
  const safeLogo = sanitizeHttpUrl(branding.logoUrl);
  const safeColor = sanitizeHexColor(branding.primaryColor);

  if (status.security.rpcReady) {
    const { error } = await supabase.rpc('admin_save_config', {
      p_password: adminPassword,
      p_brand_name: branding.name,
      p_logo_url: safeLogo,
      p_primary_color: safeColor,
      p_subtitle: branding.subtitle,
      p_campaign_active: settings.active,
      p_max_per_phone: settings.maxPerPhone,
      p_start_date: settings.startDate,
      p_end_date: settings.endDate,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabase
    .from('campaign_config')
    .update({
      brand_name: branding.name,
      logo_url: safeLogo,
      primary_color: safeColor,
      subtitle: branding.subtitle,
      campaign_active: settings.active,
      max_per_phone: settings.maxPerPhone,
      start_date: settings.startDate,
      end_date: settings.endDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 'default');

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function adminChangePassword(
  currentPassword: string,
  newPassword: string,
  status: DataStatus
): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 8) {
    return { ok: false, error: 'A nova senha deve ter pelo menos 8 caracteres.' };
  }

  if (status.security.rpcReady) {
    const { error } = await supabase.rpc('admin_change_password', {
      p_password: currentPassword,
      p_new_password: newPassword,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const newHash = await sha256Hex(newPassword);
  const { error } = await supabase
    .from('campaign_config')
    .update({ admin_password_hash: newHash, updated_at: new Date().toISOString() })
    .eq('id', 'default');

  return error ? { ok: false, error: error.message } : { ok: true };
}
