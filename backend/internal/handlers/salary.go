package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetSalaries(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	dateFrom := c.DefaultQuery("dateFrom", time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.Now().Location()).Format("2006-01-02"))
	dateTo := c.DefaultQuery("dateTo", time.Now().Format("2006-01-02"))

	rows, _ := database.DB.Query(`
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

	salaries := []models.MasterSalary{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var s models.MasterSalary
			rows.Scan(&s.MasterID, &s.MasterName, &s.SalaryPercent, &s.TotalEarnings, &s.TotalRevenue, &s.CheckCount)
			salaries = append(salaries, s)
		}
	}
	c.JSON(http.StatusOK, salaries)
}

func GetMySalary(c *gin.Context) {
	userID := c.GetString("userID")
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekStart := todayStart.AddDate(0, 0, -int(now.Weekday()-1))
	if now.Weekday() == 0 {
		weekStart = todayStart.AddDate(0, 0, -6)
	}
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	var summary models.SalarySummary

	database.DB.QueryRow("SELECT full_name, salary_percent FROM users WHERE id=$1", userID).Scan(&summary.MasterName, &summary.SalaryPercent)

	database.DB.QueryRow("SELECT COALESCE(SUM(service_salary_total),0), COUNT(*) FROM checks WHERE master_id=$1 AND date >= $2", userID, todayStart).Scan(&summary.Today, &summary.TodayChecks)
	database.DB.QueryRow("SELECT COALESCE(SUM(service_salary_total),0) FROM checks WHERE master_id=$1 AND date >= $2", userID, weekStart).Scan(&summary.Week)
	database.DB.QueryRow("SELECT COALESCE(SUM(service_salary_total),0), COUNT(*) FROM checks WHERE master_id=$1 AND date >= $2", userID, monthStart).Scan(&summary.Month, &summary.MonthChecks)
	database.DB.QueryRow("SELECT COALESCE(SUM(service_salary_total),0) FROM checks WHERE master_id=$1", userID).Scan(&summary.Total)

	// Today payment methods
	database.DB.QueryRow("SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE master_id=$1 AND date >= $2 AND payment_method='cash'", userID, todayStart).Scan(&summary.TodayCash)
	database.DB.QueryRow("SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE master_id=$1 AND date >= $2 AND payment_method='card'", userID, todayStart).Scan(&summary.TodayCard)
	database.DB.QueryRow("SELECT COALESCE(SUM(total_revenue),0) FROM checks WHERE master_id=$1 AND date >= $2 AND payment_method='warranty'", userID, todayStart).Scan(&summary.TodayWarranty)

	c.JSON(http.StatusOK, summary)
}
