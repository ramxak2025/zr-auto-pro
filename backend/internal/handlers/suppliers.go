package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetSuppliers(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	search := c.Query("search")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	countQ := "SELECT COUNT(*) FROM suppliers WHERE tenant_id=$1"
	query := "SELECT id, name, COALESCE(phone,''), COALESCE(contact_person,''), COALESCE(comment,''), total_purchases, total_paid, current_debt, created_at FROM suppliers WHERE tenant_id=$1"
	args := []interface{}{tenantID}
	cArgs := []interface{}{tenantID}
	idx := 2

	if search != "" {
		f := " AND (name ILIKE $" + strconv.Itoa(idx) + " OR phone ILIKE $" + strconv.Itoa(idx) + ")"
		query += f
		countQ += f
		args = append(args, "%"+search+"%")
		cArgs = append(cArgs, "%"+search+"%")
		idx++
	}

	var total int
	if err := database.DB.QueryRow(countQ, cArgs...).Scan(&total); err != nil {
		serverError(c, "suppliers count", err)
		return
	}

	query += " ORDER BY name LIMIT $" + strconv.Itoa(idx) + " OFFSET $" + strconv.Itoa(idx+1)
	args = append(args, limit, offset)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		serverError(c, "suppliers list query", err)
		return
	}
	defer rows.Close()

	suppliers := []models.Supplier{}
	for rows.Next() {
		var s models.Supplier
		var phone, cp, comment string
		if err := rows.Scan(&s.ID, &s.Name, &phone, &cp, &comment, &s.TotalPurchases, &s.TotalPaid, &s.CurrentDebt, &s.CreatedAt); err != nil {
			serverError(c, "suppliers row scan", err)
			return
		}
		if phone != "" {
			s.Phone = &phone
		}
		if cp != "" {
			s.ContactPerson = &cp
		}
		if comment != "" {
			s.Comment = &comment
		}
		suppliers = append(suppliers, s)
	}
	if err := rows.Err(); err != nil {
		serverError(c, "suppliers rows iteration", err)
		return
	}
	c.JSON(http.StatusOK, models.PaginatedResponse{Data: suppliers, Total: total, Page: page, Limit: limit})
}

