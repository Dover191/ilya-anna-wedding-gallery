import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { categories as defaultCategories } from '../data.js'
import { getMedia } from '../api.js'

const LIKES_KEY = 'wedding-gallery:likes'
const COLLAPSED_CATEGORY_COUNT = 5

const mediaLabel = (item) => item.mediaType === 'video' ? 'видео' : 'фото'

const readStoredLikes = () => {
  try {
    const value = JSON.parse(localStorage.getItem(LIKES_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export default function Gallery({ guestName, refreshKey, onCategoriesChange }) {
  const [activeCategory, setActiveCategory] = useState('all')
  const [categoriesExpanded, setCategoriesExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [liked, setLiked] = useState(readStoredLikes)
  const [media, setMedia] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadMedia = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getMedia()
      setMedia(result.photos || result.media || [])
    } catch (loadError) {
      setError(loadError.message || 'Не удалось загрузить галерею')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMedia() }, [loadMedia, refreshKey])

  useEffect(() => {
    try { localStorage.setItem(LIKES_KEY, JSON.stringify(liked)) } catch { /* storage can be unavailable */ }
  }, [liked])

  const uploadCategories = useMemo(() => {
    const known = new Map(defaultCategories.map((item) => [item.id, item]))
    media.forEach((item) => {
      if (item.category && !known.has(item.category)) known.set(item.category, { id: item.category, label: item.category })
    })
    return Array.from(known.values())
  }, [media])

  useEffect(() => { onCategoriesChange?.(uploadCategories) }, [onCategoriesChange, uploadCategories])

  const categories = useMemo(() => {
    const allCategory = uploadCategories.find((item) => item.id === 'all') || { id: 'all', label: 'Все медиа' }
    return [
      allCategory,
      { id: 'favorites', label: 'Любимые', isFavorites: true },
      ...uploadCategories.filter((item) => item.id !== 'all'),
    ]
  }, [uploadCategories])

  const visibleCategories = useMemo(() => {
    if (categoriesExpanded || categories.length <= COLLAPSED_CATEGORY_COUNT) return categories
    const first = categories.slice(0, COLLAPSED_CATEGORY_COUNT)
    const active = categories.find((item) => item.id === activeCategory)
    if (active && !first.some((item) => item.id === active.id)) return [...first.slice(0, -1), active]
    return first
  }, [activeCategory, categories, categoriesExpanded])

  const visibleMedia = useMemo(() => {
    if (activeCategory === 'all') return media
    if (activeCategory === 'favorites') return media.filter((item) => liked.includes(item.id))
    return media.filter((item) => item.category === activeCategory)
  }, [activeCategory, liked, media])

  const selectedIndex = visibleMedia.findIndex((item) => item.id === selectedId)
  const selected = selectedIndex >= 0 ? visibleMedia[selectedIndex] : null

  const closeLightbox = useCallback(() => setSelectedId(null), [])
  const showPrevious = useCallback(() => {
    if (!visibleMedia.length || selectedIndex < 0) return
    setSelectedId(visibleMedia[(selectedIndex - 1 + visibleMedia.length) % visibleMedia.length].id)
  }, [selectedIndex, visibleMedia])
  const showNext = useCallback(() => {
    if (!visibleMedia.length || selectedIndex < 0) return
    setSelectedId(visibleMedia[(selectedIndex + 1) % visibleMedia.length].id)
  }, [selectedIndex, visibleMedia])

  useEffect(() => {
    if (!selected) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeLightbox()
      if (event.key === 'ArrowLeft') { event.preventDefault(); showPrevious() }
      if (event.key === 'ArrowRight') { event.preventDefault(); showNext() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, closeLightbox, showPrevious, showNext])

  useEffect(() => {
    if (!selected) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [selected])

  const toggleLike = (id) => {
    setLiked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const download = (item) => {
    const anchor = document.createElement('a')
    anchor.href = item.downloadUrl || item.src
    anchor.download = item.fileName || `wedding-${mediaLabel(item)}`
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const hasHiddenCategories = categories.length > COLLAPSED_CATEGORY_COUNT

  return (
    <main className="gallery" id="gallery">
      <div className="gallery__intro">
        <p className="eyebrow">{guestName ? `Добро пожаловать, ${guestName}` : 'Добро пожаловать'}</p>
        <h2>Фото и видео нашего дня</h2>
        <p>Здесь появляются загруженные гостями и фотографом материалы. Откройте любой файл для полноэкранного просмотра.</p>
      </div>

      <nav className="categories" aria-label="Категории медиа">
        {visibleCategories.map((category) => (
          <button key={category.id} className={activeCategory === category.id ? 'is-active' : ''} onClick={() => setActiveCategory(category.id)}>
            {category.isFavorites ? '♥ ' : ''}{category.label}
          </button>
        ))}
        {hasHiddenCategories && (
          <button
            className="categories__more"
            onClick={() => setCategoriesExpanded((value) => !value)}
            aria-expanded={categoriesExpanded}
            aria-label={categoriesExpanded ? 'Свернуть категории' : 'Показать все категории'}
          >
            {categoriesExpanded ? 'Свернуть' : '…'}
          </button>
        )}
      </nav>

      {loading && <div className="gallery-state" aria-live="polite">Загружаем медиа…</div>}
      {!loading && error && <div className="gallery-state gallery-state--error"><p>{error}</p><button onClick={loadMedia}>Повторить</button></div>}
      {!loading && !error && !visibleMedia.length && (
        <div className="gallery-state"><p>{activeCategory === 'favorites' ? 'Вы ещё ничего не добавили в любимые.' : 'В этой категории пока нет фото или видео.'}</p><span>{activeCategory === 'favorites' ? 'Нажмите на сердечко у понравившегося кадра.' : 'Нажмите «＋», чтобы загрузить первые материалы.'}</span></div>
      )}

      {!loading && !error && visibleMedia.length > 0 && (
        <section className="photo-grid">
          {visibleMedia.map((item, index) => (
            <article className={`photo-card photo-card--${(index % 5) + 1}`} key={item.id}>
              <button className="photo-card__image" onClick={() => setSelectedId(item.id)} aria-label={`Открыть ${mediaLabel(item)}: ${item.alt}`}>
                {item.mediaType === 'video' ? (
                  <><video src={item.src} muted playsInline preload="metadata" /><span className="photo-card__play" aria-hidden="true">▶</span></>
                ) : <img src={item.src} alt={item.alt} loading="lazy" />}
              </button>
              <div className="photo-card__actions">
                <button className={liked.includes(item.id) ? 'is-liked' : ''} onClick={() => toggleLike(item.id)} aria-label={liked.includes(item.id) ? 'Убрать из любимых' : 'Добавить в любимые'} aria-pressed={liked.includes(item.id)}>
                  <span aria-hidden="true">{liked.includes(item.id) ? '♥' : '♡'}</span>
                </button>
                <button onClick={() => download(item)} aria-label={`Скачать ${mediaLabel(item)}`}><span aria-hidden="true">↓</span></button>
              </div>
            </article>
          ))}
        </section>
      )}

      {selected && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={selected.alt} onClick={closeLightbox}>
          <button className="lightbox__close" onClick={closeLightbox} aria-label="Закрыть"><span aria-hidden="true">×</span></button>
          {visibleMedia.length > 1 && <button className="lightbox__nav lightbox__nav--prev" onClick={(event) => { event.stopPropagation(); showPrevious() }} aria-label="Предыдущее медиа">‹</button>}
          <div className="lightbox__content" onClick={(event) => event.stopPropagation()}>
            {selected.mediaType === 'video'
              ? <video key={selected.id} src={selected.src} controls autoPlay playsInline />
              : <img src={selected.src} alt={selected.alt} />}
          </div>
          {visibleMedia.length > 1 && <button className="lightbox__nav lightbox__nav--next" onClick={(event) => { event.stopPropagation(); showNext() }} aria-label="Следующее медиа">›</button>}
          <button className="lightbox__download" onClick={(event) => { event.stopPropagation(); download(selected) }}><span aria-hidden="true">↓</span> Скачать {mediaLabel(selected)}</button>
        </div>
      )}
    </main>
  )
}
