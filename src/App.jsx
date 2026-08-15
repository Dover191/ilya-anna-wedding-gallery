import React, { useEffect, useState } from 'react'
import Hero from './components/Hero.jsx'
import Gallery from './components/Gallery.jsx'
import UploadButton from './components/UploadButton.jsx'
import { categories as defaultCategories } from './data.js'

const GUEST_NAME_KEY = 'wedding-gallery:guest-name'

const readStoredName = () => {
  try { return localStorage.getItem(GUEST_NAME_KEY) || '' } catch { return '' }
}

export default function App() {
  const storedName = readStoredName()
  const [name, setName] = useState(storedName)
  const [guestName, setGuestName] = useState(storedName)
  const [galleryVersion, setGalleryVersion] = useState(0)
  const [galleryCategories, setGalleryCategories] = useState(defaultCategories)

  const hasGuestName = Boolean(guestName.trim())

  useEffect(() => {
    if (hasGuestName) return undefined
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [hasGuestName])

  const enterGallery = () => {
    const normalizedName = name.trim()
    if (!normalizedName) return false

    try { localStorage.setItem(GUEST_NAME_KEY, normalizedName) } catch { /* storage can be unavailable */ }
    setName(normalizedName)
    setGuestName(normalizedName)
    requestAnimationFrame(() => document.querySelector('#gallery')?.scrollIntoView({ behavior: 'smooth' }))
    return true
  }

  return (
    <>
      <Hero name={name} setName={setName} onEnter={enterGallery} canScroll={hasGuestName} />
      <Gallery guestName={guestName} refreshKey={galleryVersion} onCategoriesChange={setGalleryCategories} />
      <UploadButton categories={galleryCategories} onUploaded={() => setGalleryVersion((value) => value + 1)} />
    </>
  )
}
