# Wedding gallery for Ilya and Anna

Свадебная галерея на React и Go. Гости открывают сайт по QR-коду, загружают фото и видео и просматривают материалы в общей галерее.

Файлы загружаются напрямую в Timeweb S3 по временным подписанным ссылкам. Ключи S3 используются только Go-сервером и не попадают в браузер.

## Локальный запуск

1. Скопируйте `.env.example` в `.env` и заполните ключи S3.
2. Соберите фронтенд и запустите сервер:

```bash
npm ci
npm run build
go run ./cmd/server
```

Сайт откроется на `http://localhost:3000`.

## Переменные окружения

```env
MINIO_ENDPOINT=s3.twcstorage.ru
MINIO_ACCESS_KEY=<Timeweb S3 Access Key>
MINIO_SECRET_KEY=<Timeweb S3 Secret Access Key>
MINIO_BUCKET=ilya-anna-wedding
MINIO_USE_SSL=true
MINIO_REGION=ru-1
MINIO_PREFIX=guest-media/2026-09-06
PORT=3000
PRESIGNED_PUT_TTL=15m
PRESIGNED_GET_TTL=1h
MAX_FILE_SIZE=314572800
```

`MINIO_ENDPOINT` указывается без `https://`. Значение `MAX_FILE_SIZE` задаётся в байтах, текущее ограничение равно 300 МБ на один файл.

## Деплой в Timeweb App Platform

1. Выберите `Docker` → `Dockerfile`.
2. Подключите репозиторий и ветку `main` или подготовленную ветку деплоя.
3. Оставьте путь к директории проекта пустым.
4. Не подключайте приватную сеть.
5. Добавьте переменные окружения из списка выше через панель Timeweb.
6. Укажите путь проверки состояния `/api/health`.
7. Запустите деплой.

После деплоя добавьте точный HTTPS-адрес приложения в `Allowed Origins` правила CORS бакета. Разрешите методы `GET`, `PUT`, `HEAD`, заголовки `Content-Type` и `x-amz-*`, а в `Expose Headers` укажите `ETag`.

## API

- `POST /api/uploads/presign` создаёт временную ссылку для загрузки файла.
- `GET /api/photos` возвращает медиа и временные ссылки просмотра и скачивания.
- `GET /api/health` используется для проверки состояния приложения.
