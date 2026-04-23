import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { openPublicStorageInNewTab, rawBodyForStorageUpload } from '../lib/storageUpload'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Download, Trash2, FileText, Image as ImageIcon, Link2, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Documents.css'
import { formatUnitNumberDisplay, sortUnitsByTypeAndNumber } from '../lib/unitNumber'

export interface DocumentCategoryRow {
  id: string
  code: string
  name: string
}

interface DocumentRow {
  id: string
  name: string
  file_path: string | null
  file_type: string | null
  description: string | null
  document_category_id: string | null
  document_categories: DocumentCategoryRow | null
  related_type: 'expense' | 'income' | 'unit' | null
  related_id: string | null
  created_at: string
  external_url?: string | null
}

type UnitLabel = {
  id: string
  type?: string
  number: string | null
  owner_name: string | null
  group: { name: string | null } | null
}

function unitDisplayLabel(u: UnitLabel): string {
  const g = u.group?.name
  const n = u.number != null ? formatUnitNumberDisplay(u.number) : ''
  return [g, n].filter(Boolean).join(' ') || u.owner_name || u.id.slice(0, 8)
}

/** PostgREST понякога връща вложения ред като обект или едноелементен масив. */
function normalizeDocumentRow(raw: Record<string, unknown>): DocumentRow {
  let cat = raw.document_categories
  if (Array.isArray(cat)) cat = cat[0] ?? null
  return {
    ...(raw as unknown as DocumentRow),
    document_categories: (cat ?? null) as DocumentCategoryRow | null,
  }
}

type CategoryFilter = 'all' | 'none' | string

