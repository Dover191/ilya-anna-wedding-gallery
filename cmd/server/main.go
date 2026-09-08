package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type server struct {
	minio       *minio.Client
	bucket      string
	prefix      string
	putExpiry   time.Duration
	getExpiry   time.Duration
	maxFileSize int64
	logger      *slog.Logger
}

type presignRequest struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Category    string `json:"category"`
	Size        int64  `json:"size"`
}

type photo struct {
	ID          string    `json:"id"`
	Category    string    `json:"category"`
	Alt         string    `json:"alt"`
	FileName    string    `json:"fileName"`
	ContentType string    `json:"contentType"`
	MediaType   string    `json:"mediaType"`
	Src         string    `json:"src"`
	DownloadURL string    `json:"downloadUrl"`
	UploadedAt  time.Time `json:"uploadedAt"`
}

type contextKey string

const requestIDKey contextKey = "request_id"

var unsafePart = regexp.MustCompile(`[^\p{L}\p{N}._-]+`)

func main() {
	_ = godotenv.Load()

	logger := newLogger()
	slog.SetDefault(logger)

	endpoint := requiredEnv("MINIO_ENDPOINT")
	accessKey := requiredEnv("MINIO_ACCESS_KEY")
	secretKey := requiredEnv("MINIO_SECRET_KEY")
	bucket := requiredEnv("MINIO_BUCKET")
	useSSL := envBool("MINIO_USE_SSL", true)

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
		Region: os.Getenv("MINIO_REGION"),
	})
	if err != nil {
		logger.Error("failed to create MinIO client", "error", err)
		os.Exit(1)
	}

	s := &server{
		minio:       client,
		bucket:      bucket,
		prefix:      strings.Trim(os.Getenv("MINIO_PREFIX"), "/"),
		putExpiry:   envDuration("PRESIGNED_PUT_TTL", 2*time.Hour),
		getExpiry:   envDuration("PRESIGNED_GET_TTL", time.Hour),
		maxFileSize: envInt64("MAX_FILE_SIZE", 1024*1024*1024),
		logger:      logger,
	}

	logger.Info("application configuration loaded",
		"minio_endpoint", endpoint,
		"minio_bucket", s.bucket,
		"minio_prefix", s.prefix,
		"minio_ssl", useSSL,
		"put_ttl", s.putExpiry,
		"get_ttl", s.getExpiry,
		"max_file_size_bytes", s.maxFileSize,
	)

	if err := s.checkBucket(context.Background()); err != nil {
		logger.Error("MinIO bucket check failed", "bucket", s.bucket, "error", err)
		os.Exit(1)
	}
	logger.Info("MinIO bucket is available", "bucket", s.bucket)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("POST /api/uploads/presign", s.presignUpload)
	mux.HandleFunc("GET /api/photos", s.listPhotos)
	mux.Handle("/", spaHandler("dist"))

	port := envString("PORT", "3000")
	addr := ":" + port
	logger.Info("server listening", "address", addr, "url", "http://localhost:"+port)

	if err := http.ListenAndServe(addr, logging(logger, recoverer(logger, mux))); err != nil {
		logger.Error("HTTP server stopped", "error", err)
		os.Exit(1)
	}
}

func newLogger() *slog.Logger {
	level := new(slog.LevelVar)
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL"))) {
	case "debug":
		level.Set(slog.LevelDebug)
	case "warn", "warning":
		level.Set(slog.LevelWarn)
	case "error":
		level.Set(slog.LevelError)
	default:
		level.Set(slog.LevelInfo)
	}

	opts := &slog.HandlerOptions{
		Level:     level,
		AddSource: envBool("LOG_ADD_SOURCE", false),
	}

	var handler slog.Handler
	if strings.EqualFold(strings.TrimSpace(os.Getenv("LOG_FORMAT")), "text") {
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}

	return slog.New(handler).With("service", "media-server")
}

