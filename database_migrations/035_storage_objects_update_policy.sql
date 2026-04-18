-- Политика UPDATE за bucket documents — без нея upsert/презапис на обект може да мине с грешка
-- или да остави обект с объркани метаданни при частични операции.

DROP POLICY IF EXISTS "Only admins and editors can update storage documents" ON storage.objects;

CREATE POLICY "Only admins and editors can update storage documents"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );
