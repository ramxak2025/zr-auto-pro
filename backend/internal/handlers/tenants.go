package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetTenants(c *gin.Context) {
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	rows, _ := database.DB.Query(`
		SELECT t.id, t.name, COALESCE(t.slug,''), COALESCE(t.phone,''), COALESCE(t.address,''),
			   COALESCE(t.email,''), t.is_active, t.max_users, t.subscription_end, t.subscription_note,
			   t.created_at, t.updated_at, COUNT(u.id)
		FROM tenants t LEFT JOIN users u ON u.tenant_id=t.id
		GROUP BY t.id ORDER BY t.created_at DESC
	`)

	tenants := []models.Tenant{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var t models.Tenant
			var slug, phone, address, email string
			var userCount int
			rows.Scan(&t.ID, &t.Name, &slug, &phone, &address, &email, &t.IsActive, &t.MaxUsers,
				&t.SubscriptionEnd, &t.SubscriptionNote, &t.CreatedAt, &t.UpdatedAt, &userCount)
			if slug != "" {
				t.Slug = &slug
			}
			if phone != "" {
				t.Phone = &phone
			}
			if address != "" {
				t.Address = &address
			}
			if email != "" {
				t.Email = &email
			}
			t.UserCount = &userCount
			tenants = append(tenants, t)
		}
	}
	c.JSON(http.StatusOK, tenants)
}

func GetTenantStats(c *gin.Context) {
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	var stats models.TenantStats
	database.DB.QueryRow("SELECT COUNT(*) FROM tenants").Scan(&stats.TotalTenants)
	database.DB.QueryRow("SELECT COUNT(*) FROM tenants WHERE is_active=true").Scan(&stats.ActiveTenants)
	database.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&stats.TotalUsers)
	c.JSON(http.StatusOK, stats)
}

func GetTenant(c *gin.Context) {
	id := c.Param("id")
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	var t models.Tenant
	var slug, phone, address, email string
	err := database.DB.QueryRow(`
		SELECT id, name, COALESCE(slug,''), COALESCE(phone,''), COALESCE(address,''),
			   COALESCE(email,''), is_active, max_users, subscription_end, subscription_note,
			   created_at, updated_at
		FROM tenants WHERE id=$1
	`, id).Scan(&t.ID, &t.Name, &slug, &phone, &address, &email, &t.IsActive, &t.MaxUsers,
		&t.SubscriptionEnd, &t.SubscriptionNote, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	if slug != "" {
		t.Slug = &slug
	}
	if phone != "" {
		t.Phone = &phone
	}
	if address != "" {
		t.Address = &address
	}
	if email != "" {
		t.Email = &email
	}

	// Load users
	uRows, _ := database.DB.Query("SELECT id, phone, full_name, role, is_active, created_at FROM users WHERE tenant_id=$1", id)
	t.Users = []models.User{}
	if uRows != nil {
		for uRows.Next() {
			var u models.User
			uRows.Scan(&u.ID, &u.Phone, &u.FullName, &u.Role, &u.IsActive, &u.CreatedAt)
			t.Users = append(t.Users, u)
		}
		uRows.Close()
	}
	uc := len(t.Users)
	t.UserCount = &uc

	c.JSON(http.StatusOK, t)
}

func CreateTenant(c *gin.Context) {
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	var body struct {
		Name     string  `json:"name"`
		Phone    *string `json:"phone"`
		Address  *string `json:"address"`
		Email    *string `json:"email"`
		MaxUsers int     `json:"maxUsers"`
	}
	c.ShouldBindJSON(&body)
	if body.MaxUsers == 0 {
		body.MaxUsers = 10
	}

	var t models.Tenant
	database.DB.QueryRow(`
		INSERT INTO tenants (name, phone, address, email, max_users, is_active)
		VALUES ($1,$2,$3,$4,$5,true) RETURNING id, name, is_active, max_users, created_at, updated_at
	`, body.Name, body.Phone, body.Address, body.Email, body.MaxUsers).Scan(
		&t.ID, &t.Name, &t.IsActive, &t.MaxUsers, &t.CreatedAt, &t.UpdatedAt,
	)
	c.JSON(http.StatusCreated, t)
}

func UpdateTenant(c *gin.Context) {
	id := c.Param("id")
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	var body struct {
		Name             *string `json:"name"`
		Phone            *string `json:"phone"`
		Address          *string `json:"address"`
		Email            *string `json:"email"`
		IsActive         *bool   `json:"isActive"`
		MaxUsers         *int    `json:"maxUsers"`
		SubscriptionEnd  *string `json:"subscriptionEnd"`
		SubscriptionNote *string `json:"subscriptionNote"`
	}
	c.ShouldBindJSON(&body)

	database.DB.Exec(`
		UPDATE tenants SET
			name=COALESCE($1,name), phone=COALESCE($2,phone), address=COALESCE($3,address),
			email=COALESCE($4,email), is_active=COALESCE($5,is_active), max_users=COALESCE($6,max_users),
			subscription_note=COALESCE($7,subscription_note), updated_at=now()
		WHERE id=$8
	`, body.Name, body.Phone, body.Address, body.Email, body.IsActive, body.MaxUsers, body.SubscriptionNote, id)

	if body.SubscriptionEnd != nil {
		database.DB.Exec("UPDATE tenants SET subscription_end=$1 WHERE id=$2", *body.SubscriptionEnd, id)
	}

	c.Params = gin.Params{{Key: "id", Value: id}}
	GetTenant(c)
}

func DeleteTenant(c *gin.Context) {
	id := c.Param("id")
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}
	database.DB.Exec("DELETE FROM tenants WHERE id=$1", id)
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}