func (s *server) checkBucket(ctx context.Context) error {
	exists, err := s.minio.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("check bucket existence: %w", err)
	}
	if !exists {
		return fmt.Errorf("bucket %q does not exist", s.bucket)
	}
	return nil
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	s.logger.DebugContext(r.Context(), "health check")
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) presignUpload(w http.ResponseWriter, r *http.Request) {
	logger := loggerFromRequest(s.logger, r)

	var input presignRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&input); err != nil {
		logger.Warn("invalid presign request body", "error", err)
		writeError(w, http.StatusBadRequest, "Некорректный запрос")
		return
	}

	input.FileName = strings.TrimSpace(input.FileName)
	input.Category = strings.TrimSpace(input.Category)
	input.ContentType = strings.ToLower(strings.TrimSpace(input.ContentType))

	logger.Info("presign upload requested",
		"file_name", input.FileName,
		"category", input.Category,
		"content_type", input.ContentType,
		"size_bytes", input.Size,
	)

	if input.FileName == "" || input.Category == "" || (!strings.HasPrefix(input.ContentType, "image/") && !strings.HasPrefix(input.ContentType, "video/")) {
		logger.Warn("presign upload validation failed", "reason", "invalid file name, category, or content type")
		writeError(w, http.StatusBadRequest, "Разрешены только фото и видео с выбранной категорией")
		return
	}
	if input.Size <= 0 || input.Size > s.maxFileSize {
		logger.Warn("presign upload validation failed",
			"reason", "invalid file size",
			"size_bytes", input.Size,
			"max_file_size_bytes", s.maxFileSize,
		)
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Размер файла должен быть не больше %s", displayFileSize(s.maxFileSize)))
		return
	}

	objectName := strings.Join(nonEmpty(
		s.prefix,
		safePart(input.Category, "other"),
		fmt.Sprintf("%d-%s-%s", time.Now().UnixMilli(), randomID(), safePart(input.FileName, "photo")),
	), "/")

	u, err := s.minio.PresignedPutObject(r.Context(), s.bucket, objectName, s.putExpiry)
	if err != nil {
		logger.Error("failed to create presigned PUT URL",
			"bucket", s.bucket,
			"object", objectName,
			"error", err,
		)
		writeError(w, http.StatusBadGateway, "Не удалось подготовить загрузку")
		return
	}

	logger.Info("presigned PUT URL created",
		"bucket", s.bucket,
		"object", objectName,
		"expires_in_seconds", int(s.putExpiry.Seconds()),
	)

	writeJSON(w, http.StatusOK, map[string]any{
		"uploadUrl": u.String(),
		"key":       objectName,
		"expiresIn": int(s.putExpiry.Seconds()),
	})
}

func (s *server) listPhotos(w http.ResponseWriter, r *http.Request) {
	logger := loggerFromRequest(s.logger, r)

	prefix := s.prefix
	if prefix != "" {
		prefix += "/"
	}

	logger.Info("listing media objects", "bucket", s.bucket, "prefix", prefix)

	photos := make([]photo, 0)
	for object := range s.minio.ListObjects(r.Context(), s.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if object.Err != nil {
			logger.Error("failed to list MinIO objects",
				"bucket", s.bucket,
				"prefix", prefix,
				"error", object.Err,
			)
			writeError(w, http.StatusBadGateway, "Не удалось получить фотографии")
			return
		}
		if object.Key == "" || strings.HasSuffix(object.Key, "/") {
			continue
		}

		relative := strings.TrimPrefix(object.Key, prefix)
		parts := strings.Split(relative, "/")
		category := "other"
		if len(parts) > 1 && parts[0] != "" {
			category = parts[0]
		}

		fileName := stripGeneratedPrefix(path.Base(object.Key))
		contentType := object.ContentType
		if contentType == "" {
			stat, statErr := s.minio.StatObject(r.Context(), s.bucket, object.Key, minio.StatObjectOptions{})
			if statErr != nil {
				logger.Warn("failed to read object metadata",
					"bucket", s.bucket,
					"object", object.Key,
					"error", statErr,
				)
			} else {
				contentType = stat.ContentType
			}
		}

		mediaType := "image"
		if strings.HasPrefix(strings.ToLower(contentType), "video/") || isVideoFile(fileName) {
			mediaType = "video"
		}

		viewURL, err := s.minio.PresignedGetObject(r.Context(), s.bucket, object.Key, s.getExpiry, nil)
		if err != nil {
			logger.Warn("failed to create presigned view URL",
				"bucket", s.bucket,
				"object", object.Key,
				"error", err,
			)
			continue
		}

		downloadParams := make(url.Values)
		downloadParams.Set("response-content-disposition", contentDisposition(fileName))
		downloadURL, err := s.minio.PresignedGetObject(r.Context(), s.bucket, object.Key, s.getExpiry, downloadParams)
		if err != nil {
			logger.Warn("failed to create presigned download URL",
				"bucket", s.bucket,
				"object", object.Key,
				"error", err,
			)
			continue
		}

		photos = append(photos, photo{
			ID:          object.Key,
			Category:    category,
			Alt:         fileName,
			FileName:    fileName,
			ContentType: contentType,
			MediaType:   mediaType,
			Src:         viewURL.String(),
			DownloadURL: downloadURL.String(),
			UploadedAt:  object.LastModified,
		})
	}

	sort.Slice(photos, func(i, j int) bool { return photos[i].UploadedAt.After(photos[j].UploadedAt) })
	logger.Info("media objects listed", "count", len(photos), "bucket", s.bucket, "prefix", prefix)
	writeJSON(w, http.StatusOK, map[string]any{"photos": photos})
}

