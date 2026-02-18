package handlers

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

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

	ext := filepath.Ext(file.Filename)
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