export default function Documents() {
  const { canEdit } = useAuth()
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [documentCategories, setDocumentCategories] = useState<DocumentCategoryRow[]>([])
  const [unitLabels, setUnitLabels] = useState<Record<string, string>>({})
  const [units, setUnits] = useState<UnitLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    document_category_id: '' as string,
    unit_id: '' as string,
    file: null as File | null,
    external_url: '',
  })
  const [addMode, setAddMode] = useState<'file' | 'link'>('file')

  const loadPage = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: catData, error: catErr }, { data: uData }] = await Promise.all([
        supabase.from('document_categories').select('id, code, name').order('sort_order', { ascending: true }),
        supabase
          .from('units')
          .select('id, type, number, owner_name, group:group_id (name)')
          .order('type', { ascending: true })
          .order('number', { ascending: true }),
      ])
      if (catErr) throw catErr
      setDocumentCategories((catData ?? []) as DocumentCategoryRow[])
      setUnits(sortUnitsByTypeAndNumber(((uData ?? []) as unknown) as UnitLabel[]))

      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('documents')
          .select('*, document_categories ( id, code, name )')
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      const rawRows = (data || []) as Record<string, unknown>[]
      const rows = rawRows.map(normalizeDocumentRow)
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
      console.error('Error loading documents page:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  const filteredDocuments = useMemo(() => {
    if (categoryFilter === 'all') return documents
    if (categoryFilter === 'none') return documents.filter((d) => !d.document_category_id)
    return documents.filter((d) => d.document_category_id === categoryFilter)
  }, [documents, categoryFilter])

  const normalizeUrl = (raw: string): string => {
    const t = raw.trim()
    if (!t) return ''
    if (t.startsWith('http://') || t.startsWith('https://')) return t
    return `https://${t}`
  }

  const handleDocumentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const unitId = formData.unit_id.trim()
    const catId = formData.document_category_id.trim()

    if (addMode === 'link') {
      const href = normalizeUrl(formData.external_url)
      if (!href || !/^https?:\/\//i.test(href)) {
        alert('Въведете валиден адрес (https://...).')
        return
      }
      if (!formData.name.trim()) {
        alert('Въведете име на връзката.')
        return
      }
      setUploading(true)
      try {
        const payload = {
          name: formData.name.trim(),
          external_url: href,
          file_path: null,
          file_type: null,
          description: formData.description || null,
          document_category_id: catId || null,
          related_type: unitId ? ('unit' as const) : null,
          related_id: unitId || null,
        }
        const { error: dbError } = await supabase.from('documents').insert(payload)
        if (dbError) throw dbError
        setShowModal(false)
        setAddMode('file')
        setFormData({
          name: '',
          description: '',
          document_category_id: '',
          unit_id: '',
          file: null,
          external_url: '',
        })
        void loadPage()
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Грешка при запис'
        alert(
          msg.includes('check') || msg.includes('constraint')
            ? `${msg}\n\nИзпълни миграцията database_migrations/050_documents_links_expenses_liquidity_users.sql в Supabase.`
            : msg
        )
      } finally {
        setUploading(false)
      }
      return
    }

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

      const payload = {
        name: formData.name || formData.file.name,
        file_path: filePath,
        file_type: ct,
        description: formData.description || null,
        document_category_id: catId || null,
        related_type: unitId ? ('unit' as const) : null,
        related_id: unitId || null,
        external_url: null,
      }

      const { error: dbError } = await supabase.from('documents').insert(payload)

      if (dbError) throw dbError

      setShowModal(false)
      setAddMode('file')
      setFormData({
        name: '',
        description: '',
        document_category_id: '',
        unit_id: '',
        file: null,
        external_url: '',
      })
      void loadPage()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при качване на файл'
      alert(msg)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (doc: DocumentRow) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този документ?')) return

    try {
      if (!doc.external_url && doc.file_path) {
        const { error: storageError } = await supabase.storage.from('documents').remove([doc.file_path])
        if (storageError) throw storageError
      }

      const { error: dbError } = await supabase.from('documents').delete().eq('id', doc.id)

      if (dbError) throw dbError

      void loadPage()
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Грешка при изтриване')
    }
  }

  const openNewModal = () => {
    setAddMode('file')
    setFormData({
      name: '',
      description: '',
      document_category_id: '',
      unit_id: '',
      file: null,
      external_url: '',
    })
    setShowModal(true)
  }

  const getFileIcon = (fileType: string | null) => {
    if (!fileType) return <Link2 size={22} aria-hidden />
    if (fileType.startsWith('image/')) {
      return <ImageIcon size={24} />
    }
    return <FileText size={24} />
  }

  const relatedSummary = (doc: DocumentRow): string => {
    if (doc.related_type === 'unit' && doc.related_id) {
      const label = unitLabels[doc.related_id]
      return label ? label : '—'
    }
    if (!doc.related_type && !doc.related_id) {
      return 'Общо за блока'
    }
    return '—'
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="documents-page">
      <div className="page-header">
        <div>
          <h1>Документи</h1>
          <p>Таблица с файлове или външни връзки. По избор връзката/файлът се обвързва с обект (апартамент).</p>
        </div>
        {canEdit() && (
          <button type="button" className="btn-primary" onClick={openNewModal}>
            <Plus size={20} />
            Добави документ
          </button>
        )}
      </div>

      {documents.length > 0 && (
        <div className="documents-filter-bar">
          <label htmlFor="documents-category-filter">Филтър по тип</label>
          <select
            id="documents-category-filter"
            className="documents-filter-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          >
            <option value="all">Всички</option>
            <option value="none">Без тип</option>
            {documentCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="documents-table-wrap table-container">
        {documents.length === 0 ? (
          <div className="empty-state">Няма документи</div>
        ) : filteredDocuments.length === 0 ? (
          <div className="empty-state">Няма документи за избрания тип</div>
        ) : (
          <table className="data-table documents-data-table">
            <thead>
              <tr>
                <th>Име</th>
                <th>Тип</th>
                <th>Вид</th>
                <th>Обект / обхват</th>
                <th>Описание</th>
                <th>Дата</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((doc) => {
                const isLink = Boolean(doc.external_url && doc.external_url.trim())
                const { data: urlData } = doc.file_path
                  ? supabase.storage.from('documents').getPublicUrl(doc.file_path)
                  : { data: { publicUrl: '' } }
                return (
                  <tr key={doc.id}>
                    <td>
                      <div className="document-table-name">
                        {isLink ? <Link2 size={16} className="doc-kind-icon" aria-hidden /> : getFileIcon(doc.file_type)}
                        <span>{doc.name}</span>
                      </div>
                    </td>
                    <td>{doc.document_categories?.name ?? '—'}</td>
                    <td>{isLink ? 'Връзка' : 'Файл'}</td>
                    <td>{relatedSummary(doc)}</td>
                    <td className="document-table-desc">{doc.description?.trim() || '—'}</td>
                    <td>{format(new Date(doc.created_at), 'dd.MM.yyyy HH:mm', { locale: bg })}</td>
                    <td>
                      <div className="table-actions">
                        {isLink && doc.external_url ? (
                          <a
                            href={doc.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="icon-btn"
                            title="Отвори връзката"
                          >
                            <ExternalLink size={18} />
                          </a>
                        ) : doc.file_path ? (
                          <a
                            href={urlData.publicUrl}
                            className="icon-btn"
                            title="Свали / отвори"
                            onClick={(e) => {
                              e.preventDefault()
                              void openPublicStorageInNewTab(urlData.publicUrl, doc.name)
                            }}
                          >
                            <Download size={18} />
                          </a>
                        ) : null}
                        {canEdit() && (
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => void handleDelete(doc)}
                            title="Изтрий"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Добави документ</h2>
            <form onSubmit={(e) => void handleDocumentSubmit(e)}>
              <div className="form-group">
                <label>Начин</label>
                <div className="document-mode-row">
                  <label className="document-mode-label">
                    <input
                      type="radio"
                      name="addMode"
                      checked={addMode === 'file'}
                      onChange={() => setAddMode('file')}
                    />
                    Качи файл
                  </label>
                  <label className="document-mode-label">
                    <input
                      type="radio"
                      name="addMode"
                      checked={addMode === 'link'}
                      onChange={() => setAddMode('link')}
                    />
                    Външна връзка
                  </label>
                </div>
              </div>
              <div className="form-group">
                <label>Име {addMode === 'link' ? '*' : ''}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={addMode === 'file' ? 'Празно = име на файла' : 'Заглавие на връзката'}
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
                <label>Тип (опционално)</label>
                <select
                  value={formData.document_category_id}
                  onChange={(e) => setFormData({ ...formData, document_category_id: e.target.value })}
                >
                  <option value="">— Без тип —</option>
                  {documentCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Обект (опционално)</label>
                <select
                  value={formData.unit_id}
                  onChange={(e) => setFormData({ ...formData, unit_id: e.target.value })}
                >
                  <option value="">Не е свързано с конкретен обект</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {unitDisplayLabel(u)}
                    </option>
                  ))}
                </select>
              </div>
              {addMode === 'link' ? (
                <div className="form-group">
                  <label>URL *</label>
                  <input
                    type="url"
                    value={formData.external_url}
                    onChange={(e) => setFormData({ ...formData, external_url: e.target.value })}
                    placeholder="https://…"
                    autoComplete="url"
                    required
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label>Файл (снимка или PDF) *</label>
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
                      Избран: {formData.file.name} ({(formData.file.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Отказ
                </button>
                <button type="submit" className="btn-primary" disabled={uploading}>
                  {uploading ? 'Запис…' : 'Запази'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
