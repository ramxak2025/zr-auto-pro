package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetClients(c *gin.Context) {
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

	var total int
	if search != "" {
		s := "%" + search + "%"
		if err := database.DB.QueryRow(`SELECT COUNT(DISTINCT c.id) FROM clients c
			LEFT JOIN cars ca ON ca.client_id = c.id
			WHERE c.tenant_id=$1 AND (c.full_name ILIKE $2 OR c.phone ILIKE $2 OR ca.plate_number ILIKE $2)`, tenantID, s).Scan(&total); err != nil {
			serverError(c, "clients count query (search)", err)
			return
		}
	} else {
		if err := database.DB.QueryRow("SELECT COUNT(*) FROM clients WHERE tenant_id=$1", tenantID).Scan(&total); err != nil {
			serverError(c, "clients count query", err)
			return
		}
	}

	query := `SELECT DISTINCT c.id, c.full_name, c.phone, COALESCE(c.comment,''), c.created_at FROM clients c`
	args := []interface{}{tenantID}
	argIdx := 2

	if search != "" {
		query += ` LEFT JOIN cars ca ON ca.client_id = c.id WHERE c.tenant_id=$1 AND (c.full_name ILIKE $` + strconv.Itoa(argIdx) + ` OR c.phone ILIKE $` + strconv.Itoa(argIdx) + ` OR ca.plate_number ILIKE $` + strconv.Itoa(argIdx) + `)`
		args = append(args, "%"+search+"%")
		argIdx++
	} else {
		query += ` WHERE c.tenant_id=$1`
	}
	query += " ORDER BY c.created_at DESC LIMIT $" + strconv.Itoa(argIdx) + " OFFSET $" + strconv.Itoa(argIdx+1)
	args = append(args, limit, offset)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		serverError(c, "clients list query", err)
		return
	}
	defer rows.Close()

	clients := []models.Client{}
	for rows.Next() {
		var cl models.Client
		var comment string
		if err := rows.Scan(&cl.ID, &cl.FullName, &cl.Phone, &comment, &cl.CreatedAt); err != nil {
			serverError(c, "clients row scan", err)
			return
		}
		if comment != "" {
			cl.Comment = &comment
		}
		// Load cars
		carRows, err := database.DB.Query("SELECT id, plate_number, make_model, COALESCE(comment,''), client_id, created_at FROM cars WHERE client_id=$1", cl.ID)
		if err != nil {
			serverError(c, "clients car query", err)
			return
		}
		cl.Cars = []models.Car{}
		for carRows.Next() {
			var car models.Car
			var cc string
			if err := carRows.Scan(&car.ID, &car.PlateNumber, &car.MakeModel, &cc, &car.ClientID, &car.CreatedAt); err != nil {
				carRows.Close()
				serverError(c, "clients car row scan", err)
				return
			}
			if cc != "" {
				car.Comment = &cc
			}
			cl.Cars = append(cl.Cars, car)
		}
		carRows.Close()
		clients = append(clients, cl)
	}

	c.JSON(http.StatusOK, models.PaginatedResponse{Data: clients, Total: total, Page: page, Limit: limit})
}

func GetClient(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	var cl models.Client
	var comment string
	err := database.DB.QueryRow("SELECT id, full_name, phone, COALESCE(comment,''), created_at FROM clients WHERE id=$1 AND tenant_id=$2", id, tenantID).Scan(
		&cl.ID, &cl.FullName, &cl.Phone, &comment, &cl.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Клиент не найден"})
		return
	}
	if comment != "" {
		cl.Comment = &comment
	}

	// Cars
	carRows, err := database.DB.Query("SELECT id, plate_number, make_model, COALESCE(comment,''), client_id, created_at FROM cars WHERE client_id=$1", cl.ID)
	if err != nil {
		serverError(c, "get client cars query", err)
		return
	}
	cl.Cars = []models.Car{}
	for carRows.Next() {
		var car models.Car
		var cc string
		if err := carRows.Scan(&car.ID, &car.PlateNumber, &car.MakeModel, &cc, &car.ClientID, &car.CreatedAt); err != nil {
			carRows.Close()
			serverError(c, "get client car row scan", err)
			return
		}
		if cc != "" {
			car.Comment = &cc
		}
		cl.Cars = append(cl.Cars, car)
	}
	carRows.Close()

	c.JSON(http.StatusOK, cl)
}

func CreateClient(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		FullName string  `json:"fullName"`
		Phone    string  `json:"phone"`
		Comment  *string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	var cl models.Client
	err := database.DB.QueryRow(`
		INSERT INTO clients (full_name, phone, comment, tenant_id) VALUES ($1,$2,$3,$4)
		RETURNING id, full_name, phone, COALESCE(comment,''), created_at
	`, body.FullName, body.Phone, body.Comment, tenantID).Scan(&cl.ID, &cl.FullName, &cl.Phone, new(string), &cl.CreatedAt)
	if err != nil {
		serverError(c, "create client", err)
		return
	}
	cl.Comment = body.Comment
	cl.Cars = []models.Car{}
	c.JSON(http.StatusCreated, cl)
}

func UpdateClient(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body struct {
		FullName *string `json:"fullName"`
		Phone    *string `json:"phone"`
		Comment  *string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if _, err := database.DB.Exec(`
		UPDATE clients SET
			full_name = COALESCE($1, full_name),
			phone = COALESCE($2, phone),
			comment = COALESCE($3, comment)
		WHERE id=$4 AND tenant_id=$5
	`, body.FullName, body.Phone, body.Comment, id, tenantID); err != nil {
		serverError(c, "update client", err)
		return
	}

	GetClientByID(c, id, tenantID)
}

func GetClientByID(c *gin.Context, id, tenantID string) {
	var cl models.Client
	var comment string
	if err := database.DB.QueryRow("SELECT id, full_name, phone, COALESCE(comment,''), created_at FROM clients WHERE id=$1 AND tenant_id=$2", id, tenantID).Scan(
		&cl.ID, &cl.FullName, &cl.Phone, &comment, &cl.CreatedAt,
	); err != nil {
		serverError(c, "get client by id", err)
		return
	}
	if comment != "" {
		cl.Comment = &comment
	}
	cl.Cars = []models.Car{}
	carRows, err := database.DB.Query("SELECT id, plate_number, make_model, COALESCE(comment,''), client_id, created_at FROM cars WHERE client_id=$1", cl.ID)
	if err != nil {
		serverError(c, "get client by id cars query", err)
		return
	}
	for carRows.Next() {
		var car models.Car
		var cc string
		if err := carRows.Scan(&car.ID, &car.PlateNumber, &car.MakeModel, &cc, &car.ClientID, &car.CreatedAt); err != nil {
			carRows.Close()
			serverError(c, "get client by id car row scan", err)
			return
		}
		if cc != "" {
			car.Comment = &cc
		}
		cl.Cars = append(cl.Cars, car)
	}
	carRows.Close()
	c.JSON(http.StatusOK, cl)
}

func DeleteClient(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	result, err := database.DB.Exec("DELETE FROM clients WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "delete client", err)
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		serverError(c, "delete client rows affected", err)
		return
	}
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}
