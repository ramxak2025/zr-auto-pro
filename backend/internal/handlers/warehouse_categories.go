package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
)

type warehouseCategory struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

func GetWarehouseCategories(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")

	rows, err := database.Pool.Query(ctx,
		"SELECT id, path FROM warehouse_categories WHERE tenant_id=$1 ORDER BY path", tenantID)
	if err != nil {
		serverError(c, "GetWarehouseCategories", err)
		return
	}
	defer rows.Close()

	categories := []warehouseCategory{}
	for rows.Next() {
		var cat warehouseCategory
		if err := rows.Scan(&cat.ID, &cat.Path); err != nil {
			continue
		}
		categories = append(categories, cat)
	}
	c.JSON(http.StatusOK, categories)
}

func CreateWarehouseCategory(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")

	var req struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Укажите путь категории"})
		return
	}

	var id string
	err := database.Pool.QueryRow(ctx,
		"INSERT INTO warehouse_categories (path, tenant_id) VALUES ($1, $2) ON CONFLICT (path, tenant_id) DO UPDATE SET path=$1 RETURNING id",
		req.Path, tenantID).Scan(&id)
	if err != nil {
		serverError(c, "CreateWarehouseCategory", err)
		return
	}
	c.JSON(http.StatusCreated, warehouseCategory{ID: id, Path: req.Path})
}

func DeleteWarehouseCategory(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	id := c.Param("id")

	tag, err := database.Pool.Exec(ctx,
		"DELETE FROM warehouse_categories WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "DeleteWarehouseCategory", err)
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найдена"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалена"})
}
