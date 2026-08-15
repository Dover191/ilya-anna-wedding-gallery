const API_BASE = import.meta.env.VITE_API_URL || ''

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
  const { uploadUrl } = await request('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, category, size: file.size }),
  })

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Не удалось загрузить ${file.name}`))
    })
    xhr.addEventListener('error', () => reject(new Error(`Не удалось загрузить ${file.name}`)))
    xhr.send(file)
  })
}

export const uploadPhoto = uploadMedia
