package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
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
			   COALESCE(t.email,''), t.is_active, t.max_users,
			   COALESCE(t.plan_id::text,''), COALESCE(t.monthly_price,0),
			   t.subscription_end, t.subscription_note,
			   t.created_at, t.updated_at, COUNT(u.id)
		FROM tenants t LEFT JOIN users u ON u.tenant_id=t.id
		GROUP BY t.id ORDER BY t.created_at DESC
	`)

	tenants := []models.Tenant{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var t models.Tenant
			var slug, phone, address, email, planID string
			var userCount int
			rows.Scan(&t.ID, &t.Name, &slug, &phone, &address, &email, &t.IsActive, &t.MaxUsers,
				&planID, &t.MonthlyPrice,
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
			if planID != "" {
				t.PlanID = &planID
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
	database.DB.QueryRow("SELECT COUNT(*) FROM users WHERE tenant_id IS NOT NULL").Scan(&stats.TotalUsers)
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
	var slug, phone, address, email, planID string
	err := database.DB.QueryRow(`
		SELECT id, name, COALESCE(slug,''), COALESCE(phone,''), COALESCE(address,''),
			   COALESCE(email,''), is_active, max_users,
			   COALESCE(plan_id::text,''), COALESCE(monthly_price,0),
			   subscription_end, subscription_note,
			   created_at, updated_at
		FROM tenants WHERE id=$1
	`, id).Scan(&t.ID, &t.Name, &slug, &phone, &address, &email, &t.IsActive, &t.MaxUsers,
		&planID, &t.MonthlyPrice,
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
	if planID != "" {
		t.PlanID = &planID
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
		Name             string  `json:"name"`
		Phone            *string `json:"phone"`
		Address          *string `json:"address"`
		Email            *string `json:"email"`
		Description      *string `json:"description"`
		MaxUsers         int     `json:"maxUsers"`
		IsActive         *bool   `json:"isActive"`
		PlanID           *string `json:"planId"`
		MonthlyPrice     float64 `json:"monthlyPrice"`
		SubscriptionEnd  *string `json:"subscriptionEnd"`
		SubscriptionNote *string `json:"subscriptionNote"`
		DirectorName     string  `json:"directorName"`
		DirectorPhone    string  `json:"directorPhone"`
		DirectorPassword string  `json:"directorPassword"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}
	if body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Введите название организации"})
		return
	}
	if body.MaxUsers == 0 {
		body.MaxUsers = 10
	}

	tx, err := database.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка базы данных"})
		return
	}

	isActive := true
	if body.IsActive != nil {
		isActive = *body.IsActive
	}

	var tenantID string
	err = tx.QueryRow(`
		INSERT INTO tenants (name, phone, address, email, description, max_users, is_active, plan_id, monthly_price, subscription_end, subscription_note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
	`, body.Name, body.Phone, body.Address, body.Email, body.Description,
		body.MaxUsers, isActive, body.PlanID, body.MonthlyPrice,
		body.SubscriptionEnd, body.SubscriptionNote).Scan(&tenantID)
	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка создания организации: " + err.Error()})
		return
	}

	// Create director if phone provided
	if body.DirectorPhone != "" && body.DirectorPassword != "" {
		dirPhone := normalizePhone(body.DirectorPhone)
		dirName := body.DirectorName
		if dirName == "" {
			dirName = "Директор"
		}
		hash, _ := bcrypt.GenerateFromPassword([]byte(body.DirectorPassword), 10)
		allPerms := `{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true}`

		_, err = tx.Exec(`
			INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions, salary_percent)
			VALUES ($1, $2, $3, 'director', true, $4, $5, 0)
			ON CONFLICT (phone) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = 'director', is_active = true
		`, dirPhone, string(hash), dirName, tenantID, allPerms)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"message": "Ошибка создания директора: " + err.Error()})
			return
		}
	}

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Ошибка сохранения"})
		return
	}

	// Return full tenant
	c.Params = gin.Params{{Key: "id", Value: tenantID}}
	GetTenant(c)
}

