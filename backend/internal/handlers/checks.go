package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetChecks(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	search := c.Query("search")
	masterID := c.Query("masterId")
	clientID := c.Query("clientId")
	dateFrom := c.Query("dateFrom")
	dateTo := c.Query("dateTo")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	baseQ := " FROM checks ch LEFT JOIN users m ON m.id=ch.master_id LEFT JOIN clients cl ON cl.id=ch.client_id LEFT JOIN cars ca ON ca.id=ch.car_id WHERE ch.tenant_id=$1"
	args := []interface{}{tenantID}
	cArgs := []interface{}{tenantID}
	idx := 2

	if search != "" {
		baseQ += " AND (cl.full_name ILIKE $" + strconv.Itoa(idx) + " OR cl.phone ILIKE $" + strconv.Itoa(idx) + " OR ca.plate_number ILIKE $" + strconv.Itoa(idx) + ")"
		args = append(args, "%"+search+"%")
		cArgs = append(cArgs, "%"+search+"%")
		idx++
	}
	if masterID != "" {
		baseQ += " AND ch.master_id=$" + strconv.Itoa(idx)
		args = append(args, masterID)
		cArgs = append(cArgs, masterID)
		idx++
	}
	if clientID != "" {
		baseQ += " AND ch.client_id=$" + strconv.Itoa(idx)
		args = append(args, clientID)
		cArgs = append(cArgs, clientID)
		idx++
	}
	if dateFrom != "" {
		baseQ += " AND ch.date >= $" + strconv.Itoa(idx)
		args = append(args, dateFrom)
		cArgs = append(cArgs, dateFrom)
		idx++
	}
	if dateTo != "" {
		baseQ += " AND ch.date <= $" + strconv.Itoa(idx) + "::date + interval '1 day'"
		args = append(args, dateTo)
		cArgs = append(cArgs, dateTo)
		idx++
	}

	var total int
	if err := database.Pool.QueryRow(ctx, "SELECT COUNT(*) "+baseQ, cArgs...).Scan(&total); err != nil {
		log.Printf("GetChecks count error: %v", err)
	}

	query := `SELECT ch.id, ch.number, ch.date, ch.master_id, COALESCE(m.full_name,''), ch.client_id, COALESCE(cl.full_name,''), COALESCE(cl.phone,''),
		ch.car_id, COALESCE(ca.plate_number,''), COALESCE(ca.make_model,''), ch.payment_method, ch.total_revenue, ch.is_deferred, ch.discount, ch.created_at` + baseQ +
		" ORDER BY ch.date DESC, ch.number DESC LIMIT $" + strconv.Itoa(idx) + " OFFSET $" + strconv.Itoa(idx+1)
	args = append(args, limit, offset)

	rows, err := database.Pool.Query(ctx, query, args...)
	checks := []models.Check{}
	if err != nil {
		serverError(c, "GetChecks query", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var ch models.Check
		var masterName, clientName, clientPhone, carPlate, carModel string
		if scanErr := rows.Scan(&ch.ID, &ch.Number, &ch.Date, &ch.MasterID, &masterName, &ch.ClientID, &clientName, &clientPhone,
			&ch.CarID, &carPlate, &carModel, &ch.PaymentMethod, &ch.TotalRevenue, &ch.IsDeferred, &ch.Discount, &ch.CreatedAt); scanErr != nil {
			log.Printf("GetChecks scan error: %v", scanErr)
			continue
		}
		ch.Master = &models.User{ID: ch.MasterID, FullName: masterName}
		ch.Client = &models.Client{ID: ch.ClientID, FullName: clientName, Phone: clientPhone}
		ch.Car = &models.Car{ID: ch.CarID, PlateNumber: carPlate, MakeModel: carModel}
		ch.Services = []models.CheckServiceLine{}
		ch.Products = []models.CheckProductLine{}
		checks = append(checks, ch)
	}
	c.JSON(http.StatusOK, models.PaginatedResponse{Data: checks, Total: total, Page: page, Limit: limit})
}

func GetCheck(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	var ch models.Check
	var masterName, clientName, clientPhone, carPlate, carModel string
	var comment string
	var mileage int
	err := database.Pool.QueryRow(ctx, `
		SELECT ch.id, ch.number, ch.date, ch.master_id, COALESCE(m.full_name,''),
			   ch.client_id, COALESCE(cl.full_name,''), COALESCE(cl.phone,''),
			   ch.car_id, COALESCE(ca.plate_number,''), COALESCE(ca.make_model,''),
			   COALESCE(ch.mileage,0), COALESCE(ch.comment,''), ch.discount, ch.is_deferred,
			   ch.payment_method, COALESCE(ch.cash_amount,0), COALESCE(ch.card_amount,0),
			   ch.service_total, ch.product_total, ch.total_revenue,
			   ch.product_cost_total, ch.service_salary_total, ch.total_cost, ch.profit, ch.created_at
		FROM checks ch LEFT JOIN users m ON m.id=ch.master_id
		LEFT JOIN clients cl ON cl.id=ch.client_id LEFT JOIN cars ca ON ca.id=ch.car_id
		WHERE ch.id=$1 AND ch.tenant_id=$2
	`, id, tenantID).Scan(
		&ch.ID, &ch.Number, &ch.Date, &ch.MasterID, &masterName,
		&ch.ClientID, &clientName, &clientPhone,
		&ch.CarID, &carPlate, &carModel,
		&mileage, &comment, &ch.Discount, &ch.IsDeferred,
		&ch.PaymentMethod, &ch.CashAmount, &ch.CardAmount,
		&ch.ServiceTotal, &ch.ProductTotal, &ch.TotalRevenue,
		&ch.ProductCostTotal, &ch.ServiceSalaryTotal, &ch.TotalCost, &ch.Profit, &ch.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Заказ-наряд не найден"})
		return
	}
	if mileage > 0 {
		ch.Mileage = &mileage
	}
	if comment != "" {
		ch.Comment = &comment
	}
	ch.Master = &models.User{ID: ch.MasterID, FullName: masterName}
	ch.Client = &models.Client{ID: ch.ClientID, FullName: clientName, Phone: clientPhone}
	ch.Car = &models.Car{ID: ch.CarID, PlateNumber: carPlate, MakeModel: carModel}

	// Load service lines
	ch.Services = []models.CheckServiceLine{}
	sRows, err := database.Pool.Query(ctx, `
		SELECT csl.id, csl.service_id, csl.master_id, COALESCE(m.full_name,''), csl.name, csl.price, csl.quantity, csl.total
		FROM check_service_lines csl LEFT JOIN users m ON m.id=csl.master_id WHERE csl.check_id=$1
	`, id)
	if err == nil {
		defer sRows.Close()
		for sRows.Next() {
			var sl models.CheckServiceLine
			var sid, mid, mname string
			if scanErr := sRows.Scan(&sl.ID, &sid, &mid, &mname, &sl.Name, &sl.Price, &sl.Quantity, &sl.Total); scanErr != nil {
				continue
			}
			if sid != "" {
				sl.ServiceID = &sid
			}
			if mid != "" {
				sl.MasterID = &mid
				sl.Master = &models.User{ID: mid, FullName: mname}
			}
			ch.Services = append(ch.Services, sl)
		}
	}

	// Load product lines
	ch.Products = []models.CheckProductLine{}
	pRows, err := database.Pool.Query(ctx, `
		SELECT id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost
		FROM check_product_lines WHERE check_id=$1
	`, id)
	if err == nil {
		defer pRows.Close()
		for pRows.Next() {
			var pl models.CheckProductLine
			var pid string
			if scanErr := pRows.Scan(&pl.ID, &pid, &pl.Name, &pl.SellPrice, &pl.CostPrice, &pl.Quantity, &pl.TotalSell, &pl.TotalCost); scanErr != nil {
				continue
			}
			if pid != "" {
				pl.ProductID = &pid
			}
			ch.Products = append(ch.Products, pl)
		}
	}

	c.JSON(http.StatusOK, ch)
}

func CreateCheck(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	role := c.GetString("role")
	var req models.CreateCheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if req.MasterID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Мастер обязателен"})
		return
	}

	// ClientID and CarID are optional (retail buyer)
	var clientID, carID interface{}
	if req.ClientID != "" {
		clientID = req.ClientID
	}
	if req.CarID != "" {
		carID = req.CarID
	}

	date := time.Now()
	if req.Date != "" {
		if t, err := time.Parse(time.RFC3339, req.Date); err == nil {
			date = t
		} else if t, err := time.Parse("2006-01-02", req.Date); err == nil {
			date = t
		}
	}

	if role == "master" {
		now := time.Now()
		todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		tomorrowStart := todayStart.AddDate(0, 0, 1)
		if date.Before(todayStart) || !date.Before(tomorrowStart) {
			c.JSON(http.StatusForbidden, gin.H{"message": "Мастер может создавать чеки только за сегодняшний день"})
			return
		}
	}

	var serviceTotal, productTotal, productCostTotal float64

	type masterSalaryCalc struct {
		total   float64
		percent float64
	}
	masterSalaries := map[string]*masterSalaryCalc{}

	for _, s := range req.Services {
		total := s.Price * float64(s.Quantity)
		serviceTotal += total

		mid := req.MasterID
		if s.MasterID != nil && *s.MasterID != "" {
			mid = *s.MasterID
		}
		if _, exists := masterSalaries[mid]; !exists {
			var pct float64
			database.Pool.QueryRow(ctx, "SELECT COALESCE(salary_percent,0) FROM users WHERE id=$1", mid).Scan(&pct)
			masterSalaries[mid] = &masterSalaryCalc{percent: pct}
		}
		masterSalaries[mid].total += total
	}

	var serviceSalaryTotal float64
	for _, ms := range masterSalaries {
		serviceSalaryTotal += ms.total * ms.percent / 100
	}

	for _, p := range req.Products {
		productTotal += p.SellPrice * p.Quantity
		productCostTotal += p.CostPrice * p.Quantity
	}

	totalRevenue := serviceTotal + productTotal - req.Discount
	totalCost := productCostTotal + serviceSalaryTotal
	profit := totalRevenue - totalCost

	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		serverError(c, "CreateCheck tx begin", err)
		return
	}
	defer tx.Rollback(ctx)

	var checkID string
	var checkNumber int
	err = tx.QueryRow(ctx, `
		INSERT INTO checks (date, master_id, client_id, car_id, mileage, comment, discount, is_deferred,
			payment_method, cash_amount, card_amount, service_total, product_total, total_revenue, product_cost_total,
			service_salary_total, total_cost, profit, tenant_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		RETURNING id, number
	`, date, req.MasterID, clientID, carID, req.Mileage, req.Comment, req.Discount,
		req.IsDeferred, req.PaymentMethod, req.CashAmount, req.CardAmount,
		serviceTotal, productTotal, totalRevenue,
		productCostTotal, serviceSalaryTotal, totalCost, profit, tenantID).Scan(&checkID, &checkNumber)
	if err != nil {
		serverError(c, "CreateCheck insert", err)
		return
	}

	for _, s := range req.Services {
		total := s.Price * float64(s.Quantity)
		mid := req.MasterID
		if s.MasterID != nil && *s.MasterID != "" {
			mid = *s.MasterID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO check_service_lines (id, check_id, service_id, master_id, name, price, quantity, total)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		`, uuid.New().String(), checkID, s.ServiceID, mid, s.Name, s.Price, s.Quantity, total); err != nil {
			serverError(c, "CreateCheck service line", err)
			return
		}
	}

	for _, p := range req.Products {
		totalSell := p.SellPrice * p.Quantity
		totalCostLine := p.CostPrice * p.Quantity
		if _, err := tx.Exec(ctx, `
			INSERT INTO check_product_lines (id, check_id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		`, uuid.New().String(), checkID, p.ProductID, p.Name, p.SellPrice, p.CostPrice, p.Quantity, totalSell, totalCostLine); err != nil {
			serverError(c, "CreateCheck product line", err)
			return
		}
		if p.ProductID != nil {
			tx.Exec(ctx, "UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE id=$2", p.Quantity, *p.ProductID)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		serverError(c, "CreateCheck tx commit", err)
		return
	}

	c.Set("tenantID", tenantID)
	c.Params = gin.Params{{Key: "id", Value: checkID}}
	GetCheck(c)
}

func UpdateCheck(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	role := c.GetString("role")
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if dateStr, ok := body["date"].(string); ok {
		if role == "director" || role == "admin" || role == "superadmin" {
			database.Pool.Exec(ctx, "UPDATE checks SET date=$1 WHERE id=$2 AND tenant_id=$3", dateStr, id, tenantID)
		} else {
			c.JSON(http.StatusForbidden, gin.H{"message": "Только директор может изменять дату чека"})
			return
		}
	}

	if pm, ok := body["paymentMethod"].(string); ok {
		database.Pool.Exec(ctx, "UPDATE checks SET payment_method=$1 WHERE id=$2 AND tenant_id=$3", pm, id, tenantID)
	}
	if d, ok := body["isDeferred"].(bool); ok {
		database.Pool.Exec(ctx, "UPDATE checks SET is_deferred=$1 WHERE id=$2 AND tenant_id=$3", d, id, tenantID)
	}
	if comm, ok := body["comment"].(string); ok {
		database.Pool.Exec(ctx, "UPDATE checks SET comment=$1 WHERE id=$2 AND tenant_id=$3", comm, id, tenantID)
	}
	if ca, ok := body["cashAmount"].(float64); ok {
		database.Pool.Exec(ctx, "UPDATE checks SET cash_amount=$1 WHERE id=$2 AND tenant_id=$3", ca, id, tenantID)
	}
	if ca, ok := body["cardAmount"].(float64); ok {
		database.Pool.Exec(ctx, "UPDATE checks SET card_amount=$1 WHERE id=$2 AND tenant_id=$3", ca, id, tenantID)
	}

	c.Params = gin.Params{{Key: "id", Value: id}}
	GetCheck(c)
}

func DeleteCheck(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	role := c.GetString("role")

	// Masters cannot delete deferred (draft) checks
	if role == "master" {
		var isDeferred bool
		err := database.Pool.QueryRow(ctx, "SELECT is_deferred FROM checks WHERE id=$1 AND tenant_id=$2", id, tenantID).Scan(&isDeferred)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
			return
		}
		if isDeferred {
			c.JSON(http.StatusForbidden, gin.H{"message": "Мастер не может удалить отложенный чек"})
			return
		}
	}

	tag, err := database.Pool.Exec(ctx, "DELETE FROM checks WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "DeleteCheck", err)
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найден"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалён"})
}

func GetDashboard(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekStart := todayStart.AddDate(0, 0, -int(now.Weekday()-1))
	if now.Weekday() == 0 {
		weekStart = todayStart.AddDate(0, 0, -6)
	}
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	var stats models.DashboardStats
	database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(total_revenue),0), COUNT(*) FROM checks WHERE tenant_id=$1 AND date >= $2", tenantID, todayStart).Scan(&stats.TodayRevenue, &stats.TodayChecks)
	database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE tenant_id=$1 AND date >= $2", tenantID, weekStart).Scan(&stats.WeekRevenue)
	database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE tenant_id=$1 AND date >= $2", tenantID, monthStart).Scan(&stats.MonthRevenue)
	database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(profit),0) FROM checks WHERE tenant_id=$1 AND date >= $2", tenantID, todayStart).Scan(&stats.TodayProfit)
	database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(profit),0) FROM checks WHERE tenant_id=$1 AND date >= $2", tenantID, monthStart).Scan(&stats.MonthProfit)

	c.JSON(http.StatusOK, stats)
}

func GetRanking(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	ranking := models.EmployeeRanking{Today: []models.EmployeeRankEntry{}, Month: []models.EmployeeRankEntry{}}

	todayRows, err := database.Pool.Query(ctx, `
		SELECT ch.master_id, u.full_name, COALESCE(SUM(ch.total_revenue),0), COUNT(*)
		FROM checks ch JOIN users u ON u.id=ch.master_id
		WHERE ch.tenant_id=$1 AND ch.date >= $2
		GROUP BY ch.master_id, u.full_name ORDER BY SUM(ch.total_revenue) DESC
	`, tenantID, todayStart)
	if err == nil {
		defer todayRows.Close()
		for todayRows.Next() {
			var e models.EmployeeRankEntry
			if scanErr := todayRows.Scan(&e.MasterID, &e.MasterName, &e.Revenue, &e.CheckCount); scanErr == nil {
				ranking.Today = append(ranking.Today, e)
			}
		}
	}

	monthRows, err := database.Pool.Query(ctx, `
		SELECT ch.master_id, u.full_name, COALESCE(SUM(ch.total_revenue),0), COUNT(*)
		FROM checks ch JOIN users u ON u.id=ch.master_id
		WHERE ch.tenant_id=$1 AND ch.date >= $2
		GROUP BY ch.master_id, u.full_name ORDER BY SUM(ch.total_revenue) DESC
	`, tenantID, monthStart)
	if err == nil {
		defer monthRows.Close()
		for monthRows.Next() {
			var e models.EmployeeRankEntry
			if scanErr := monthRows.Scan(&e.MasterID, &e.MasterName, &e.Revenue, &e.CheckCount); scanErr == nil {
				ranking.Month = append(ranking.Month, e)
			}
		}
	}

	c.JSON(http.StatusOK, ranking)
}

// GetDashboardChart returns daily chart data for owner dashboard
func GetDashboardChart(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	period := c.DefaultQuery("period", "week")

	now := time.Now()
	var startDate time.Time
	switch period {
	case "today":
		startDate = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	case "week":
		startDate = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -6)
	case "month":
		startDate = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	case "year":
		startDate = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	default:
		startDate = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -6)
	}

	type ChartPoint struct {
		Date       string  `json:"date"`
		Revenue    float64 `json:"revenue"`
		Profit     float64 `json:"profit"`
		CheckCount int     `json:"checkCount"`
	}

	var groupBy string
	if period == "year" {
		groupBy = "TO_CHAR(date, 'YYYY-MM')"
	} else {
		groupBy = "date::date"
	}

	query := `SELECT ` + groupBy + ` AS d, COALESCE(SUM(total_revenue),0), COALESCE(SUM(profit),0), COUNT(*)
		FROM checks WHERE tenant_id=$1 AND date >= $2
		GROUP BY d ORDER BY d`

	rows, err := database.Pool.Query(ctx, query, tenantID, startDate)
	if err != nil {
		serverError(c, "dashboard chart query", err)
		return
	}
	defer rows.Close()

	points := []ChartPoint{}
	for rows.Next() {
		var p ChartPoint
		var dateVal interface{}
		if err := rows.Scan(&dateVal, &p.Revenue, &p.Profit, &p.CheckCount); err != nil {
			continue
		}
		switch v := dateVal.(type) {
		case time.Time:
			p.Date = v.Format("2006-01-02")
		case string:
			p.Date = v
		default:
			p.Date = fmt.Sprintf("%v", v)
		}
		points = append(points, p)
	}

	// Totals
	var totalRevenue, totalProfit float64
	var totalChecks int
	for _, p := range points {
		totalRevenue += p.Revenue
		totalProfit += p.Profit
		totalChecks += p.CheckCount
	}

	c.JSON(http.StatusOK, gin.H{
		"points":       points,
		"totalRevenue": totalRevenue,
		"totalProfit":  totalProfit,
		"totalChecks":  totalChecks,
	})
}
