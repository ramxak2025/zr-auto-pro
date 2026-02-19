package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetProducts(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	search := c.Query("search")
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

	countQ := "SELECT COUNT(*) FROM products WHERE tenant_id=$1"
	query := `SELECT id, name, COALESCE(category,''), COALESCE(photo,''), cost_price, sell_price, stock, min_stock, created_at FROM products WHERE tenant_id=$1`
	args := []interface{}{tenantID}
	cArgs := []interface{}{tenantID}
	idx := 2

	if search != "" {
		query += " AND name ILIKE $" + strconv.Itoa(idx)
		countQ += " AND name ILIKE $" + strconv.Itoa(idx)
		args = append(args, "%"+search+"%")
		cArgs = append(cArgs, "%"+search+"%")
		idx++
	}

	var total int
	if err := database.Pool.QueryRow(ctx, countQ, cArgs...).Scan(&total); err != nil {
		serverError(c, "products count query", err)
		return
	}

	query += " ORDER BY name LIMIT $" + strconv.Itoa(idx) + " OFFSET $" + strconv.Itoa(idx+1)
	args = append(args, limit, offset)

	rows, err := database.Pool.Query(ctx, query, args...)
	if err != nil {
		serverError(c, "products list query", err)
		return
	}
	defer rows.Close()

	products := []models.Product{}
	for rows.Next() {
		var p models.Product
		var cat, photo string
		if err := rows.Scan(&p.ID, &p.Name, &cat, &photo, &p.CostPrice, &p.SellPrice, &p.Stock, &p.MinStock, &p.CreatedAt); err != nil {
			serverError(c, "products row scan", err)
			return
		}
		if cat != "" {
			p.Category = &cat
		}
		if photo != "" {
			p.Photo = &photo
		}
		products = append(products, p)
	}
	c.JSON(http.StatusOK, models.PaginatedResponse{Data: products, Total: total, Page: page, Limit: limit})
}

func GetProductsLowStock(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	rows, err := database.Pool.Query(ctx, `
		SELECT id, name, COALESCE(category,''), cost_price, sell_price, stock, min_stock, created_at
		FROM products WHERE tenant_id=$1 AND stock <= min_stock AND min_stock > 0 ORDER BY stock
	`, tenantID)
	if err != nil {
		serverError(c, "products low stock query", err)
		return
	}
	defer rows.Close()

	products := []models.Product{}
	for rows.Next() {
		var p models.Product
		var cat string
		if err := rows.Scan(&p.ID, &p.Name, &cat, &p.CostPrice, &p.SellPrice, &p.Stock, &p.MinStock, &p.CreatedAt); err != nil {
			serverError(c, "products low stock row scan", err)
			return
		}
		if cat != "" {
			p.Category = &cat
		}
		products = append(products, p)
	}
	c.JSON(http.StatusOK, products)
}

func GetStockMovements(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	rows, err := database.Pool.Query(ctx, `
		SELECT sm.id, sm.product_id, sm.type, sm.quantity, sm.stock_before, sm.stock_after,
			   COALESCE(sm.reason,''), sm.created_at, COALESCE(p.name,'')
		FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id
		WHERE sm.tenant_id=$1 ORDER BY sm.created_at DESC LIMIT 100
	`, tenantID)
	if err != nil {
		serverError(c, "stock movements query", err)
		return
	}
	defer rows.Close()

	movements := []models.StockMovement{}
	for rows.Next() {
		var m models.StockMovement
		var reason, pName string
		if err := rows.Scan(&m.ID, &m.ProductID, &m.Type, &m.Quantity, &m.StockBefore, &m.StockAfter, &reason, &m.CreatedAt, &pName); err != nil {
			serverError(c, "stock movements row scan", err)
			return
		}
		if reason != "" {
			m.Reason = &reason
		}
		if pName != "" {
			m.Product = &models.Product{Name: pName}
		}
		movements = append(movements, m)
	}
	c.JSON(http.StatusOK, movements)
}