func UpdateTenant(c *gin.Context) {
	id := c.Param("id")
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	var body struct {
		Name             *string  `json:"name"`
		Phone            *string  `json:"phone"`
		Address          *string  `json:"address"`
		Email            *string  `json:"email"`
		Description      *string  `json:"description"`
		IsActive         *bool    `json:"isActive"`
		MaxUsers         *int     `json:"maxUsers"`
		PlanID           *string  `json:"planId"`
		MonthlyPrice     *float64 `json:"monthlyPrice"`
		SubscriptionEnd  *string  `json:"subscriptionEnd"`
		SubscriptionNote *string  `json:"subscriptionNote"`
	}
	c.ShouldBindJSON(&body)

	database.DB.Exec(`
		UPDATE tenants SET
			name=COALESCE($1,name), phone=COALESCE($2,phone), address=COALESCE($3,address),
			email=COALESCE($4,email), description=COALESCE($5,description),
			is_active=COALESCE($6,is_active), max_users=COALESCE($7,max_users),
			subscription_note=COALESCE($8,subscription_note), updated_at=now()
		WHERE id=$9
	`, body.Name, body.Phone, body.Address, body.Email, body.Description,
		body.IsActive, body.MaxUsers, body.SubscriptionNote, id)

	if body.SubscriptionEnd != nil {
		if *body.SubscriptionEnd == "" {
			database.DB.Exec("UPDATE tenants SET subscription_end=NULL WHERE id=$1", id)
		} else {
			database.DB.Exec("UPDATE tenants SET subscription_end=$1 WHERE id=$2", *body.SubscriptionEnd, id)
		}
	}

	if body.PlanID != nil {
		if *body.PlanID == "" {
			database.DB.Exec("UPDATE tenants SET plan_id=NULL WHERE id=$1", id)
		} else {
			database.DB.Exec("UPDATE tenants SET plan_id=$1 WHERE id=$2", *body.PlanID, id)
		}
	}

	if body.MonthlyPrice != nil {
		database.DB.Exec("UPDATE tenants SET monthly_price=$1 WHERE id=$2", *body.MonthlyPrice, id)
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
	// Soft-delete: deactivate tenant instead of permanent deletion
	// This preserves all client data (users, checks, clients, cars, etc.)
	database.DB.Exec("UPDATE tenants SET is_active=false, updated_at=now() WHERE id=$1", id)
	c.JSON(http.StatusOK, gin.H{"message": "Организация деактивирована"})
}

// --- Subscription info (for tenant users) ---
func GetSubscription(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	if tenantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Нет организации"})
		return
	}

	type SubscriptionInfo struct {
		TenantName       string        `json:"tenantName"`
		PlanName         *string       `json:"planName"`
		MonthlyPrice     float64       `json:"monthlyPrice"`
		SubscriptionEnd  *string       `json:"subscriptionEnd"`
		SubscriptionNote *string       `json:"subscriptionNote"`
		MaxUsers         int           `json:"maxUsers"`
		CurrentUsers     int           `json:"currentUsers"`
		Plans            []models.Plan `json:"plans"`
	}

	var info SubscriptionInfo
	var planName, subEnd, subNote *string

	database.DB.QueryRow(`
		SELECT t.name, p.name, COALESCE(t.monthly_price,0), t.subscription_end::text, t.subscription_note, t.max_users
		FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
		WHERE t.id=$1
	`, tenantID).Scan(&info.TenantName, &planName, &info.MonthlyPrice, &subEnd, &subNote, &info.MaxUsers)

	info.PlanName = planName
	info.SubscriptionEnd = subEnd
	info.SubscriptionNote = subNote

	database.DB.QueryRow("SELECT COUNT(*) FROM users WHERE tenant_id=$1", tenantID).Scan(&info.CurrentUsers)

	// Available plans
	rows, _ := database.DB.Query("SELECT id, name, monthly_price, COALESCE(description,''), features, max_users, sort_order, created_at FROM plans WHERE is_active=true ORDER BY sort_order")
	info.Plans = []models.Plan{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var p models.Plan
			var desc string
			rows.Scan(&p.ID, &p.Name, &p.MonthlyPrice, &desc, &p.Features, &p.MaxUsers, &p.SortOrder, &p.CreatedAt)
			if desc != "" {
				p.Description = &desc
			}
			p.IsActive = true
			info.Plans = append(info.Plans, p)
		}
	}

	c.JSON(http.StatusOK, info)
}

