-- Bucket за качени файлове (страница „Документи“, прикачвания към разходи).
-- Без него при отваряне на файл: {"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- Ако bucket-ът е създаден ръчно като частен, превключи към публичен за преглед с getPublicUrl:
UPDATE storage.buckets
SET public = true
WHERE id = 'documents';
