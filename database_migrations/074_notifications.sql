-- In-app + email-нотификации за събрания.
-- - notifications: видими през Realtime, виждат се само от собствения user.
-- - notification_outbox: служебна опашка за email dispatcher-а (Edge Function), достъпна само на service_role.
-- - Триггери на meetings / meeting_agenda_items / meetings.notes автоматично пълнят таблиците.
--
-- Целеви адресати по събитие:
--   * meeting_created       → всички auth.users с поне един user_unit_link
--   * agenda_item_opened    → само attendees на това събрание (по user_unit_links)
--   * agenda_item_closed    → само attendees на това събрание
--   * meeting_minutes       → само attendees на това събрание
-- Изисква: 062 (meetings, meeting_attendees), 064/065 (meeting_agenda_items),
--          066 (voting_status), 012 (user_unit_links), 061 (is_admin).

-- ============================================================================
-- 1) Таблици
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'meeting_created',
    'agenda_item_opened',
    'agenda_item_closed',
    'meeting_minutes'
  )),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id) WHERE read_at IS NULL;

COMMENT ON TABLE public.notifications IS
  'Уведомления (in-app). Един ред = едно събитие към един потребител. Realtime-видимо само на собствения user.';

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status
  ON public.notification_outbox (status, created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.notification_outbox IS
  'Опашка за email dispatcher (Edge Function); видима само на service_role.';

-- ============================================================================
-- 2) RLS
-- ============================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
GRANT ALL ON public.notification_outbox TO service_role;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Само маркиране като прочетено (read_at) — забранено пренаписване на kind/title/body.
DROP POLICY IF EXISTS "notifications_update_own_read" ON public.notifications;
CREATE POLICY "notifications_update_own_read"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- (notification_outbox: без policy за authenticated — service_role вижда всичко през bypass.)

