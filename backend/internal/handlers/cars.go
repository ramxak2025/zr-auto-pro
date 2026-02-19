package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetCars(c *gin.Context) {
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
		if err := database.DB.QueryRow("SELECT COUNT(*) FROM cars WHERE tenant_id=$1 AND (plate_number ILIKE $2 OR make_model ILIKE $2)", tenantID, s).Scan(&total); err != nil {
			serverError(c, "cars count query (search)", err)
			return
		}
	} else {
		if err := database.DB.QueryRow("SELECT COUNT(*) FROM cars WHERE tenant_id=$1", tenantID).Scan(&total); err != nil {
			serverError(c, "cars count query", err)
			return
		}
	}

	query := `SELECT c.id, c.plate_number, c.make_model, COALESCE(c.comment,''), c.client_id, c.created_at,
		COALESCE(cl.full_name,''), COALESCE(cl.phone,'')
		FROM cars c LEFT JOIN clients cl ON cl.id = c.client_id
		WHERE c.tenant_id=$1`
	args := []interface{}{tenantID}
	argIdx := 2

	if search != "" {
		query += " AND (c.plate_number ILIKE $" + strconv.Itoa(argIdx) + " OR c.make_model ILIKE $" + strconv.Itoa(argIdx) + ")"
		args = append(args, "%"+search+"%")
		argIdx++
	}
	query += " ORDER BY c.created_at DESC LIMIT $" + strconv.Itoa(argIdx) + " OFFSET $" + strconv.Itoa(argIdx+1)
	args = append(args, limit, offset)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		serverError(c, "cars list query", err)
		return
	}
	defer rows.Close()

	type CarWithClient struct {
		models.Car
		Client *models.Client `json:"client,omitempty"`
	}

	cars := []CarWithClient{}
	for rows.Next() {
		var car CarWithClient
		var comment, clientName, clientPhone string
		if err := rows.Scan(&car.ID, &car.PlateNumber, &car.MakeModel, &comment, &car.ClientID, &car.CreatedAt, &clientName, &clientPhone); err != nil {
			serverError(c, "cars row scan", err)
			return
		}
		if comment != "" {
			car.Comment = &comment
		}
		if clientName != "" {
			car.Client = &models.Client{FullName: clientName, Phone: clientPhone}
		}
		cars = append(cars, car)
	}
	c.JSON(http.StatusOK, models.PaginatedResponse{Data: cars, Total: total, Page: page, Limit: limit})
}

func GetCar(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	var car models.Car
	var comment string
	err := database.DB.QueryRow("SELECT id, plate_number, make_model, COALESCE(comment,''), client_id, created_at FROM cars WHERE id=$1 AND tenant_id=$2", id, tenantID).Scan(
		&car.ID, &car.PlateNumber, &car.MakeModel, &comment, &car.ClientID, &car.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	if comment != "" {
		car.Comment = &comment
	}
	c.JSON(http.StatusOK, car)
}

func CreateCar(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		PlateNumber string  `json:"plateNumber"`
		MakeModel   string  `json:"makeModel"`
		Comment     *string `json:"comment"`
		ClientID    string  `json:"clientId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	var car models.Car
	err := database.DB.QueryRow(`
		INSERT INTO cars (plate_number, make_model, comment, client_id, tenant_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING id, plate_number, make_model, client_id, created_at
	`, body.PlateNumber, body.MakeModel, body.Comment, body.ClientID, tenantID).Scan(
		&car.ID, &car.PlateNumber, &car.MakeModel, &car.ClientID, &car.CreatedAt,
	)
	if err != nil {
		serverError(c, "create car", err)
		return
	}
	car.Comment = body.Comment
	c.JSON(http.StatusCreated, car)
}

func UpdateCar(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body struct {
		PlateNumber *string `json:"plateNumber"`
		MakeModel   *string `json:"makeModel"`
		Comment     *string `json:"comment"`
		ClientID    *string `json:"clientId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if _, err := database.DB.Exec(`
		UPDATE cars SET
			plate_number = COALESCE($1, plate_number),
			make_model = COALESCE($2, make_model),
			comment = COALESCE($3, comment),
			client_id = COALESCE($4, client_id)
		WHERE id=$5 AND tenant_id=$6
	`, body.PlateNumber, body.MakeModel, body.Comment, body.ClientID, id, tenantID); err != nil {
		serverError(c, "update car", err)
		return
	}

	var car models.Car
	var comment string
	if err := database.DB.QueryRow("SELECT id, plate_number, make_model, COALESCE(comment,''), client_id, created_at FROM cars WHERE id=$1", id).Scan(
		&car.ID, &car.PlateNumber, &car.MakeModel, &comment, &car.ClientID, &car.CreatedAt,
	); err != nil {
		serverError(c, "update car re-read", err)
		return
	}
	if comment != "" {
		car.Comment = &comment
	}
	c.JSON(http.StatusOK, car)
}

func DeleteCar(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	result, err := database.DB.Exec("DELETE FROM cars WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "delete car", err)
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		serverError(c, "delete car rows affected", err)
		return
	}
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}
