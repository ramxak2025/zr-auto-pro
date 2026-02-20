package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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

	filename := uuid.New().String() + ext
	uploadDir := "uploads"
	os.MkdirAll(uploadDir, 0755)

	dst := filepath.Join(uploadDir, filename)
	if err := c.SaveUploadedFile(file, dst); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка сохранения файла"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url":          "/api/uploads/" + filename,
		"filename":     filename,
		"originalname": file.Filename,
		"size":         file.Size,
	})
}
