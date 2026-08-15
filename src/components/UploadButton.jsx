import React, { useEffect, useMemo, useRef, useState } from 'react'
import { categories as defaultCategories } from '../data.js'
import { uploadMedia } from '../api.js'

const MAX_FILES = 50

export default function UploadButton({ categories = defaultCategories, onUploaded }) {
  const inputRef = useRef(null)
  const availableCategories = useMemo(
    () => categories.filter((category) => category.id !== 'all' && category.id !== 'favorites'),
    [categories],
  )
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [category, setCategory] = useState(availableCategories[0]?.id || '')
  const [customCategory, setCustomCategory] = useState('')
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!availableCategories.some((item) => item.id === category) && category !== 'custom') {
      setCategory(availableCategories[0]?.id || 'custom')
    }
  }, [availableCategories, category])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape' && status !== 'uploading') setOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, status])

  const selectFiles = (event) => {
    const selected = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/')).slice(0, MAX_FILES)
    setFiles(selected)
    setStatus('idle')
    setProgress(0)
    setError(selected.length ? '' : 'Выберите файлы изображений или видео')
  }

  const reset = () => {
    setFiles([])
    setCategory(availableCategories[0]?.id || 'custom')
    setCustomCategory('')
    setStatus('idle')
    setProgress(0)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const close = () => {
    if (status === 'uploading') return
    setOpen(false)
    reset()
  }

  const submit = async () => {
    const finalCategory = category === 'custom' ? customCategory.trim() : category
    if (!files.length || !finalCategory) return

    setStatus('uploading')
    setError('')
    try {
      for (let index = 0; index < files.length; index += 1) {
        await uploadMedia(files[index], finalCategory, (fileProgress) => {
          setProgress(((index + fileProgress) / files.length) * 100)
        })
      }
      setProgress(100)
      setStatus('done')
      onUploaded?.()
    } catch (uploadError) {
      setStatus('error')
      setError(uploadError.message || 'Не удалось загрузить файлы')
    }
  }

  const categoryIsValid = category !== 'custom' || Boolean(customCategory.trim())
  const disabled = !files.length || !categoryIsValid || status === 'uploading' || status === 'done'

  return (
    <>
      <button className="fab" onClick={() => setOpen(true)} aria-label="Загрузить фото или видео"><span aria-hidden="true">＋</span></button>
      {open && (
        <div className="upload-backdrop" onClick={close}>
          <section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(event) => event.stopPropagation()}>
            <button className="upload-modal__close" onClick={close} disabled={status === 'uploading'} aria-label="Закрыть"><span aria-hidden="true">×</span></button>
            <div className="upload-modal__icon"><span aria-hidden="true">↑</span></div>
            <p className="eyebrow">Добавить свои кадры</p>
            <h3 id="upload-title">Поделитесь фото и видео</h3>

            <div className="upload-field"><label htmlFor="photo-category">Категория</label><select id="photo-category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={status === 'uploading'}>
              {availableCategories.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
              <option value="custom">Добавить свою…</option>
            </select></div>

            {category === 'custom' && <div className="upload-field upload-field--custom"><label htmlFor="custom-category">Новая категория</label><input id="custom-category" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Например, Утро невесты" autoFocus disabled={status === 'uploading'} /></div>}

            <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={selectFiles} />
            <button className="upload-modal__select" onClick={() => inputRef.current?.click()} disabled={status === 'uploading'}>
              <span>{files.length ? `Выбрано файлов: ${files.length}` : 'Выбрать фото и видео'}</span>
            </button>
            {files.length > 0 && <p className="upload-modal__selection" aria-live="polite">{files.length === 1 ? files[0].name : `${files[0].name} и ещё ${files.length - 1}`}</p>}

            {status === 'uploading' && <div className="upload-progress" aria-live="polite"><div className="upload-progress__bar"><span style={{ width: `${progress}%` }} /></div><span>{Math.round(progress)}%</span></div>}
            {error && <p className="upload-modal__error" role="alert">{error}</p>}

            <button className="upload-modal__submit" disabled={disabled} onClick={submit}>
              {status === 'done' ? <><span aria-hidden="true">✓</span> Загружено</> : status === 'uploading' ? 'Загрузка…' : status === 'error' ? 'Повторить загрузку' : 'Загрузить'}
            </button>
            {status === 'done' && <button className="upload-modal__done" onClick={close}>Готово</button>}
          </section>
        </div>
      )}
    </>
  )
}