func spaHandler(root string) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		requested := filepath.Join(root, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(requested); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}

		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	})
}

func isVideoFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".ogv":
		return true
	default:
		return false
	}
}

func safePart(value, fallback string) string {
	value = strings.TrimSpace(value)
	value = unsafePart.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-._")
	if value == "" {
		return fallback
	}

	chars := []rune(value)
	if len(chars) > 100 {
		value = string(chars[:100])
	}
	return value
}

func stripGeneratedPrefix(name string) string {
	parts := strings.SplitN(name, "-", 3)
	if len(parts) != 3 {
		return name
	}
	if _, err := strconv.ParseInt(parts[0], 10, 64); err != nil {
		return name
	}
	return parts[2]
}

func randomID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(b[:])
}

func contentDisposition(fileName string) string {
	clean := strings.ReplaceAll(fileName, "\"", "")
	return fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(clean))
}

func nonEmpty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("failed to write JSON response", "status", status, "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(data)
	w.bytes += n
	return n, err
}

func logging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := randomID()
		ctx := context.WithValue(r.Context(), requestIDKey, requestID)
		r = r.WithContext(ctx)

		w.Header().Set("X-Request-ID", requestID)
		wrapped := &statusWriter{ResponseWriter: w}

		next.ServeHTTP(wrapped, r)

		status := wrapped.status
		if status == 0 {
			status = http.StatusOK
		}

		attributes := []any{
			"request_id", requestID,
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"bytes", wrapped.bytes,
			"duration_ms", time.Since(started).Milliseconds(),
			"remote_addr", r.RemoteAddr,
			"user_agent", r.UserAgent(),
		}

		switch {
		case status >= 500:
			logger.ErrorContext(r.Context(), "HTTP request completed", attributes...)
		case status >= 400:
			logger.WarnContext(r.Context(), "HTTP request completed", attributes...)
		default:
			logger.InfoContext(r.Context(), "HTTP request completed", attributes...)
		}
	})
}

func recoverer(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				loggerFromRequest(logger, r).Error("panic recovered", "panic", recovered)
				writeError(w, http.StatusInternalServerError, "Внутренняя ошибка сервера")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func loggerFromRequest(logger *slog.Logger, r *http.Request) *slog.Logger {
	if requestID, ok := r.Context().Value(requestIDKey).(string); ok && requestID != "" {
		return logger.With("request_id", requestID)
	}
	return logger
}

func requiredEnv(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		slog.Error("required environment variable is missing", "name", name)
		os.Exit(1)
	}
	return value
}

func envString(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		slog.Error("invalid boolean environment variable", "name", name, "value", value, "error", err)
		os.Exit(1)
	}
	return parsed
}

func envInt64(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		slog.Error("invalid integer environment variable", "name", name, "value", value, "error", err)
		os.Exit(1)
	}
	return parsed
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		slog.Error("invalid duration environment variable", "name", name, "value", value, "error", err)
		os.Exit(1)
	}
	return parsed
}

func displayFileSize(size int64) string {
	const (
		megabyte = int64(1024 * 1024)
		gigabyte = int64(1024 * 1024 * 1024)
	)

	if size >= gigabyte && size%gigabyte == 0 {
		return fmt.Sprintf("%d ГБ", size/gigabyte)
	}
	return fmt.Sprintf("%d МБ", size/megabyte)
}
