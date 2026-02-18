package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"zr-auto-pro/internal/database"
)

func JWTAuth() gin.HandlerFunc {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "change-me-in-production"
	}

	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Нет токена авторизации"})
			c.Abort()
			return
		}

		tokenStr := strings.TrimPrefix(auth, "Bearer ")
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Неверный токен"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Неверный токен"})
			c.Abort()
			return
		}

		userID, _ := claims["sub"].(string)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Неверный токен"})
			c.Abort()
			return
		}

		// Check user exists and is active
		var isActive bool
		var tenantID, role string
		err = database.DB.QueryRow(
			"SELECT is_active, COALESCE(tenant_id::text, ''), role FROM users WHERE id=$1",
			userID,
		).Scan(&isActive, &tenantID, &role)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Пользователь не найден"})
			c.Abort()
			return
		}
		if !isActive {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Аккаунт деактивирован"})
			c.Abort()
			return
		}

		c.Set("userID", userID)
		c.Set("tenantID", tenantID)
		c.Set("role", role)
		c.Next()
	}
}
