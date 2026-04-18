import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { openPublicStorageInNewTab, rawBodyForStorageUpload } from '../lib/storageUpload'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Download, Trash2, FileText, Image as ImageIcon } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Documents.css'

interface DocumentRow {
  id: string
  name: string
  file_path: string
  file_type: string
  description: string | null
  related_type: 'expense' | 'income' | 'unit' | null
  related_id: string | null
  created_at: string
}

type UnitLabel = {
  id: string
  number: string | null
  owner_name: string | null
  group: { name: string | null } | null
}

function unitDisplayLabel(u: UnitLabel): string {
  const g = u.group?.name
  const n = u.number
  return [g, n].filter(Boolean).join(' ') || u.owner_name || u.id.slice(0, 8)
}

export default function Documents() {
  const { canEdit } = useAuth()
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [unitLabels, setUnitLabels] = useState<Record<string, string>>({})
  const [units, setUnits] = useState<UnitLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    unit_id: '' as string,
    file: null as File | null,
  })

  const fetchUnits = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('units')
        .select('id, number, owner_name, group:group_id (name)')
        .order('type', { ascending: true })
        .order('number', { ascending: true })
      setUnits(((data ?? []) as unknown) as UnitLabel[])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }, [])

  const fetchDocuments = useCallback(async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase.from('documents').select('*').order('created_at', { ascending: false })
      )

      if (error) throw error
      const rows = (data || []) as DocumentRow[]
      setDocuments(rows)

      const unitIds = [
        ...new Set(
          rows.filter((d) => d.related_type === 'unit' && d.related_id).map((d) => d.related_id as string)
        ),
      ]
      if (unitIds.length === 0) {
        setUnitLabels({})
        return
      }
      const { data: urows, error: uerr } = await supabase
        .from('units')
        .select('id, number, owner_name, group:group_id (name)')
        .in('id', unitIds)
      if (uerr) throw uerr
      const map: Record<string, string> = {}
      for (const u of ((urows ?? []) as unknown) as UnitLabel[]) {
        map[u.id] = unitDisplayLabel(u)
      }
      setUnitLabels(map)
    } catch (error) {
      console.error('Error fetching documents:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchUnits()
    void fetchDocuments()
  }, [fetchUnits, fetchDocuments])

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.file) {
      alert('Моля, изберете файл')
      return
    }

    setUploading(true)
    try {
      const fileExt = formData.file.name.split('.').pop()
      const fileName = `${Math.random()}.${fileExt}`
      const filePath = `documents/${fileName}`

      const { body: uploadBody, contentType: ct } = await rawBodyForStorageUpload(formData.file)
      const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, uploadBody, {
        cacheControl: '3600',
        contentType: ct,
        upsert: false,
      })

      if (uploadError) throw uploadError

      void supabase.storage.from('documents').getPublicUrl(filePath)

      const unitId = formData.unit_id.trim()
      const payload = {
        name: formData.name || formData.file.name,
        file_path: filePath,
        file_type: ct,
        description: formData.description || null,
        related_type: unitId ? ('unit' as const) : null,
        related_id: unitId || null,
      }

      const { error: dbError } = await supabase.from('documents').insert(payload)

      if (dbError) throw dbError

      setShowModal(false)
      setFormData({
        name: '',
        description: '',
        unit_id: '',
        file: null,
      })
      void fetchDocuments()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при качване на файл'
      alert(msg)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string, filePath: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този документ?')) return

    try {
      const { error: storageError } = await supabase.storage.from('documents').remove([filePath])

      if (storageError) throw storageError

      const { error: dbError } = await supabase.from('documents').delete().eq('id', id)

      if (dbError) throw dbError

      void fetchDocuments()
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Грешка при изтриване')
    }
  }

  const openNewModal = () => {
    setFormData({
      name: '',
      description: '',
      unit_id: '',
      file: null,
    })
    setShowModal(true)
  }

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) {
      return <ImageIcon size={24} />
    }
    return <FileText size={24} />
  }

  const isImage = (fileType: string) => {
    return fileType.startsWith('image/')
  }

  const relatedLine = (doc: DocumentRow) => {
    if (doc.related_type === 'unit' && doc.related_id) {
      const label = unitLabels[doc.related_id]
      return label ? <div className="document-floor">Единица: {label}</div> : null
    }
    if (!doc.related_type && !doc.related_id) {
      return <div className="document-floor">Общ за блока</div>
    }
    return null
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="documents-page">
      <div className="page-header">
        <div>
          <h1>Документи</h1>
          <p>Управление на документи и снимки. По избор свържете файла с единица (апартамент) за по-лесно търсене.</p>
        </div>
        {canEdit() && (
          <button type="button" className="btn-primary" onClick={openNewModal}>
            <Plus size={20} />
            Качи документ
          </button>
        )}
      </div>

      <div className="documents-grid">
        {documents.length === 0 ? (
          <div className="empty-state">Няма качени документи</div>
        ) : (
          documents.map((doc) => {
            const { data: urlData } = supabase.storage.from('documents').getPublicUrl(doc.file_path)

            return (
              <div key={doc.id} className="document-card">
                {isImage(doc.file_type) ? (
                  <div className="document-preview image">
                    <img src={urlData.publicUrl} alt={doc.name} />
                  </div>
                ) : (
                  <div className="document-preview file">{getFileIcon(doc.file_type)}</div>
                )}
                <div className="document-info">
                  <h3>{doc.name}</h3>
                  {doc.description && <p>{doc.description}</p>}
                  {relatedLine(doc)}
                  <div className="document-date">
                    {format(new Date(doc.created_at), 'dd.MM.yyyy HH:mm', { locale: bg })}
                  </div>
                </div>
                <div className="document-actions">
                  <a
                    href={urlData.publicUrl}
                    className="icon-btn"
                    title="Отвори"
                    onClick={(e) => {
                      e.preventDefault()
                      void openPublicStorageInNewTab(urlData.publicUrl, doc.name)
                    }}
                  >
                    <Download size={18} />
                  </a>
                  {canEdit() && (
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => void handleDelete(doc.id, doc.file_path)}
                      title="Изтрий"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Качи документ</h2>
            <form onSubmit={(e) => void handleFileUpload(e)}>
              <div className="form-group">
                <label>Име на документ</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Оставете празно за използване на името на файла"
                />
              </div>
              <div className="form-group">
                <label>Описание (опционално)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Единица (опционално)</label>
                <select
                  value={formData.unit_id}
                  onChange={(e) => setFormData({ ...formData, unit_id: e.target.value })}
                >
                  <option value="">Не е свързано с конкретна единица</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {unitDisplayLabel(u)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Файл (снимка или PDF)</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      file: e.target.files?.[0] || null,
                    })
                  }
                  required
                />
                {formData.file && (
                  <div className="file-info">
                    Избран файл: {formData.file.name} ({(formData.file.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Отказ
                </button>
                <button type="submit" className="btn-primary" disabled={uploading}>
                  {uploading ? 'Качване...' : 'Качи'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
