const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
}

/**
 * MIME за Storage upload.
 * По разширение, когато е известно — винаги ползваме таблицата (браузърът често дава празно
 * или application/octet-stream). Иначе `File.type`, нормализиран (напр. image/jpg → jpeg).
 */
export function contentTypeForFile(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const fromExt = EXT_TO_MIME[ext]
  if (fromExt) return fromExt

  let t = (file.type ?? '').trim()
  if (t === 'image/jpg') t = 'image/jpeg'
  if (t !== '') return t
  return 'application/octet-stream'
}

/**
 * Сурови байтове + MIME за Supabase Storage upload.
 *
 * При `File`/`Blob` @supabase/storage-js качва през FormData и НЕ подава `fileOptions.contentType`
 * към сървъра — обектът често излиза с application/json (глобалният Content-Type на клиента).
 * При `ArrayBuffer` клиентът задава `Content-Type` в заглавките и типът се записва правилно.
 */
export async function rawBodyForStorageUpload(file: File): Promise<{ body: ArrayBuffer; contentType: string }> {
  const contentType = contentTypeForFile(file)
  const body = await file.arrayBuffer()
  return { body, contentType }
}

/** MIME по име на файл (стари обекти в Storage без правилен Content-Type). */
export function mimeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_MIME[ext] ?? 'application/octet-stream'
}

/**
 * Отваря публичен обект в нов раздел с коректен MIME.
 * При octet-stream директният URL показва „бинарен“ текст — fetch + Blob с тип по разширение.
 */
export async function openPublicStorageInNewTab(publicUrl: string, fileName: string): Promise<void> {
  try {
    const res = await fetch(publicUrl, { mode: 'cors' })
    if (!res.ok) {
      window.open(publicUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const blob = await res.blob()
    const hint = mimeFromFileName(fileName)
    if (
      (!blob.type || blob.type === 'application/octet-stream' || blob.type === 'binary/octet-stream') &&
      hint === 'application/octet-stream'
    ) {
      window.open(publicUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const bad =
      !blob.type ||
      blob.type === 'application/octet-stream' ||
      blob.type === 'binary/octet-stream'
    const type = bad && hint !== 'application/octet-stream' ? hint : blob.type || hint
    const out = type !== blob.type ? new Blob([await blob.arrayBuffer()], { type }) : blob
    const u = URL.createObjectURL(out)
    // Blob URL in the new tab's address bar is expected; avoid noopener here — some
    // browsers fail to render PDF/image from blob: with windowFeatures set.
    const w = window.open(u, '_blank')
    if (!w) {
      URL.revokeObjectURL(u)
      window.open(publicUrl, '_blank', 'noopener,noreferrer')
      return
    }
    window.setTimeout(() => URL.revokeObjectURL(u), 3_600_000)
  } catch {
    window.open(publicUrl, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Име на обект в bucket — без интервали и странни символи (инъче URL съдържа %20 и лесно се чупи).
 */
export function sanitizeStorageFileName(name: string): string {
  const base = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
  return base.slice(0, 120)
}
