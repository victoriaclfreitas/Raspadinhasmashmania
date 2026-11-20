export interface BrandConfig {
  name: string;
  logoUrl: string;
  primaryColor: string;
  subtitle: string;
}

export interface CampaignSettings {
  active: boolean;
  maxPerPhone: number;
  startDate: string;
  endDate: string;
}

export interface Prize {
  id: string;
  name: string;
  qty: number;
  distributed: number;
  probability: number;
  active: boolean;
  isNoWin: boolean;
}

export interface Participation {
  id: string;
  cleanPhone: string;
  displayPhone: string;
  timestamp: string;
  result: 'Ganhou' | 'Perdeu';
  prizeId?: string | null;
  prizeName: string;
  redeemed: boolean;
  redemptionCode: string;
  createdAt?: string;
}

export interface PromoState {
  branding: BrandConfig;
  settings: CampaignSettings;
  prizes: Prize[];
  participations: Participation[];
}

export type SyncSource = 'supabase_rpc' | 'supabase_legacy' | 'local_fallback';

export interface SecurityAudit {
  rlsLockedDown: boolean;
  rpcReady: boolean;
  directParticipationsBlocked: boolean;
  directConfigHashBlocked: boolean;
}

export interface DataStatus {
  source: SyncSource;
  tablesReady: boolean;
  security: SecurityAudit;
  errorMessage?: string;
  lastSyncedAt?: string;
}

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}
