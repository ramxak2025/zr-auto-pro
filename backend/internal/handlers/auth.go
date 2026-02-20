package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
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
	digits := ""
	for _, c := range phone {
		if c >= '0' && c <= '9' {
			digits += string(c)
		}
	}
	if len(digits) == 11 && digits[0] == '8' {
		digits = "7" + digits[1:]
	}
	if len(digits) > 0 {
		return "+" + digits
	}
	return phone
}

// serverError logs and returns a generic 500 — never leaks internals
func serverError(c *gin.Context, msg string, err error) {
	log.Printf("ERROR [%s %s]: %s: %v", c.Request.Method, c.Request.URL.Path, msg, err)
	c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка сервера"})
}

func Login(c *gin.Context) {
	ctx := c.Request.Context()

	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	if req.Phone == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Телефон и пароль обязательны"})
		return
	}

	phone := normalizePhone(req.Phone)

	var user models.User
	var tenantJSON *string
	var password string

	err := database.Pool.QueryRow(ctx, `
		SELECT u.id, u.phone, u.password, u.full_name, u.avatar, u.role,
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
		&user.ID, &user.Phone, &password, &user.FullName, &user.Avatar, &user.Role,
		&user.SalaryPercent, &user.Permissions, &user.IsActive,
		&user.TenantID, &user.CreatedAt, &tenantJSON,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Неверный телефон или пароль"})
		} else {
			serverError(c, "login query", err)
		}
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
	log.Printf("Login OK for phone=%q role=%s", phone, user.Role)

	token, err := generateToken(user.ID)
	if err != nil {
		serverError(c, "token generation", err)
		return
	}

	if tenantJSON != nil {
		var tenant models.Tenant
		if unmarshalErr := json.Unmarshal([]byte(*tenantJSON), &tenant); unmarshalErr == nil {
			user.Tenant = &tenant
		}
	}

	c.JSON(http.StatusOK, models.LoginResponse{Token: token, User: user})
}

func Register(c *gin.Context) {
	ctx := c.Request.Context()

	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	if req.Phone == "" || req.Password == "" || req.FullName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Телефон, пароль и имя обязательны"})
		return
	}

	if len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Пароль должен быть не менее 6 символов"})
		return
	}

	phone := normalizePhone(req.Phone)

	var exists bool
	if err := database.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1)", phone).Scan(&exists); err != nil {
		serverError(c, "register exists check", err)
		return
	}
	if exists {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Пользователь с таким телефоном уже существует"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 10)
	if err != nil {
		serverError(c, "password hash", err)
		return
	}

	tenantName := req.TenantName
	if tenantName == "" {
		tenantName = "Мой автосервис"
	}

	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		serverError(c, "tx begin", err)
		return
	}
	defer tx.Rollback(ctx)

	var tenantID string
	if err := tx.QueryRow(ctx, `INSERT INTO tenants (name, is_active, max_users) VALUES ($1, true, 10) RETURNING id`, tenantName).Scan(&tenantID); err != nil {
		serverError(c, "tenant creation", err)
		return
	}

	allPerms := `{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}`

	var user models.User
	if err := tx.QueryRow(ctx, `
		INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions)
		VALUES ($1, $2, $3, 'director', true, $4, $5)
		RETURNING id, phone, full_name, role, salary_percent, permissions, is_active, tenant_id, created_at
	`, phone, string(hash), req.FullName, tenantID, allPerms).Scan(
		&user.ID, &user.Phone, &user.FullName, &user.Role,
		&user.SalaryPercent, &user.Permissions, &user.IsActive,
		&user.TenantID, &user.CreatedAt,
	); err != nil {
		serverError(c, "user creation", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		serverError(c, "tx commit", err)
		return
	}

	token, err := generateToken(user.ID)
	if err != nil {
		serverError(c, "token generation", err)
		return
	}

	c.JSON(http.StatusOK, models.LoginResponse{Token: token, User: user})
}

func Me(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.GetString("userID")

	var user models.User
	var tenantJSON *string

	err := database.Pool.QueryRow(ctx, `
		SELECT u.id, u.phone, u.full_name, u.avatar, u.role,
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
		&user.ID, &user.Phone, &user.FullName, &user.Avatar, &user.Role,
		&user.SalaryPercent, &user.Permissions, &user.IsActive,
		&user.TenantID, &user.CreatedAt, &tenantJSON,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Пользователь не найден"})
		} else {
			serverError(c, "me query", err)
		}
		return
	}

	if tenantJSON != nil {
		var tenant models.Tenant
		if unmarshalErr := json.Unmarshal([]byte(*tenantJSON), &tenant); unmarshalErr == nil {
			user.Tenant = &tenant
		}
	}

	c.JSON(http.StatusOK, user)
}
