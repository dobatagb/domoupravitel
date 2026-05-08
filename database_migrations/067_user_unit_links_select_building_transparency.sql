-- Viewer вижда всички user_unit_links (като admin), за да може UI да сумира гласовете по събрание
-- за всички собственици. Досега viewers виждаха само собствените си редове и клиентът
-- отсяваше чуждите гласове при aggregateAgendaVotesForItem.
-- Изисква: 061 (admin | viewer), 012 (user_unit_links).

DROP POLICY IF EXISTS "View user_unit_links" ON public.user_unit_links;

CREATE POLICY "View user_unit_links"
  ON public.user_unit_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'viewer')
    )
    OR user_id = auth.uid()
  );