-- ============================================================================
-- 3) Помощна функция: създава notifications + outbox редове за списък потребители.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._notify_users(
  p_user_ids UUID[],
  p_kind TEXT,
  p_title TEXT,
  p_body TEXT,
  p_link TEXT,
  p_payload JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF array_length(p_user_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH ins_notif AS (
    INSERT INTO public.notifications (user_id, kind, title, body, link, payload)
    SELECT uid, p_kind, p_title, p_body, p_link, COALESCE(p_payload, '{}'::jsonb)
    FROM unnest(p_user_ids) AS uid
    RETURNING id, user_id
  ),
  with_email AS (
    SELECT n.id AS notification_id, n.user_id, u.email
    FROM ins_notif n
    JOIN auth.users u ON u.id = n.user_id
    WHERE u.email IS NOT NULL AND length(u.email) > 0
  )
  INSERT INTO public.notification_outbox (notification_id, user_id, email, subject, body_text)
  SELECT notification_id,
         user_id,
         email,
         p_title,
         COALESCE(p_body, p_title)
  FROM with_email;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public._notify_users(UUID[], TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Създава notification за всеки от подадените user_ids и съответен outbox ред (ако има email).';

-- ============================================================================
-- 4) Триггер: ново събрание → notification до всички с поне един user_unit_link.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_meetings_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_ids UUID[];
  v_title TEXT;
  v_body TEXT;
  v_link TEXT;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT user_id), ARRAY[]::UUID[])
  INTO v_user_ids
  FROM public.user_unit_links;

  IF array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_title := 'Свикано е общо събрание: ' || COALESCE(NULLIF(trim(NEW.title), ''), 'Събрание');
  v_body := 'Начало: ' || to_char(NEW.convening_started_at AT TIME ZONE 'Europe/Sofia', 'DD.MM.YYYY HH24:MI');
  v_link := '/meetings/' || NEW.id::text;

  PERFORM public._notify_users(
    v_user_ids,
    'meeting_created',
    v_title,
    v_body,
    v_link,
    jsonb_build_object('meeting_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meetings_after_insert_notify ON public.meetings;
CREATE TRIGGER trg_meetings_after_insert_notify
  AFTER INSERT ON public.meetings
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_meetings_after_insert_notify();

-- ============================================================================
-- 5) Триггер: точка отворена / затворена → notification само до attendees.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_agenda_items_after_status_change_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_ids UUID[];
  v_meeting_title TEXT;
  v_kind TEXT;
  v_title TEXT;
  v_body TEXT;
  v_link TEXT;
BEGIN
  IF NEW.voting_status IS NOT DISTINCT FROM OLD.voting_status THEN
    RETURN NEW;
  END IF;

  IF NEW.voting_status NOT IN ('open', 'closed') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT uul.user_id), ARRAY[]::UUID[])
  INTO v_user_ids
  FROM public.meeting_attendees ma
  JOIN public.user_unit_links uul ON uul.unit_id = ma.unit_id
  WHERE ma.meeting_id = NEW.meeting_id;

  IF array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(title), ''), 'Събрание') INTO v_meeting_title
  FROM public.meetings WHERE id = NEW.meeting_id;

  v_link := '/meetings/' || NEW.meeting_id::text || '#section-agenda';

  IF NEW.voting_status = 'open' THEN
    v_kind := 'agenda_item_opened';
    v_title := 'Отворена за гласуване точка: ' || NEW.title;
    v_body := 'Събрание „' || v_meeting_title || '". Можете да подадете глас.';
  ELSE
    v_kind := 'agenda_item_closed';
    v_title := 'Точката е приключена: ' || NEW.title;
    v_body := 'Събрание „' || v_meeting_title || '". Гласуването по точката приключи.';
  END IF;

  PERFORM public._notify_users(
    v_user_ids,
    v_kind,
    v_title,
    v_body,
    v_link,
    jsonb_build_object(
      'meeting_id', NEW.meeting_id,
      'agenda_item_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agenda_items_after_status_change_notify
  ON public.meeting_agenda_items;
CREATE TRIGGER trg_agenda_items_after_status_change_notify
  AFTER UPDATE OF voting_status ON public.meeting_agenda_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_agenda_items_after_status_change_notify();

-- ============================================================================
-- 6) Триггер: публикуван протокол (notes от NULL/'' → текст) → attendees.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_meetings_after_notes_publish_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_ids UUID[];
  v_title TEXT;
  v_body TEXT;
  v_link TEXT;
  v_old_has_text BOOLEAN := COALESCE(length(trim(OLD.notes)) > 0, FALSE);
  v_new_has_text BOOLEAN := COALESCE(length(trim(NEW.notes)) > 0, FALSE);
BEGIN
  -- Известяваме само при преход „празно → текст". Последващи редакции не пращат пак нотификация.
  IF v_old_has_text OR NOT v_new_has_text THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT uul.user_id), ARRAY[]::UUID[])
  INTO v_user_ids
  FROM public.meeting_attendees ma
  JOIN public.user_unit_links uul ON uul.unit_id = ma.unit_id
  WHERE ma.meeting_id = NEW.id;

  IF array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_title := 'Публикуван е протокол: ' || COALESCE(NULLIF(trim(NEW.title), ''), 'Събрание');
  v_body := 'Достъпен е протоколът от събранието.';
  v_link := '/meetings/' || NEW.id::text || '#section-protocol';

  PERFORM public._notify_users(
    v_user_ids,
    'meeting_minutes',
    v_title,
    v_body,
    v_link,
    jsonb_build_object('meeting_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meetings_after_notes_publish_notify ON public.meetings;
CREATE TRIGGER trg_meetings_after_notes_publish_notify
  AFTER UPDATE OF notes ON public.meetings
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_meetings_after_notes_publish_notify();

-- ============================================================================
-- 7) Realtime: notifications в supabase_realtime, REPLICA IDENTITY FULL.
-- ============================================================================

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END
$$;

-- ============================================================================
-- 8) RPC: масова промяна на read_at от страна на потребителя.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notifications_mark_all_read()
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Не сте влезли в системата.';
  END IF;

  UPDATE public.notifications
  SET read_at = NOW()
  WHERE user_id = auth.uid()
    AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notifications_mark_all_read() TO authenticated;

COMMENT ON FUNCTION public.notifications_mark_all_read() IS
  'Маркира всички непрочетени нотификации на текущия потребител като прочетени; връща броя.';