func GetProduct(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var p models.Product
	var cat, photo string
	err := database.Pool.QueryRow(ctx, `
		SELECT id, name, COALESCE(category,''), COALESCE(photo,''), cost_price, sell_price, stock, min_stock, created_at
		FROM products WHERE id=$1 AND tenant_id=$2
	`, id, tenantID).Scan(&p.ID, &p.Name, &cat, &photo, &p.CostPrice, &p.SellPrice, &p.Stock, &p.MinStock, &p.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	if cat != "" {
		p.Category = &cat
	}
	if photo != "" {
		p.Photo = &photo
	}
	c.JSON(http.StatusOK, p)
}

func CreateProduct(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	var body struct {
		Name      string  `json:"name"`
		Category  *string `json:"category"`
		Photo     *string `json:"photo"`
		CostPrice float64 `json:"costPrice"`
		SellPrice float64 `json:"sellPrice"`
		Stock     int     `json:"stock"`
		MinStock  int     `json:"minStock"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	var p models.Product
	err := database.Pool.QueryRow(ctx, `
		INSERT INTO products (name, category, photo, cost_price, sell_price, stock, min_stock, tenant_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, cost_price, sell_price, stock, min_stock, created_at
	`, body.Name, body.Category, body.Photo, body.CostPrice, body.SellPrice, body.Stock, body.MinStock, tenantID).Scan(
		&p.ID, &p.Name, &p.CostPrice, &p.SellPrice, &p.Stock, &p.MinStock, &p.CreatedAt,
	)
	if err != nil {
		serverError(c, "create product", err)
		return
	}
	p.Category = body.Category
	p.Photo = body.Photo
	c.JSON(http.StatusCreated, p)
}

func UpdateProduct(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body struct {
		Name      *string  `json:"name"`
		Category  *string  `json:"category"`
		Photo     *string  `json:"photo"`
		CostPrice *float64 `json:"costPrice"`
		SellPrice *float64 `json:"sellPrice"`
		Stock     *int     `json:"stock"`
		MinStock  *int     `json:"minStock"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	_, err := database.Pool.Exec(ctx, `
		UPDATE products SET
			name = COALESCE($1, name), category = COALESCE($2, category), photo = COALESCE($3, photo),
			cost_price = COALESCE($4, cost_price), sell_price = COALESCE($5, sell_price),
			stock = COALESCE($6, stock), min_stock = COALESCE($7, min_stock)
		WHERE id=$8 AND tenant_id=$9
	`, body.Name, body.Category, body.Photo, body.CostPrice, body.SellPrice, body.Stock, body.MinStock, id, tenantID)
	if err != nil {
		serverError(c, "update product", err)
		return
	}

	var p models.Product
	var cat, photo string
	if err := database.Pool.QueryRow(ctx, `
		SELECT id, name, COALESCE(category,''), COALESCE(photo,''), cost_price, sell_price, stock, min_stock, created_at
		FROM products WHERE id=$1
	`, id).Scan(&p.ID, &p.Name, &cat, &photo, &p.CostPrice, &p.SellPrice, &p.Stock, &p.MinStock, &p.CreatedAt); err != nil {
		serverError(c, "update product re-read", err)
		return
	}
	if cat != "" {
		p.Category = &cat
	}
	if photo != "" {
		p.Photo = &photo
	}
	c.JSON(http.StatusOK, p)
}

func DeleteProduct(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	tag, err := database.Pool.Exec(ctx, "DELETE FROM products WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "delete product", err)
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}

func UpdateStock(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body struct {
		Type     string `json:"type"`
		Quantity int    `json:"quantity"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	var currentStock int
	if err := database.Pool.QueryRow(ctx, "SELECT stock FROM products WHERE id=$1 AND tenant_id=$2", id, tenantID).Scan(&currentStock); err != nil {
		serverError(c, "update stock read current", err)
		return
	}

	newStock := currentStock
	switch body.Type {
	case "income":
		newStock += body.Quantity
	case "expense", "writeoff":
		newStock -= body.Quantity
		if newStock < 0 {
			newStock = 0
		}
	case "inventory":
		newStock = body.Quantity
	}

	if _, err := database.Pool.Exec(ctx, "UPDATE products SET stock=$1 WHERE id=$2 AND tenant_id=$3", newStock, id, tenantID); err != nil {
		serverError(c, "update stock exec", err)
		return
	}

	reason := body.Reason
	if _, err := database.Pool.Exec(ctx, `
		INSERT INTO stock_movements (product_id, type, quantity, stock_before, stock_after, reason, tenant_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, id, body.Type, body.Quantity, currentStock, newStock, reason, tenantID); err != nil {
		serverError(c, "insert stock movement", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"stock": newStock})
}