func GetSupplier(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	var s models.Supplier
	var phone, cp, comment string
	err := database.DB.QueryRow(`
		SELECT id, name, COALESCE(phone,''), COALESCE(contact_person,''), COALESCE(comment,''),
			   total_purchases, total_paid, current_debt, created_at
		FROM suppliers WHERE id=$1 AND tenant_id=$2
	`, id, tenantID).Scan(&s.ID, &s.Name, &phone, &cp, &comment, &s.TotalPurchases, &s.TotalPaid, &s.CurrentDebt, &s.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	if phone != "" {
		s.Phone = &phone
	}
	if cp != "" {
		s.ContactPerson = &cp
	}
	if comment != "" {
		s.Comment = &comment
	}
	c.JSON(http.StatusOK, s)
}

func CreateSupplier(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		Name          string  `json:"name"`
		Phone         *string `json:"phone"`
		ContactPerson *string `json:"contactPerson"`
		Comment       *string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	var s models.Supplier
	if err := database.DB.QueryRow(`
		INSERT INTO suppliers (name, phone, contact_person, comment, tenant_id) VALUES ($1,$2,$3,$4,$5)
		RETURNING id, name, total_purchases, total_paid, current_debt, created_at
	`, body.Name, body.Phone, body.ContactPerson, body.Comment, tenantID).Scan(
		&s.ID, &s.Name, &s.TotalPurchases, &s.TotalPaid, &s.CurrentDebt, &s.CreatedAt,
	); err != nil {
		serverError(c, "create supplier", err)
		return
	}
	s.Phone = body.Phone
	s.ContactPerson = body.ContactPerson
	s.Comment = body.Comment
	c.JSON(http.StatusCreated, s)
}

func UpdateSupplier(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body struct {
		Name          *string `json:"name"`
		Phone         *string `json:"phone"`
		ContactPerson *string `json:"contactPerson"`
		Comment       *string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	if _, err := database.DB.Exec(`
		UPDATE suppliers SET name=COALESCE($1,name), phone=COALESCE($2,phone),
		contact_person=COALESCE($3,contact_person), comment=COALESCE($4,comment)
		WHERE id=$5 AND tenant_id=$6
	`, body.Name, body.Phone, body.ContactPerson, body.Comment, id, tenantID); err != nil {
		serverError(c, "update supplier", err)
		return
	}

	c.Params = gin.Params{{Key: "id", Value: id}}
	GetSupplier(c)
}

func DeleteSupplier(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	if _, err := database.DB.Exec("DELETE FROM suppliers WHERE id=$1 AND tenant_id=$2", id, tenantID); err != nil {
		serverError(c, "delete supplier", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}

func GetDeliveries(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	supplierID := c.Query("supplierId")

	query := `SELECT d.id, d.supplier_id, d.date, d.total_amount, d.payment_status, COALESCE(d.comment,'')
		FROM deliveries d WHERE d.tenant_id=$1`
	args := []interface{}{tenantID}
	idx := 2
	if supplierID != "" {
		query += " AND d.supplier_id=$" + strconv.Itoa(idx)
		args = append(args, supplierID)
	}
	query += " ORDER BY d.date DESC"

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		serverError(c, "deliveries list query", err)
		return
	}
	defer rows.Close()

	deliveries := []models.Delivery{}
	for rows.Next() {
		var d models.Delivery
		var comment string
		if err := rows.Scan(&d.ID, &d.SupplierID, &d.Date, &d.TotalAmount, &d.PaymentStatus, &comment); err != nil {
			serverError(c, "deliveries row scan", err)
			return
		}
		if comment != "" {
			d.Comment = &comment
		}
		// Load items
		d.Items = []models.DeliveryItem{}
		iRows, err := database.DB.Query(`
			SELECT di.id, di.product_id, COALESCE(p.name,''), di.quantity, di.price, di.total
			FROM delivery_items di LEFT JOIN products p ON p.id=di.product_id WHERE di.delivery_id=$1
		`, d.ID)
		if err != nil {
			serverError(c, "delivery items query", err)
			return
		}
		for iRows.Next() {
			var item models.DeliveryItem
			var pName string
			if err := iRows.Scan(&item.ID, &item.ProductID, &pName, &item.Quantity, &item.Price, &item.Total); err != nil {
				iRows.Close()
				serverError(c, "delivery item scan", err)
				return
			}
			if pName != "" {
				item.Product = &models.Product{Name: pName}
			}
			d.Items = append(d.Items, item)
		}
		if err := iRows.Err(); err != nil {
			iRows.Close()
			serverError(c, "delivery items iteration", err)
			return
		}
		iRows.Close()
		deliveries = append(deliveries, d)
	}
	if err := rows.Err(); err != nil {
		serverError(c, "deliveries rows iteration", err)
		return
	}
	c.JSON(http.StatusOK, deliveries)
}

func GetDelivery(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	var d models.Delivery
	var comment string
	err := database.DB.QueryRow(`
		SELECT id, supplier_id, date, total_amount, payment_status, COALESCE(comment,'')
		FROM deliveries WHERE id=$1 AND tenant_id=$2
	`, id, tenantID).Scan(&d.ID, &d.SupplierID, &d.Date, &d.TotalAmount, &d.PaymentStatus, &comment)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найдена"})
		return
	}
	if comment != "" {
		d.Comment = &comment
	}

	d.Items = []models.DeliveryItem{}
	iRows, err := database.DB.Query(`
		SELECT di.id, di.product_id, COALESCE(p.name,''), di.quantity, di.price, di.total
		FROM delivery_items di LEFT JOIN products p ON p.id=di.product_id WHERE di.delivery_id=$1
	`, d.ID)
	if err != nil {
		serverError(c, "delivery items query", err)
		return
	}
	defer iRows.Close()

	for iRows.Next() {
		var item models.DeliveryItem
		var pName string
		if err := iRows.Scan(&item.ID, &item.ProductID, &pName, &item.Quantity, &item.Price, &item.Total); err != nil {
			serverError(c, "delivery item scan", err)
			return
		}
		if pName != "" {
			item.Product = &models.Product{Name: pName}
		}
		d.Items = append(d.Items, item)
	}
	if err := iRows.Err(); err != nil {
		serverError(c, "delivery items iteration", err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func CreateDelivery(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		SupplierID string  `json:"supplierId"`
		Date       string  `json:"date"`
		Comment    *string `json:"comment"`
		Items      []struct {
			ProductID string  `json:"productId"`
			Quantity  int     `json:"quantity"`
			Price     float64 `json:"price"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	date := time.Now()
	if body.Date != "" {
		if t, err := time.Parse("2006-01-02", body.Date); err == nil {
			date = t
		}
	}

	var totalAmount float64
	for _, item := range body.Items {
		totalAmount += item.Price * float64(item.Quantity)
	}

	tx, err := database.DB.Begin()
	if err != nil {
		serverError(c, "delivery tx begin", err)
		return
	}
	defer tx.Rollback()

	var deliveryID string
	if err := tx.QueryRow(`
		INSERT INTO deliveries (supplier_id, date, total_amount, payment_status, comment, tenant_id)
		VALUES ($1,$2,$3,'unpaid',$4,$5) RETURNING id
	`, body.SupplierID, date, totalAmount, body.Comment, tenantID).Scan(&deliveryID); err != nil {
		serverError(c, "insert delivery", err)
		return
	}

	for _, item := range body.Items {
		total := item.Price * float64(item.Quantity)
		if _, err := tx.Exec(`
			INSERT INTO delivery_items (id, delivery_id, product_id, quantity, price, total)
			VALUES ($1,$2,$3,$4,$5,$6)
		`, uuid.New().String(), deliveryID, item.ProductID, item.Quantity, item.Price, total); err != nil {
			serverError(c, "insert delivery item", err)
			return
		}

		// Increase stock
		if _, err := tx.Exec("UPDATE products SET stock = stock + $1 WHERE id=$2", item.Quantity, item.ProductID); err != nil {
			serverError(c, "update product stock", err)
			return
		}
	}

	// Update supplier totals
	if _, err := tx.Exec("UPDATE suppliers SET total_purchases = total_purchases + $1, current_debt = current_debt + $1 WHERE id=$2", totalAmount, body.SupplierID); err != nil {
		serverError(c, "update supplier totals", err)
		return
	}

	if err := tx.Commit(); err != nil {
		serverError(c, "delivery tx commit", err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": deliveryID})
}

func GetPayments(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	supplierID := c.Query("supplierId")

	query := "SELECT id, supplier_id, amount, date, COALESCE(comment,'') FROM supplier_payments WHERE tenant_id=$1"
	args := []interface{}{tenantID}
	if supplierID != "" {
		query += " AND supplier_id=$2"
		args = append(args, supplierID)
	}
	query += " ORDER BY date DESC"

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		serverError(c, "payments list query", err)
		return
	}
	defer rows.Close()

	payments := []models.SupplierPayment{}
	for rows.Next() {
		var p models.SupplierPayment
		var comment string
		if err := rows.Scan(&p.ID, &p.SupplierID, &p.Amount, &p.Date, &comment); err != nil {
			serverError(c, "payments row scan", err)
			return
		}
		if comment != "" {
			p.Comment = &comment
		}
		payments = append(payments, p)
	}
	if err := rows.Err(); err != nil {
		serverError(c, "payments rows iteration", err)
		return
	}
	c.JSON(http.StatusOK, payments)
}

func CreatePayment(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		SupplierID string  `json:"supplierId"`
		Amount     float64 `json:"amount"`
		Date       string  `json:"date"`
		Comment    *string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат запроса"})
		return
	}

	date := time.Now()
	if body.Date != "" {
		if t, err := time.Parse("2006-01-02", body.Date); err == nil {
			date = t
		}
	}

	var id string
	if err := database.DB.QueryRow(`
		INSERT INTO supplier_payments (supplier_id, amount, date, comment, tenant_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING id
	`, body.SupplierID, body.Amount, date, body.Comment, tenantID).Scan(&id); err != nil {
		serverError(c, "create payment", err)
		return
	}

	if _, err := database.DB.Exec("UPDATE suppliers SET total_paid = total_paid + $1, current_debt = current_debt - $1 WHERE id=$2", body.Amount, body.SupplierID); err != nil {
		serverError(c, "update supplier after payment", err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id})
}
