-- Статус на точка: отворена за гласуване (open) или гласувана/затворена (closed).
-- Гласове само докато точката е open.
-- Изисква: 065 (или еквивалентна meeting_agenda_votes по user_id).

ALTER TABLE public.meeting_agenda_items
  ADD COLUMN IF NOT EXISTS voting_status TEXT;

UPDATE public.meeting_agenda_items
SET voting_status = 'open'
WHERE voting_status IS NULL;

ALTER TABLE public.meeting_agenda_items
  ALTER COLUMN voting_status SET DEFAULT 'open';

ALTER TABLE public.meeting_agenda_items
  ALTER COLUMN voting_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meeting_agenda_items_voting_status_chk'
  ) THEN
    ALTER TABLE public.meeting_agenda_items
      ADD CONSTRAINT meeting_agenda_items_voting_status_chk
      CHECK (voting_status IN ('open', 'closed'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.meeting_agenda_items.voting_status IS
  'open = отворена за гласуване; closed = гласуването е приключило (само админ променя).';

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_items_status
  ON public.meeting_agenda_items (meeting_id, voting_status);

CREATE OR REPLACE FUNCTION public.can_vote_meeting_agenda_item(p_agenda_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_agenda_items ai
    INNER JOIN public.meeting_attendees ma ON ma.meeting_id = ai.meeting_id
    INNER JOIN public.user_unit_links uul ON uul.unit_id = ma.unit_id AND uul.user_id = auth.uid()
    WHERE ai.id = p_agenda_item_id
      AND ai.voting_status = 'open'
  );
$$;

COMMENT ON FUNCTION public.can_vote_meeting_agenda_item(UUID) IS
  'TRUE ако точката е отворена за гласуване и текущият потребител има поне един присъстващ обект.';