// --- Plans CRUD (superadmin only) ---

func GetPlans(c *gin.Context) {
	rows, _ := database.DB.Query("SELECT id, name, monthly_price, COALESCE(description,''), features, max_users, is_active, sort_order, created_at FROM plans ORDER BY sort_order")
	plans := []models.Plan{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var p models.Plan
			var desc string
			rows.Scan(&p.ID, &p.Name, &p.MonthlyPrice, &desc, &p.Features, &p.MaxUsers, &p.IsActive, &p.SortOrder, &p.CreatedAt)
			if desc != "" {
				p.Description = &desc
			}
			plans = append(plans, p)
		}
	}
	c.JSON(http.StatusOK, plans)
}

func CreatePlan(c *gin.Context) {
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	var body struct {
		Name         string          `json:"name"`
		MonthlyPrice float64         `json:"monthlyPrice"`
		Description  *string         `json:"description"`
		Features     json.RawMessage `json:"features"`
		MaxUsers     int             `json:"maxUsers"`
		SortOrder    int             `json:"sortOrder"`
	}
	c.ShouldBindJSON(&body)
	if body.MaxUsers == 0 {
		body.MaxUsers = 5
	}
	if body.Features == nil {
		body.Features = json.RawMessage(`[]`)
	}

	var p models.Plan
	var desc string
	database.DB.QueryRow(`
		INSERT INTO plans (name, monthly_price, description, features, max_users, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, name, monthly_price, COALESCE(description,''), features, max_users, is_active, sort_order, created_at
	`, body.Name, body.MonthlyPrice, body.Description, string(body.Features), body.MaxUsers, body.SortOrder).Scan(
		&p.ID, &p.Name, &p.MonthlyPrice, &desc, &p.Features, &p.MaxUsers, &p.IsActive, &p.SortOrder, &p.CreatedAt)
	if desc != "" {
		p.Description = &desc
	}
	c.JSON(http.StatusCreated, p)
}

func UpdatePlan(c *gin.Context) {
	id := c.Param("id")
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}

	var body struct {
		Name         *string          `json:"name"`
		MonthlyPrice *float64         `json:"monthlyPrice"`
		Description  *string          `json:"description"`
		Features     *json.RawMessage `json:"features"`
		MaxUsers     *int             `json:"maxUsers"`
		IsActive     *bool            `json:"isActive"`
		SortOrder    *int             `json:"sortOrder"`
	}
	c.ShouldBindJSON(&body)

	database.DB.Exec(`
		UPDATE plans SET
			name=COALESCE($1,name), monthly_price=COALESCE($2,monthly_price),
			description=COALESCE($3,description), max_users=COALESCE($4,max_users),
			is_active=COALESCE($5,is_active), sort_order=COALESCE($6,sort_order)
		WHERE id=$7
	`, body.Name, body.MonthlyPrice, body.Description, body.MaxUsers, body.IsActive, body.SortOrder, id)

	if body.Features != nil {
		database.DB.Exec("UPDATE plans SET features=$1 WHERE id=$2", string(*body.Features), id)
	}

	var p models.Plan
	var desc string
	database.DB.QueryRow(`
		SELECT id, name, monthly_price, COALESCE(description,''), features, max_users, is_active, sort_order, created_at
		FROM plans WHERE id=$1
	`, id).Scan(&p.ID, &p.Name, &p.MonthlyPrice, &desc, &p.Features, &p.MaxUsers, &p.IsActive, &p.SortOrder, &p.CreatedAt)
	if desc != "" {
		p.Description = &desc
	}
	c.JSON(http.StatusOK, p)
}

func DeletePlan(c *gin.Context) {
	id := c.Param("id")
	role := c.GetString("role")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Нет доступа"})
		return
	}
	database.DB.Exec("DELETE FROM plans WHERE id=$1", id)
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}
