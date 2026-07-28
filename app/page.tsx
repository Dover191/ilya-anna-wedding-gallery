"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

type MediaItem = {
  key: string;
  name: string;
  url: string;
  downloadUrl: string;
  type: "image" | "video";
  size: number;
  lastModified: string;
};

type SelectedFile = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: "ready" | "uploading" | "done" | "error";
};

type SignedUpload = {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadUrl: string;
  publicUrl: string;
};

const MAX_FILES = 10;
const MAX_CLIENT_UPLOAD_MB = 300;

export default function Home() {
  const [screen, setScreen] = useState<"home" | "upload">("home");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [galleryStatus, setGalleryStatus] = useState("Загружаем галерею...");
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrls = useRef<string[]>([]);

  const loadGallery = useCallback(async () => {
    try {
      const response = await fetch("/api/media", { cache: "no-store" });
      const data = (await response.json()) as {
        configured?: boolean;
        items?: MediaItem[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(data.message || "Gallery request failed.");
      }

      setItems(data.items || []);
      if (data.configured === false) {
        setGalleryStatus("Хранилище ещё не подключено.");
      } else if ((data.items || []).length === 0) {
        setGalleryStatus("Пока здесь нет фото и видео. Станьте первыми.");
      } else {
        setGalleryStatus("");
      }
    } catch {
      setGalleryStatus("Галерею не удалось загрузить. Попробуйте обновить страницу.");
    }
  }, []);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  useEffect(() => {
    return () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (activeIndex === null) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveIndex(null);
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const activeItem = activeIndex === null ? null : items[activeIndex];

  function openUpload() {
    setNotice("");
    setScreen("upload");
  }

  function closeUpload() {
    if (isUploading) return;
    setScreen("home");
  }

  function chooseFiles() {
    fileInputRef.current?.click();
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (picked.length === 0) return;

    const availableSlots = Math.max(MAX_FILES - selected.length, 0);
    const accepted = picked.slice(0, availableSlots).filter((file) => {
      const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");
      const isSmallEnough = file.size <= MAX_CLIENT_UPLOAD_MB * 1024 * 1024;
      return isMedia && isSmallEnough;
    });

    if (accepted.length < picked.length) {
      setNotice(
        `Добавлено ${accepted.length} из ${picked.length}: максимум ${MAX_FILES} файлов, только фото/видео до ${MAX_CLIENT_UPLOAD_MB} МБ.`,
      );
    } else {
      setNotice("");
    }

    const nextFiles = accepted.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.push(previewUrl);
      return {
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        previewUrl,
        progress: 0,
        status: "ready" as const,
      };
    });

    setSelected((current) => [...current, ...nextFiles].slice(0, MAX_FILES));
  }

  function removeSelected(id: string) {
    if (isUploading) return;
    setSelected((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadSelected() {
    if (selected.length === 0 || isUploading) return;

    const batch = [...selected];
    setIsUploading(true);
    setNotice("");

    try {
      const response = await fetch("/api/upload/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: batch.map(({ file }) => ({
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        }),
      });
      const data = (await response.json()) as {
        files?: SignedUpload[];
        message?: string;
      };

      if (!response.ok || !data.files) {
        throw new Error(data.message || "Не удалось подготовить загрузку.");
      }

      await Promise.all(
        batch.map((item, index) => uploadOne(item, data.files![index])),
      );

      batch.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setSelected([]);
      setScreen("home");
      setNotice("Файлы загружены. Спасибо!");
      window.setTimeout(loadGallery, 500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Загрузка не удалась.");
    } finally {
      setIsUploading(false);
    }
  }

  function uploadOne(item: SelectedFile, signed: SignedUpload) {
    setSelectedStatus(item.id, "uploading", 1);

    return new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("PUT", signed.uploadUrl);
      request.setRequestHeader("Content-Type", signed.type);

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const progress = Math.max(1, Math.round((event.loaded / event.total) * 100));
        setSelectedStatus(item.id, "uploading", progress);
      };

      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          setSelectedStatus(item.id, "done", 100);
          resolve();
        } else {
          setSelectedStatus(item.id, "error", 0);
          reject(new Error(`Не удалось загрузить ${item.file.name}.`));
        }
      };

      request.onerror = () => {
        setSelectedStatus(item.id, "error", 0);
        reject(new Error(`Не удалось загрузить ${item.file.name}.`));
      };

      request.send(item.file);
    });
  }

  function setSelectedStatus(
    id: string,
    status: SelectedFile["status"],
    progress: number,
  ) {
    setSelected((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status, progress } : item,
      ),
    );
  }

  function showPrevious() {
    if (items.length === 0) return;
    setActiveIndex((current) =>
      current === null ? 0 : (current - 1 + items.length) % items.length,
    );
  }

  function showNext() {
    if (items.length === 0) return;
    setActiveIndex((current) =>
      current === null ? 0 : (current + 1) % items.length,
    );
  }

  async function shareActive() {
    if (!activeItem) return;
    const shareData = {
      title: "Ilya & Anna",
      text: "Фото и видео со свадьбы Ilya & Anna",
      url: activeItem.url,
    };

    if (navigator.share) {
      await navigator.share(shareData).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(activeItem.url);
      setNotice("Ссылка скопирована.");
    }
  }

  return (
    <main className="app-shell">
      {screen === "home" ? (
        <>
          <section className="hero-screen" aria-label="Ilya and Anna">
            <img className="hero-photo" src="/hero.png" alt="" />
            <div className="hero-fade" />
            <div className="hero-content">
              <h1>Ilya &amp; Anna</h1>
              <p className="date">06.09.26</p>
              <p className="intro">Все фото и видео гостей - в одном месте</p>
              <button className="primary-button" type="button" onClick={openUpload}>
                <UploadIcon />
                Загрузить фото/видео
              </button>
            </div>
            <button className="gallery-jump" type="button" onClick={() => document.getElementById("gallery")?.scrollIntoView({ behavior: "smooth" })}>
              <span>Галерея</span>
              <ChevronDownIcon />
            </button>
          </section>

          <section className="gallery-section" id="gallery" aria-label="Галерея">
            <div className="section-heading">
              <div>
                <h2>Галерея</h2>
                <p>Моменты гостей появляются здесь сразу после загрузки.</p>
              </div>
              <button className="round-button" type="button" onClick={loadGallery} aria-label="Обновить галерею">
                <RefreshIcon />
              </button>
            </div>

            {notice ? <p className="notice">{notice}</p> : null}

            {items.length > 0 ? (
              <div className="media-grid">
                {items.map((item, index) => (
                  <button
                    className="media-tile"
                    key={item.key}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Открыть ${item.name}`}
                  >
                    {item.type === "image" ? (
                      <img src={item.url} alt="" loading="lazy" />
                    ) : (
                      <>
                        <video src={item.url} muted playsInline preload="metadata" />
                        <span className="play-mark">
                          <PlayIcon />
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-gallery">
                <SparkIcon />
                <p>{galleryStatus}</p>
                <button className="secondary-button" type="button" onClick={openUpload}>
                  Добавить первые файлы
                </button>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="upload-screen" aria-label="Добавить фото и видео">
          <button className="back-button" type="button" onClick={closeUpload} aria-label="Назад">
            <ArrowLeftIcon />
          </button>

          <div className="upload-copy">
            <h1>Добавить фото/видео</h1>
            <p>Загрузите до 10 файлов за раз. Поддерживаются фото и видео.</p>
          </div>

          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleFiles}
          />

          <button className="drop-zone" type="button" onClick={chooseFiles}>
            <span className="plus-circle">
              <PlusIcon />
            </span>
            <strong>Выбрать файлы</strong>
            <span>Фото и видео</span>
          </button>

          <div className="selected-header">
            <span>Выбрано {selected.length} из {MAX_FILES}</span>
            {selected.length > 0 && !isUploading ? (
              <button
                type="button"
                onClick={() => {
                  selected.forEach((item) => URL.revokeObjectURL(item.previewUrl));
                  setSelected([]);
                }}
              >
                Очистить
              </button>
            ) : null}
          </div>

          {selected.length > 0 ? (
            <div className="selected-list">
              {selected.map((item) => (
                <div className="selected-row" key={item.id}>
                  {item.file.type.startsWith("image/") ? (
                    <img src={item.previewUrl} alt="" />
                  ) : (
                    <video src={item.previewUrl} muted playsInline preload="metadata" />
                  )}
                  <div className="selected-meta">
                    <strong>{item.file.name}</strong>
                    <span>{formatBytes(item.file.size)}</span>
                    <div className="progress-track">
                      <span style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                  <button
                    className="remove-button"
                    type="button"
                    onClick={() => removeSelected(item.id)}
                    aria-label={`Убрать ${item.file.name}`}
                    disabled={isUploading}
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {notice ? <p className="notice upload-notice">{notice}</p> : null}

          <button
            className="primary-button upload-submit"
            type="button"
            onClick={uploadSelected}
            disabled={selected.length === 0 || isUploading}
          >
            <UploadIcon />
            {isUploading
              ? "Загружаем..."
              : selected.length > 0
                ? `Загрузить ${selected.length} ${pluralFiles(selected.length)}`
                : "Загрузить файлы"}
          </button>

          <p className="fine-print">
            После загрузки файлы появятся в общей галерее для гостей.
          </p>
        </section>
      )}

      {activeItem ? (
        <div className="viewer" role="dialog" aria-modal="true" aria-label="Просмотр медиа">
          <button className="viewer-close" type="button" onClick={() => setActiveIndex(null)} aria-label="Закрыть">
            <XIcon />
          </button>
          <button className="viewer-nav viewer-prev" type="button" onClick={showPrevious} aria-label="Предыдущий файл">
            <ChevronLeftIcon />
          </button>
          <div className="viewer-media">
            {activeItem.type === "image" ? (
              <img src={activeItem.url} alt="" />
            ) : (
              <video src={activeItem.url} controls playsInline autoPlay />
            )}
          </div>
          <button className="viewer-nav viewer-next" type="button" onClick={showNext} aria-label="Следующий файл">
            <ChevronRightIcon />
          </button>
          <div className="viewer-bar">
            <div>
              <strong>Ilya &amp; Anna</strong>
              <span>Фото гостей</span>
            </div>
            <a className="viewer-action" href={activeItem.downloadUrl} aria-label="Скачать файл">
              <DownloadIcon />
            </a>
            <button className="viewer-action" type="button" onClick={shareActive} aria-label="Поделиться">
              <ShareIcon />
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function pluralFiles(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return "файл";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) {
    return "файла";
  }
  return "файлов";
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0 5 5m-5-5-5 5" />
      <path d="M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v12m0 0 5-5m-5 5-5-5" />
      <path d="M20 20H4" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.7 6.8-4.4m-6.8 7 6.8 4.4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v6h-6" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v5m0 10v5M4.93 4.93l3.54 3.54m7.06 7.06 3.54 3.54M2 12h5m10 0h5M4.93 19.07l3.54-3.54m7.06-7.06 3.54-3.54" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 9 6-9 6V6Z" />
    </svg>
  );
}
