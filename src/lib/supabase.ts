import { createClient } from '@supabase/supabase-js';

const RAW_SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://hhsizpggirnveieemxlt.supabase.co/rest/v1/';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_fiAepA_D_furXsBQXc1Xig_z831kC9q';

export function normalizeSupabaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

export const SUPABASE_BASE_URL = normalizeSupabaseUrl(RAW_SUPABASE_URL);

export const supabase = createClient(SUPABASE_BASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const SUPABASE_SECURITY_SQL = `-- Endurecimento RLS + RPCs Seguras (Smash Mania)
-- Execute no SQL Editor do Supabase (Project: hhsizpggirnveieemxlt)

-- 1. Remover políticas abertas antigas e bloquear acesso direto via REST
ALTER TABLE public.campaign_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public full access campaign_config" ON public.campaign_config;
DROP POLICY IF EXISTS "Public full access prizes" ON public.prizes;
DROP POLICY IF EXISTS "Public full access participations" ON public.participations;

REVOKE ALL ON public.campaign_config FROM anon, authenticated;
REVOKE ALL ON public.prizes FROM anon, authenticated;
REVOKE ALL ON public.participations FROM anon, authenticated;

-- 2. Verificador interno de senha admin (SHA-256)
CREATE OR REPLACE FUNCTION public._assert_admin(p_password TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT admin_password_hash INTO v_hash
  FROM public.campaign_config
  WHERE id = 'default';

  IF v_hash IS NULL OR encode(sha256(convert_to(COALESCE(p_password, ''), 'UTF8')), 'hex') <> v_hash THEN
    RAISE EXCEPTION 'Unauthorized: credenciais administrativas inválidas' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_admin(TEXT) FROM PUBLIC, anon, authenticated;

-- 3. RPC pública segura (sem hash, sem telefones, sem probabilidades internas)
CREATE OR REPLACE FUNCTION public.get_public_campaign()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.campaign_config%ROWTYPE;
  v_prizes JSONB;
BEGIN
  SELECT * INTO v_cfg FROM public.campaign_config WHERE id = 'default';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'qty', p.qty,
        'active', p.active,
        'isNoWin', p.is_no_win
      )
      ORDER BY p.created_at ASC
    ),
    '[]'::jsonb
  ) INTO v_prizes
  FROM public.prizes p
  WHERE p.active = true;

  RETURN jsonb_build_object(
    'branding', jsonb_build_object(
      'name', v_cfg.brand_name,
      'logoUrl', v_cfg.logo_url,
      'primaryColor', v_cfg.primary_color,
      'subtitle', v_cfg.subtitle
    ),
    'settings', jsonb_build_object(
      'active', v_cfg.campaign_active,
      'maxPerPhone', v_cfg.max_per_phone,
      'startDate', v_cfg.start_date::text,
      'endDate', v_cfg.end_date::text
    ),
    'prizes', v_prizes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_campaign() TO anon, authenticated;

-- 4. RPC pública de sorteio atômico no servidor
CREATE OR REPLACE FUNCTION public.play_scratchcard(p_clean_phone TEXT, p_display_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean TEXT;
  v_cfg public.campaign_config%ROWTYPE;
  v_today DATE;
  v_count INTEGER;
  v_total_prob NUMERIC;
  v_rand NUMERIC;
  v_acc NUMERIC := 0;
  v_prize RECORD;
  v_chosen RECORD;
  v_found BOOLEAN := false;
  v_part_id TEXT;
  v_code TEXT;
  v_ts_label TEXT;
  v_cards JSONB;
BEGIN
  v_clean := regexp_replace(COALESCE(p_clean_phone, ''), '\\D', '', 'g');
  IF length(v_clean) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PHONE', 'message', 'Insira um número de WhatsApp válido com 11 dígitos (DDD + 9 dígitos).');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('smash_phone_' || v_clean));

  SELECT * INTO v_cfg FROM public.campaign_config WHERE id = 'default';
  IF NOT FOUND OR NOT v_cfg.campaign_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CAMPAIGN_PAUSED', 'message', 'A promoção está temporariamente pausada. Tente novamente mais tarde!');
  END IF;

  v_today := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_today < v_cfg.start_date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_STARTED', 'message', 'A promoção começa em ' || to_char(v_cfg.start_date, 'DD/MM/YYYY') || '.');
  END IF;
  IF v_today > v_cfg.end_date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ENDED', 'message', 'O período desta campanha promocional já foi encerrado.');
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.participations WHERE clean_phone = v_clean;
  IF v_count >= GREATEST(1, v_cfg.max_per_phone) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LIMIT_REACHED', 'message', 'Este número já atingiu o limite de ' || v_cfg.max_per_phone || ' participação(ões).');
  END IF;

  SELECT COALESCE(SUM(probability), 0) INTO v_total_prob FROM public.prizes WHERE active = true AND qty > 0;
  IF v_total_prob <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_STOCK', 'message', 'Desculpe! Não há mais raspadinhas ou prêmios disponíveis no momento.');
  END IF;

  v_rand := random() * v_total_prob;
  FOR v_prize IN
    SELECT id, name, qty, distributed, probability, active, is_no_win
    FROM public.prizes
    WHERE active = true AND qty > 0
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    v_acc := v_acc + v_prize.probability;
    IF v_rand < v_acc OR NOT v_found THEN
      v_chosen := v_prize;
      IF v_rand < v_acc THEN
        v_found := true;
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF v_chosen.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_STOCK', 'message', 'Desculpe! Não há mais raspadinhas ou prêmios disponíveis no momento.');
  END IF;

  UPDATE public.prizes
  SET qty = CASE WHEN v_chosen.is_no_win THEN qty ELSE GREATEST(0, qty - 1) END,
      distributed = distributed + 1
  WHERE id = v_chosen.id;

  v_part_id := 'part_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_ts_label := to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY, HH24:MI:SS');
  IF v_chosen.is_no_win THEN
    v_code := '-';
  ELSE
    v_code := 'SMASH-' || lpad(floor(1000 + random() * 9000)::int::text, 4, '0');
  END IF;

  INSERT INTO public.participations (
    id, clean_phone, display_phone, timestamp_label, result, prize_id, prize_name, redeemed, redemption_code
  ) VALUES (
    v_part_id,
    v_clean,
    COALESCE(NULLIF(trim(p_display_phone), ''), v_clean),
    v_ts_label,
    CASE WHEN v_chosen.is_no_win THEN 'Perdeu' ELSE 'Ganhou' END,
    v_chosen.id,
    v_chosen.name,
    false,
    v_code
  );

  IF v_chosen.is_no_win THEN
    WITH winnables AS MATERIALIZED (
      SELECT id, name, qty, active, is_no_win
      FROM public.prizes
      WHERE is_no_win = false
      ORDER BY random()
      LIMIT 2
    ),
    pair AS MATERIALIZED (
      SELECT jsonb_build_object('id', id, 'name', name, 'qty', qty, 'distributed', 0, 'probability', 0, 'active', active, 'isNoWin', is_no_win) AS obj
      FROM winnables
    )
    SELECT CASE
      WHEN (SELECT COUNT(*) FROM winnables) >= 2 THEN (
        SELECT jsonb_agg(item ORDER BY random())
        FROM (
          SELECT (SELECT obj FROM pair LIMIT 1) AS item
          UNION ALL
          SELECT (SELECT obj FROM pair LIMIT 1) AS item
          UNION ALL
          SELECT (SELECT obj FROM pair OFFSET 1 LIMIT 1) AS item
        ) sub
      )
      ELSE jsonb_build_array(
        jsonb_build_object('id', v_chosen.id, 'name', v_chosen.name, 'qty', GREATEST(0, v_chosen.qty - 1), 'distributed', 0, 'probability', 0, 'active', v_chosen.active, 'isNoWin', true),
        jsonb_build_object('id', v_chosen.id, 'name', v_chosen.name, 'qty', GREATEST(0, v_chosen.qty - 1), 'distributed', 0, 'probability', 0, 'active', v_chosen.active, 'isNoWin', true),
        jsonb_build_object('id', v_chosen.id, 'name', v_chosen.name, 'qty', GREATEST(0, v_chosen.qty - 1), 'distributed', 0, 'probability', 0, 'active', v_chosen.active, 'isNoWin', true)
      )
    END INTO v_cards;
  ELSE
    v_cards := jsonb_build_array(
      jsonb_build_object('id', v_chosen.id, 'name', v_chosen.name, 'qty', GREATEST(0, v_chosen.qty - 1), 'distributed', 0, 'probability', 0, 'active', v_chosen.active, 'isNoWin', false),
      jsonb_build_object('id', v_chosen.id, 'name', v_chosen.name, 'qty', GREATEST(0, v_chosen.qty - 1), 'distributed', 0, 'probability', 0, 'active', v_chosen.active, 'isNoWin', false),
      jsonb_build_object('id', v_chosen.id, 'name', v_chosen.name, 'qty', GREATEST(0, v_chosen.qty - 1), 'distributed', 0, 'probability', 0, 'active', v_chosen.active, 'isNoWin', false)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'prize', jsonb_build_object(
      'id', v_chosen.id,
      'name', v_chosen.name,
      'qty', GREATEST(0, v_chosen.qty - 1),
      'distributed', v_chosen.distributed + 1,
      'probability', v_chosen.probability,
      'active', v_chosen.active,
      'isNoWin', v_chosen.is_no_win
    ),
    'cardResults', v_cards,
    'participation', jsonb_build_object(
      'id', v_part_id,
      'cleanPhone', v_clean,
      'displayPhone', COALESCE(NULLIF(trim(p_display_phone), ''), v_clean),
      'timestamp', v_ts_label,
      'result', CASE WHEN v_chosen.is_no_win THEN 'Perdeu' ELSE 'Ganhou' END,
      'prizeId', v_chosen.id,
      'prizeName', v_chosen.name,
      'redeemed', false,
      'redemptionCode', v_code
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.play_scratchcard(TEXT, TEXT) TO anon, authenticated;

-- 5. RPCs Administrativas
CREATE OR REPLACE FUNCTION public.verify_admin_password(p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT admin_password_hash INTO v_hash FROM public.campaign_config WHERE id = 'default';
  RETURN v_hash IS NOT NULL AND encode(sha256(convert_to(COALESCE(p_password, ''), 'UTF8')), 'hex') = v_hash;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_admin_password(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_dashboard(p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.campaign_config%ROWTYPE;
  v_prizes JSONB;
  v_parts JSONB;
BEGIN
  PERFORM public._assert_admin(p_password);
  SELECT * INTO v_cfg FROM public.campaign_config WHERE id = 'default';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', p.id, 'name', p.name, 'qty', p.qty, 'distributed', p.distributed, 'probability', p.probability, 'active', p.active, 'isNoWin', p.is_no_win)
      ORDER BY p.created_at ASC
    ), '[]'::jsonb
  ) INTO v_prizes FROM public.prizes p;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', pt.id, 'cleanPhone', pt.clean_phone, 'displayPhone', pt.display_phone, 'timestamp', pt.timestamp_label, 'result', pt.result, 'prizeId', pt.prize_id, 'prizeName', pt.prize_name, 'redeemed', pt.redeemed, 'redemptionCode', pt.redemption_code, 'createdAt', pt.created_at)
      ORDER BY pt.created_at DESC
    ), '[]'::jsonb
  ) INTO v_parts FROM public.participations pt;

  RETURN jsonb_build_object(
    'branding', jsonb_build_object('name', v_cfg.brand_name, 'logoUrl', v_cfg.logo_url, 'primaryColor', v_cfg.primary_color, 'subtitle', v_cfg.subtitle),
    'settings', jsonb_build_object('active', v_cfg.campaign_active, 'maxPerPhone', v_cfg.max_per_phone, 'startDate', v_cfg.start_date::text, 'endDate', v_cfg.end_date::text),
    'prizes', v_prizes,
    'participations', v_parts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_dashboard(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_prize(p_password TEXT, p_id TEXT, p_name TEXT, p_qty INTEGER, p_probability NUMERIC, p_active BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_password);
  INSERT INTO public.prizes (id, name, qty, distributed, probability, active, is_no_win)
  VALUES (p_id, trim(p_name), GREATEST(0, p_qty), 0, GREATEST(0, LEAST(100, p_probability)), p_active, false)
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, qty = EXCLUDED.qty, probability = EXCLUDED.probability, active = EXCLUDED.active;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_save_prize(TEXT, TEXT, TEXT, INTEGER, NUMERIC, BOOLEAN) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_prize(p_password TEXT, p_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_password);
  DELETE FROM public.prizes WHERE id = p_id AND is_no_win = false;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_prize(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_toggle_redeemed(p_password TEXT, p_id TEXT, p_redeemed BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_password);
  UPDATE public.participations SET redeemed = p_redeemed WHERE id = p_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_redeemed(TEXT, TEXT, BOOLEAN) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_participation(p_password TEXT, p_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_password);
  DELETE FROM public.participations WHERE id = p_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_participation(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_participations(p_password TEXT, p_ids TEXT[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_password);
  IF p_ids IS NULL THEN
    DELETE FROM public.participations;
  ELSE
    DELETE FROM public.participations WHERE id = ANY(p_ids);
  END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_participations(TEXT, TEXT[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_config(
  p_password TEXT, p_brand_name TEXT, p_logo_url TEXT, p_primary_color TEXT, p_subtitle TEXT,
  p_campaign_active BOOLEAN, p_max_per_phone INTEGER, p_start_date DATE, p_end_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_password);
  UPDATE public.campaign_config
  SET brand_name = COALESCE(NULLIF(trim(p_brand_name), ''), brand_name),
      logo_url = COALESCE(NULLIF(trim(p_logo_url), ''), logo_url),
      primary_color = CASE WHEN p_primary_color ~ '^#[0-9A-Fa-f]{6}$' THEN p_primary_color ELSE primary_color END,
      subtitle = COALESCE(trim(p_subtitle), subtitle),
      campaign_active = p_campaign_active,
      max_per_phone = GREATEST(1, LEAST(100, p_max_per_phone)),
      start_date = p_start_date,
      end_date = p_end_date,
      updated_at = NOW()
  WHERE id = 'default';
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_save_config(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, DATE, DATE) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_change_password(p_password TEXT, p_new_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_admin(p_password);
  IF length(COALESCE(p_new_password, '')) < 8 THEN
    RAISE EXCEPTION 'A nova senha deve ter pelo menos 8 caracteres.';
  END IF;
  UPDATE public.campaign_config
  SET admin_password_hash = encode(sha256(convert_to(p_new_password, 'UTF8')), 'hex'),
      updated_at = NOW()
  WHERE id = 'default';
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_change_password(TEXT, TEXT) TO anon, authenticated;`;
