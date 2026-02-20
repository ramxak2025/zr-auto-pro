package handlers

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"zr-auto-pro/internal/imaging"
)

var allowedImageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true,
	".webp": true, ".gif": true, ".heic": true, ".heif": true,
}

func UploadFile(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Файл не найден"})
		return
	}

	if file.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Файл слишком большой (макс 10МБ)"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !allowedImageExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неподдерживаемый формат. Используйте JPG, PNG, WebP"})
		return
	}

	baseName := uuid.New().String()
	uploadDir := "uploads"
	os.MkdirAll(uploadDir, 0755)

	// Save original temporarily for processing
	tmpPath := filepath.Join(uploadDir, baseName+"_orig"+ext)
	if err := c.SaveUploadedFile(file, tmpPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка сохранения файла"})
		return
	}

	// Process: convert to WebP + generate thumbnail
	result, err := imaging.Process(tmpPath, uploadDir, baseName)
	if err != nil {
		log.Printf("Image processing failed, serving original: %v", err)
		// Fallback: rename original and serve as-is
		fallbackName := baseName + ext
		fallbackPath := filepath.Join(uploadDir, fallbackName)
		os.Rename(tmpPath, fallbackPath)
		c.JSON(http.StatusOK, gin.H{
			"url":          "/api/uploads/" + fallbackName,
			"thumbnail":    "/api/uploads/" + fallbackName,
			"filename":     fallbackName,
			"originalname": file.Filename,
			"size":         file.Size,
		})
		return
	}

	// Remove temp original
	os.Remove(tmpPath)

	c.JSON(http.StatusOK, gin.H{
		"url":          "/api/uploads/" + result.Optimized,
		"thumbnail":    "/api/uploads/" + result.Thumbnail,
		"filename":     result.Optimized,
		"originalname": file.Filename,
		"size":         file.Size,
	})
}
