-- Статус на събранието и дата на публикувана покана.
-- - status: 'draft' | 'active' | 'closed'.
-- - convening_notice_posted_at: timestamp кога е окачена/публикувана поканата физически
--   (за проверка „минимум 7 дни преди начало“ по ЗУЕС).
-- - Backfill: всички съществуващи събрания → 'active' (запазват досегашното поведение).
-- - Промяна на trigger 074: notification „ново събрание“ тръгва само при INSERT със
--   status='active' или при UPDATE на status: draft → active.
-- Изисква: 062 (meetings), 074 (trg_meetings_after_insert_notify).

-- 1) Колони
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS convening_notice_posted_at TIMESTAMPTZ;

-- Backfill: съществуващите събрания са „активни“.
UPDATE public.meetings
SET status = 'active'
WHERE status IS NULL;

ALTER TABLE public.meetings
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.meetings
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meetings_status_chk'
  ) THEN
    ALTER TABLE public.meetings
      ADD CONSTRAINT meetings_status_chk
      CHECK (status IN ('draft', 'active', 'closed'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_meetings_status
  ON public.meetings (status, convening_started_at DESC);

COMMENT ON COLUMN public.meetings.status IS
  'draft = в подготовка (без нотификации/кворум) · active = свикано · closed = приключено.';
COMMENT ON COLUMN public.meetings.convening_notice_posted_at IS
  'Кога е окачена/публикувана поканата (за проверка ≥ 7 дни преди convening_started_at).';

-- 2) Промяна на trigger-а: нотификация „ново събрание“ САМО ако е активно.
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
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

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

-- 3) Нов trigger: при UPDATE на status (draft → active) — пращаме нотификация.
CREATE OR REPLACE FUNCTION public.trg_meetings_after_status_active_notify()
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
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'active' THEN
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meetings_after_status_active_notify ON public.meetings;
CREATE TRIGGER trg_meetings_after_status_active_notify
  AFTER UPDATE OF status ON public.meetings
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_meetings_after_status_active_notify();
