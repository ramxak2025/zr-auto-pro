package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetUsers(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	rows, err := database.Pool.Query(ctx, `
		SELECT id, phone, full_name, COALESCE(username,''), role, salary_percent, permissions, is_active, created_at
		FROM users WHERE tenant_id=$1 ORDER BY created_at DESC
	`, tenantID)
	if err != nil {
		serverError(c, "users list query", err)
		return
	}
	defer rows.Close()

	users := []models.User{}
	for rows.Next() {
		var u models.User
		var username string
		if err := rows.Scan(&u.ID, &u.Phone, &u.FullName, &username, &u.Role, &u.SalaryPercent, &u.Permissions, &u.IsActive, &u.CreatedAt); err != nil {
			serverError(c, "users row scan", err)
			return
		}
		if username != "" {
			u.Username = &username
		}
		users = append(users, u)
	}
	c.JSON(http.StatusOK, users)
}

func GetMasters(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	rows, err := database.Pool.Query(ctx, `
		SELECT id, phone, full_name, role, salary_percent, permissions, is_active, created_at
		FROM users WHERE tenant_id=$1 AND role IN ('master','admin') AND is_active=true ORDER BY full_name
	`, tenantID)
	if err != nil {
		serverError(c, "masters list query", err)
		return
	}
	defer rows.Close()

	users := []models.User{}
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Phone, &u.FullName, &u.Role, &u.SalaryPercent, &u.Permissions, &u.IsActive, &u.CreatedAt); err != nil {
			serverError(c, "masters row scan", err)
			return
		}
		users = append(users, u)
	}
	c.JSON(http.StatusOK, users)
}

func GetUser(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	var u models.User
	err := database.Pool.QueryRow(ctx, `
		SELECT id, phone, full_name, role, salary_percent, permissions, is_active, created_at
		FROM users WHERE id=$1 AND tenant_id=$2
	`, id, tenantID).Scan(&u.ID, &u.Phone, &u.FullName, &u.Role, &u.SalaryPercent, &u.Permissions, &u.IsActive, &u.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Пользователь не найден"})
		return
	}
	c.JSON(http.StatusOK, u)
}

func CreateUser(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	var body struct {
		Phone         string          `json:"phone"`
		Password      string          `json:"password"`
		FullName      string          `json:"fullName"`
		Role          string          `json:"role"`
		SalaryPercent float64         `json:"salaryPercent"`
		Permissions   json.RawMessage `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	phone := normalizePhone(body.Phone)
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 10)
	if err != nil {
		serverError(c, "create user password hash", err)
		return
	}
	perms := body.Permissions
	if perms == nil {
		perms = json.RawMessage(`{}`)
	}

	var u models.User
	err = database.Pool.QueryRow(ctx, `
		INSERT INTO users (phone, password, full_name, role, salary_percent, permissions, is_active, tenant_id)
		VALUES ($1,$2,$3,$4,$5,$6,true,$7)
		RETURNING id, phone, full_name, role, salary_percent, permissions, is_active, created_at
	`, phone, string(hash), body.FullName, body.Role, body.SalaryPercent, string(perms), tenantID).Scan(
		&u.ID, &u.Phone, &u.FullName, &u.Role, &u.SalaryPercent, &u.Permissions, &u.IsActive, &u.CreatedAt,
	)
	if err != nil {
		serverError(c, "create user insert", err)
		return
	}
	c.JSON(http.StatusCreated, u)
}

func UpdateUser(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if phone, ok := body["phone"].(string); ok {
		body["phone"] = normalizePhone(phone)
	}

	if pw, ok := body["password"].(string); ok && pw != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(pw), 10)
		if err != nil {
			serverError(c, "update user password hash", err)
			return
		}
		body["password"] = string(hash)
	} else {
		delete(body, "password")
	}

	// Build dynamic update
	setClauses := ""
	args := []interface{}{}
	i := 1
	fieldMap := map[string]string{
		"phone": "phone", "fullName": "full_name", "role": "role",
		"salaryPercent": "salary_percent", "permissions": "permissions",
		"isActive": "is_active", "password": "password", "avatar": "avatar",
	}
	for jsonKey, dbCol := range fieldMap {
		if val, ok := body[jsonKey]; ok {
			if setClauses != "" {
				setClauses += ", "
			}
			if jsonKey == "permissions" {
				b, _ := json.Marshal(val)
				setClauses += dbCol + " = $" + itoa(i)
				args = append(args, string(b))
			} else {
				setClauses += dbCol + " = $" + itoa(i)
				args = append(args, val)
			}
			i++
		}
	}

	if setClauses == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Нечего обновлять"})
		return
	}

	setClauses += ", updated_at = now()"
	query := "UPDATE users SET " + setClauses + " WHERE id=$" + itoa(i) + " AND tenant_id=$" + itoa(i+1)
	args = append(args, id, tenantID)

	_, err := database.Pool.Exec(ctx, query, args...)
	if err != nil {
		serverError(c, "update user exec", err)
		return
	}

	// Return updated user
	var u models.User
	if err := database.Pool.QueryRow(ctx, `
		SELECT id, phone, full_name, avatar, role, salary_percent, permissions, is_active, created_at
		FROM users WHERE id=$1
	`, id).Scan(&u.ID, &u.Phone, &u.FullName, &u.Avatar, &u.Role, &u.SalaryPercent, &u.Permissions, &u.IsActive, &u.CreatedAt); err != nil {
		serverError(c, "update user re-read", err)
		return
	}

	c.JSON(http.StatusOK, u)
}

// UpdateMyAvatar allows any user to update their own avatar
func UpdateMyAvatar(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.GetString("userID")

	var body struct {
		Avatar string `json:"avatar"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	_, err := database.Pool.Exec(ctx, "UPDATE users SET avatar=$1, updated_at=now() WHERE id=$2", body.Avatar, userID)
	if err != nil {
		serverError(c, "update avatar", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"avatar": body.Avatar})
}

func DeleteUser(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	currentUserID := c.GetString("userID")

	// Нельзя удалить самого себя
	if id == currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нельзя удалить свой аккаунт"})
		return
	}

	var role string
	if err := database.Pool.QueryRow(ctx, "SELECT role FROM users WHERE id=$1 AND tenant_id=$2", id, tenantID).Scan(&role); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	if role == "superadmin" || role == "director" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нельзя удалить владельца"})
		return
	}

	tag, err := database.Pool.Exec(ctx, "DELETE FROM users WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "delete user", err)
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}

func itoa(i int) string {
	return strconv.Itoa(i)
}
