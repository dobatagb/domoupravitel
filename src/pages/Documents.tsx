import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Download, Trash2, FileText, Image as ImageIcon } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Documents.css'

interface Document {
  id: string
  name: string
  file_path: string
  file_type: string
  description: string | null
  floor_id: string | null
  created_at: string
  floors?: { floor_number: number; apartment_number: string }
}

export default function Documents() {
  const { canEdit } = useAuth()
  const [documents, setDocuments] = useState<Document[]>([])
  const [floors, setFloors] = useState<Array<{ id: string; floor_number: number; apartment_number: string }>>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    floor_id: '',
    file: null as File | null,
  })

  useEffect(() => {
    fetchFloors()
    fetchDocuments()
  }, [])

  const fetchFloors = async () => {
    try {
      const { data } = await supabase
        .from('floors')
        .select('id, floor_number, apartment_number')
        .order('floor_number')
      setFloors(data || [])
    } catch (error) {
      console.error('Error fetching floors:', error)
    }
  }

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select(`
          *,
          floors:floor_id (floor_number, apartment_number)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      setDocuments(data || [])
    } catch (error) {
      console.error('Error fetching documents:', error)
    } finally {
      setLoading(false)
    }
  }

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

      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, formData.file)

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath)

      // Save document record
      const { error: dbError } = await supabase.from('documents').insert({
        name: formData.name || formData.file.name,
        file_path: filePath,
        file_type: formData.file.type,
        description: formData.description || null,
        floor_id: formData.floor_id || null,
      })

      if (dbError) throw dbError

      setShowModal(false)
      setFormData({
        name: '',
        description: '',
        floor_id: '',
        file: null,
      })
      fetchDocuments()
    } catch (error: any) {
      alert(error.message || 'Грешка при качване на файл')
    } finally {
      setUploading(false)
    }
  }


  const handleDelete = async (id: string, filePath: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този документ?')) return

    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove([filePath])

      if (storageError) throw storageError

      // Delete from database
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', id)

      if (dbError) throw dbError

      fetchDocuments()
    } catch (error: any) {
      alert(error.message || 'Грешка при изтриване')
    }
  }

  const openNewModal = () => {
    setFormData({
      name: '',
      description: '',
      floor_id: '',
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

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="documents-page">
      <div className="page-header">
        <div>
          <h1>Документи</h1>
          <p>Управление на документи и снимки</p>
        </div>
        {canEdit() && (
          <button className="btn-primary" onClick={openNewModal}>
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
            const { data: urlData } = supabase.storage
              .from('documents')
              .getPublicUrl(doc.file_path)

            return (
              <div key={doc.id} className="document-card">
                {isImage(doc.file_type) ? (
                  <div className="document-preview image">
                    <img src={urlData.publicUrl} alt={doc.name} />
                  </div>
                ) : (
                  <div className="document-preview file">
                    {getFileIcon(doc.file_type)}
                  </div>
                )}
                <div className="document-info">
                  <h3>{doc.name}</h3>
                  {doc.description && <p>{doc.description}</p>}
                  {doc.floors && (
                    <div className="document-floor">
                      Етаж {doc.floors.floor_number}, Ап. {doc.floors.apartment_number}
                    </div>
                  )}
                  <div className="document-date">
                    {format(new Date(doc.created_at), 'dd.MM.yyyy HH:mm', { locale: bg })}
                  </div>
                </div>
                <div className="document-actions">
                  <a
                    href={urlData.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="icon-btn"
                    title="Отвори"
                  >
                    <Download size={18} />
                  </a>
                  {canEdit() && (
                    <button
                      className="icon-btn danger"
                      onClick={() => handleDelete(doc.id, doc.file_path)}
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
            <form onSubmit={handleFileUpload}>
              <div className="form-group">
                <label>Име на документ</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Оставете празно за използване на името на файла"
                />
              </div>
              <div className="form-group">
                <label>Описание (опционално)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Етаж (опционално)</label>
                <select
                  value={formData.floor_id}
                  onChange={(e) =>
                    setFormData({ ...formData, floor_id: e.target.value })
                  }
                >
                  <option value="">Не е свързано с етаж</option>
                  {floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      Етаж {floor.floor_number}, Ап. {floor.apartment_number}
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
                    Избран файл: {formData.file.name} (
                    {(formData.file.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Отказ
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={uploading}
                >
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

