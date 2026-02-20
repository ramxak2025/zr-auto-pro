package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetFinancialReport(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	dateFrom := c.DefaultQuery("dateFrom", time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.Now().Location()).Format("2006-01-02"))
	dateTo := c.DefaultQuery("dateTo", time.Now().Format("2006-01-02"))

	var report models.FinancialReport
	report.DateFrom = dateFrom
	report.DateTo = dateTo

	if err := database.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(total_revenue),0), COALESCE(SUM(product_cost_total),0),
			   COALESCE(SUM(service_salary_total),0), COALESCE(SUM(profit),0), COUNT(*)
		FROM checks WHERE tenant_id=$1 AND date >= $2 AND date <= $3::date + interval '1 day' AND is_deferred=false
	`, tenantID, dateFrom, dateTo).Scan(
		&report.Revenue, &report.ProductCost, &report.Salaries, &report.NetProfit, &report.CheckCount,
	); err != nil {
		serverError(c, "financial report query", err)
		return
	}
	report.GrossProfit = report.Revenue - report.ProductCost
	report.NetProfit = report.GrossProfit - report.Salaries

	c.JSON(http.StatusOK, report)
}

func GetCashFlow(c *gin.Context) {
	ctx := c.Request.Context()
	tenantID := c.GetString("tenantID")
	dateFrom := c.DefaultQuery("dateFrom", time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.Now().Location()).Format("2006-01-02"))
	dateTo := c.DefaultQuery("dateTo", time.Now().Format("2006-01-02"))

	rows, err := database.Pool.Query(ctx, `
		SELECT date::date,
			   COALESCE(SUM(CASE WHEN payment_method='cash' THEN total_revenue ELSE 0 END),0),
			   COALESCE(SUM(CASE WHEN payment_method='card' THEN total_revenue ELSE 0 END),0),
			   COALESCE(SUM(CASE WHEN payment_method='warranty' THEN total_revenue ELSE 0 END),0),
			   COALESCE(SUM(total_revenue),0)
		FROM checks WHERE tenant_id=$1 AND date >= $2 AND date <= $3::date + interval '1 day' AND is_deferred=false
		GROUP BY date::date ORDER BY date::date
	`, tenantID, dateFrom, dateTo)
	if err != nil {
		serverError(c, "cash flow query", err)
		return
	}
	defer rows.Close()

	data := models.CashFlowData{Days: []models.CashFlowDay{}}
	for rows.Next() {
		var d models.CashFlowDay
		var dt time.Time
		if err := rows.Scan(&dt, &d.Cash, &d.Card, &d.Warranty, &d.Total); err != nil {
			serverError(c, "cash flow row scan", err)
			return
		}
		d.Date = dt.Format("2006-01-02")
		data.Days = append(data.Days, d)
		data.Totals.Cash += d.Cash
		data.Totals.Card += d.Card
		data.Totals.Warranty += d.Warranty
		data.Totals.Total += d.Total
	}
	data.Totals.Date = "total"

	c.JSON(http.StatusOK, data)
}
