package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func getJWTSecret() string {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		return "change-me-in-production"
	}
	return s
}

func generateToken(userID string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(7 * 24 * time.Hour).Unix(),
		"iat": time.Now().Unix(),
	})
	return token.SignedString([]byte(getJWTSecret()))
}

func normalizePhone(phone string) string {
	// Strip all non-digit characters
	digits := ""
	for _, c := range phone {
		if c >= '0' && c <= '9' {
			digits += string(c)
		}
	}
	// Convert 8XXXXXXXXXX to 7XXXXXXXXXX
	if len(digits) == 11 && digits[0] == '8' {
		digits = "7" + digits[1:]
	}
	// Ensure starts with +
	if len(digits) > 0 {
		return "+" + digits
	}
	return phone
}

func Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	phone := normalizePhone(req.Phone)

	var user models.User
	var tenantJSON sql.NullString
	var password string

	// Search by normalized phone OR raw phone (backward compat with old formatted entries)
	err := database.DB.QueryRow(`
		SELECT u.id, u.phone, u.password, u.full_name, u.role,
			   COALESCE(u.salary_percent, 0),
			   COALESCE(u.permissions, '{}'),
			   u.is_active, u.tenant_id, u.created_at,
			   CASE WHEN t.id IS NOT NULL THEN
				   json_build_object('id',t.id,'name',t.name,'slug',COALESCE(t.slug,''),
					   'phone',COALESCE(t.phone,''),'address',COALESCE(t.address,''),
					   'email',COALESCE(t.email,''),'isActive',t.is_active,
					   'maxUsers',t.max_users,'createdAt',t.created_at,'updatedAt',t.updated_at)::text
			   ELSE NULL END
		FROM users u
		LEFT JOIN tenants t ON t.id = u.tenant_id
		WHERE u.phone = $1 OR u.phone = $2
		LIMIT 1
	`, phone, req.Phone).Scan(
		&user.ID, &user.Phone, &password, &user.FullName, &user.Role,
		&user.SalaryPercent, &user.Permissions, &user.IsActive,
		&user.TenantID, &user.CreatedAt, &tenantJSON,
	)

	if err != nil {
		log.Printf("Login query error for phone=%q normalized=%q: %v", req.Phone, phone, err)
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Неверный телефон или пароль"})
		return
	}

	if !user.IsActive {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Аккаунт деактивирован"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Неверный телефон или пароль"})
		return
	}

	token, err := generateToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка генерации токена"})
		return
	}

	if tenantJSON.Valid {
		var tenant models.Tenant
		json.Unmarshal([]byte(tenantJSON.String), &tenant)
		user.Tenant = &tenant
	}

	c.JSON(http.StatusOK, models.LoginResponse{Token: token, User: user})
}

func Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	phone := normalizePhone(req.Phone)

	var exists bool
	database.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1)", phone).Scan(&exists)
	if exists {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Пользователь с таким телефоном уже существует"})
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), 10)

	tenantName := req.TenantName
	if tenantName == "" {
		tenantName = "Мой автосервис"
	}

	tx, _ := database.DB.Begin()

	var tenantID string
	err := tx.QueryRow(`
		INSERT INTO tenants (name, is_active, max_users) VALUES ($1, true, 10) RETURNING id
	`, tenantName).Scan(&tenantID)
	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка создания организации"})
		return
	}

	allPerms := `{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}`

	var user models.User
	err = tx.QueryRow(`
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions)
		VALUES ($1, $2, $3, 'director', true, $4, $5)
		RETURNING id, phone, full_name, role, salary_percent, permissions, is_active, tenant_id, created_at
	`, phone, string(hash), req.FullName, tenantID, allPerms).Scan(
		&user.ID, &user.Phone, &user.FullName, &user.Role,
		&user.SalaryPercent, &user.Permissions, &user.IsActive,
		&user.TenantID, &user.CreatedAt,
	)
	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка создания пользователя"})
		return
	}

	tx.Commit()

	token, _ := generateToken(user.ID)

	c.JSON(http.StatusOK, models.LoginResponse{Token: token, User: user})
}

func Me(c *gin.Context) {
	userID := c.GetString("userID")

	var user models.User
	var tenantJSON sql.NullString

	err := database.DB.QueryRow(`
		SELECT u.id, u.phone, u.full_name, u.role,
			   COALESCE(u.salary_percent, 0),
			   COALESCE(u.permissions, '{}'),
			   u.is_active, u.tenant_id, u.created_at,
			   CASE WHEN t.id IS NOT NULL THEN
				   json_build_object('id',t.id,'name',t.name,'slug',COALESCE(t.slug,''),
					   'phone',COALESCE(t.phone,''),'address',COALESCE(t.address,''),
					   'email',COALESCE(t.email,''),'isActive',t.is_active,
					   'maxUsers',t.max_users,'createdAt',t.created_at,'updatedAt',t.updated_at)::text
			   ELSE NULL END
		FROM users u
		LEFT JOIN tenants t ON t.id = u.tenant_id
		WHERE u.id = $1
	`, userID).Scan(
		&user.ID, &user.Phone, &user.FullName, &user.Role,
		&user.SalaryPercent, &user.Permissions, &user.IsActive,
		&user.TenantID, &user.CreatedAt, &tenantJSON,
	)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Пользователь не найден"})
		return
	}

	if tenantJSON.Valid {
		var tenant models.Tenant
		json.Unmarshal([]byte(tenantJSON.String), &tenant)
		user.Tenant = &tenant
	}

	c.JSON(http.StatusOK, user)
}
