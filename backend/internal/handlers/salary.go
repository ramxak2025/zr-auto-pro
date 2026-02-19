package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetSalaries(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	dateFrom := c.DefaultQuery("dateFrom", time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.Now().Location()).Format("2006-01-02"))
	dateTo := c.DefaultQuery("dateTo", time.Now().Format("2006-01-02"))

	rows, err := database.Pool.Query(ctx, `
		SELECT u.id, u.full_name, u.salary_percent,
			   COALESCE(SUM(ch.service_salary_total),0),
			   COALESCE(SUM(ch.total_revenue),0),
			   COUNT(ch.id)
		FROM users u
		LEFT JOIN checks ch ON ch.master_id = u.id AND ch.date >= $2 AND ch.date <= $3::date + interval '1 day'
		WHERE u.tenant_id=$1 AND u.role IN ('master','admin') AND u.is_active=true
		GROUP BY u.id, u.full_name, u.salary_percent
		ORDER BY SUM(ch.total_revenue) DESC NULLS LAST
	`, tenantID, dateFrom, dateTo)
	if err != nil {
		serverError(c, "salaries query", err)
		return
	}
	defer rows.Close()

	salaries := []models.MasterSalary{}
	for rows.Next() {
		var s models.MasterSalary
		if err := rows.Scan(&s.MasterID, &s.MasterName, &s.SalaryPercent, &s.TotalEarnings, &s.TotalRevenue, &s.CheckCount); err != nil {
			serverError(c, "salaries row scan", err)
			return
		}
		salaries = append(salaries, s)
	}
	c.JSON(http.StatusOK, salaries)
}

func GetMySalary(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.GetString("userID")
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekStart := todayStart.AddDate(0, 0, -int(now.Weekday()-1))
	if now.Weekday() == 0 {
		weekStart = todayStart.AddDate(0, 0, -6)
	}
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	var summary models.SalarySummary

	if err := database.Pool.QueryRow(ctx, "SELECT full_name, salary_percent FROM users WHERE id=$1", userID).Scan(&summary.MasterName, &summary.SalaryPercent); err != nil {
		serverError(c, "my salary user query", err)
		return
	}

	if err := database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(service_salary_total),0), COUNT(*) FROM checks WHERE master_id=$1 AND date >= $2", userID, todayStart).Scan(&summary.Today, &summary.TodayChecks); err != nil {
		serverError(c, "my salary today query", err)
		return
	}
	if err := database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(service_salary_total),0) FROM checks WHERE master_id=$1 AND date >= $2", userID, weekStart).Scan(&summary.Week); err != nil {
		serverError(c, "my salary week query", err)
		return
	}
	if err := database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(service_salary_total),0), COUNT(*) FROM checks WHERE master_id=$1 AND date >= $2", userID, monthStart).Scan(&summary.Month, &summary.MonthChecks); err != nil {
		serverError(c, "my salary month query", err)
		return
	}
	if err := database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(service_salary_total),0) FROM checks WHERE master_id=$1", userID).Scan(&summary.Total); err != nil {
		serverError(c, "my salary total query", err)
		return
	}

	// Today payment methods
	if err := database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE master_id=$1 AND date >= $2 AND payment_method='cash'", userID, todayStart).Scan(&summary.TodayCash); err != nil {
		serverError(c, "my salary today cash query", err)
		return
	}
	if err := database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE master_id=$1 AND date >= $2 AND payment_method='card'", userID, todayStart).Scan(&summary.TodayCard); err != nil {
		serverError(c, "my salary today card query", err)
		return
	}
	if err := database.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE master_id=$1 AND date >= $2 AND payment_method='warranty'", userID, todayStart).Scan(&summary.TodayWarranty); err != nil {
		serverError(c, "my salary today warranty query", err)
		return
	}

	c.JSON(http.StatusOK, summary)
}
