-- Real-time за събрания: денормализирано meeting_id в meeting_agenda_votes (за filter
-- по събрание в Realtime channel-а) + REPLICA IDENTITY FULL + добавяне на трите ключови
-- таблици в supabase_realtime публикацията.
-- Изисква: 062 (meetings, meeting_attendees), 064/065 (meeting_agenda_items, meeting_agenda_votes).

-- 1) Нова денормализирана колона meeting_id в meeting_agenda_votes.
ALTER TABLE public.meeting_agenda_votes
  ADD COLUMN IF NOT EXISTS meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE;

UPDATE public.meeting_agenda_votes v
SET meeting_id = ai.meeting_id
FROM public.meeting_agenda_items ai
WHERE ai.id = v.agenda_item_id
  AND v.meeting_id IS NULL;

ALTER TABLE public.meeting_agenda_votes
  ALTER COLUMN meeting_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_votes_meeting
  ON public.meeting_agenda_votes (meeting_id);

COMMENT ON COLUMN public.meeting_agenda_votes.meeting_id IS
  'Денормализирано meeting_id (= meeting_agenda_items.meeting_id) за лесен Realtime филтър по събрание.';

-- 2) Trigger: при INSERT, ако meeting_id е NULL, автоматично го попълва от родителската точка.
CREATE OR REPLACE FUNCTION public.trg_meeting_agenda_votes_fill_meeting_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.meeting_id IS NULL THEN
    SELECT meeting_id INTO NEW.meeting_id
    FROM public.meeting_agenda_items
    WHERE id = NEW.agenda_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_agenda_votes_fill_meeting_id
  ON public.meeting_agenda_votes;
CREATE TRIGGER trg_meeting_agenda_votes_fill_meeting_id
  BEFORE INSERT ON public.meeting_agenda_votes
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_meeting_agenda_votes_fill_meeting_id();

-- 3) REPLICA IDENTITY FULL — за UPDATE/DELETE Realtime събитията да съдържат пълния
-- стар ред (нужно за UI feedback и за RLS филтриране на изпратения payload).
ALTER TABLE public.meeting_agenda_votes REPLICA IDENTITY FULL;
ALTER TABLE public.meeting_agenda_items REPLICA IDENTITY FULL;
ALTER TABLE public.meeting_attendees REPLICA IDENTITY FULL;

-- 4) Включване в supabase_realtime публикацията (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'meeting_agenda_items'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_agenda_items';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'meeting_agenda_votes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_agenda_votes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'meeting_attendees'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_attendees';
  END IF;
END
$$;
