const API_BASE = import.meta.env.VITE_API_URL || ''
export const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024

const CONTENT_TYPES_BY_EXTENSION = {
  avi: 'video/x-msvideo',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  ogv: 'video/ogg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webm: 'video/webm',
  webp: 'image/webp',
}

export function getMediaContentType(file) {
  const browserType = file.type?.toLowerCase()
  if (browserType?.startsWith('image/') || browserType?.startsWith('video/')) return browserType

  const extension = file.name.split('.').pop()?.toLowerCase()
  return CONTENT_TYPES_BY_EXTENSION[extension] || ''
}

export const isSupportedMedia = (file) => Boolean(getMediaContentType(file))

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'Ошибка соединения с хранилищем')
  }
  return response.json()
}

export const getMedia = () => request('/api/photos')
export const getPhotos = getMedia

export async function uploadMedia(file, category, onProgress) {
  const contentType = getMediaContentType(file)
  if (!contentType) throw new Error(`Файл ${file.name} не распознан как фото или видео`)
  if (file.size > MAX_UPLOAD_SIZE) throw new Error(`Файл ${file.name} больше 1 ГБ`)

  const { uploadUrl } = await request('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType, category, size: file.size }),
  })

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Хранилище отклонило файл ${file.name}. Нажмите «Повторить загрузку»`))
    })
    xhr.addEventListener('error', () => reject(new Error(`Загрузка ${file.name} прервалась. Проверьте интернет и повторите`)))
    xhr.addEventListener('abort', () => reject(new Error(`Загрузка ${file.name} была прервана`)))
    xhr.send(file)
  })
}

export const uploadPhoto = uploadMedia
