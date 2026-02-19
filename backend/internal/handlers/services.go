package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetServices(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	search := c.Query("search")
	category := c.Query("category")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 1
	} else if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	query := "SELECT id, name, COALESCE(category,''), default_price, created_at FROM services WHERE tenant_id=$1"
	countQuery := "SELECT COUNT(*) FROM services WHERE tenant_id=$1"
	args := []interface{}{tenantID}
	countArgs := []interface{}{tenantID}
	argIdx := 2

	if search != "" {
		query += " AND name ILIKE $" + strconv.Itoa(argIdx)
		countQuery += " AND name ILIKE $" + strconv.Itoa(argIdx)
		args = append(args, "%"+search+"%")
		countArgs = append(countArgs, "%"+search+"%")
		argIdx++
	}
	if category != "" {
		query += " AND category=$" + strconv.Itoa(argIdx)
		countQuery += " AND category=$" + strconv.Itoa(argIdx)
		args = append(args, category)
		countArgs = append(countArgs, category)
		argIdx++
	}

	var total int
	if err := database.DB.QueryRow(countQuery, countArgs...).Scan(&total); err != nil {
		serverError(c, "services count query", err)
		return
	}

	query += " ORDER BY name LIMIT $" + strconv.Itoa(argIdx) + " OFFSET $" + strconv.Itoa(argIdx+1)
	args = append(args, limit, offset)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		serverError(c, "services list query", err)
		return
	}
	defer rows.Close()

	services := []models.Service{}
	for rows.Next() {
		var s models.Service
		var cat string
		if err := rows.Scan(&s.ID, &s.Name, &cat, &s.DefaultPrice, &s.CreatedAt); err != nil {
			serverError(c, "services row scan", err)
			return
		}
		if cat != "" {
			s.Category = &cat
		}
		services = append(services, s)
	}
	c.JSON(http.StatusOK, models.PaginatedResponse{Data: services, Total: total, Page: page, Limit: limit})
}

func GetService(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var s models.Service
	var cat string
	err := database.DB.QueryRow("SELECT id, name, COALESCE(category,''), default_price, created_at FROM services WHERE id=$1 AND tenant_id=$2", id, tenantID).Scan(
		&s.ID, &s.Name, &cat, &s.DefaultPrice, &s.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найдена"})
		return
	}
	if cat != "" {
		s.Category = &cat
	}
	c.JSON(http.StatusOK, s)
}

func CreateService(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		Name         string  `json:"name"`
		Category     *string `json:"category"`
		DefaultPrice float64 `json:"defaultPrice"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	var s models.Service
	err := database.DB.QueryRow(`
		INSERT INTO services (name, category, default_price, tenant_id) VALUES ($1,$2,$3,$4)
		RETURNING id, name, COALESCE(category,''), default_price, created_at
	`, body.Name, body.Category, body.DefaultPrice, tenantID).Scan(&s.ID, &s.Name, new(string), &s.DefaultPrice, &s.CreatedAt)
	if err != nil {
		serverError(c, "create service", err)
		return
	}
	s.Category = body.Category
	c.JSON(http.StatusCreated, s)
}

func UpdateService(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body struct {
		Name         *string  `json:"name"`
		Category     *string  `json:"category"`
		DefaultPrice *float64 `json:"defaultPrice"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if _, err := database.DB.Exec(`
		UPDATE services SET
			name = COALESCE($1, name),
			category = COALESCE($2, category),
			default_price = COALESCE($3, default_price)
		WHERE id=$4 AND tenant_id=$5
	`, body.Name, body.Category, body.DefaultPrice, id, tenantID); err != nil {
		serverError(c, "update service", err)
		return
	}

	var s models.Service
	var cat string
	if err := database.DB.QueryRow("SELECT id, name, COALESCE(category,''), default_price, created_at FROM services WHERE id=$1", id).Scan(
		&s.ID, &s.Name, &cat, &s.DefaultPrice, &s.CreatedAt,
	); err != nil {
		serverError(c, "update service re-read", err)
		return
	}
	if cat != "" {
		s.Category = &cat
	}
	c.JSON(http.StatusOK, s)
}

func DeleteService(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	result, err := database.DB.Exec("DELETE FROM services WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "delete service", err)
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		serverError(c, "delete service rows affected", err)
		return
	}
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найдена"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалена"})
}
