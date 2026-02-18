package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetShifts(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	rows, _ := database.DB.Query(`
		SELECT s.id, s.user_id, u.full_name, s.date, s.opened_at, s.closed_at, s.is_auto_closed, COALESCE(s.note,'')
		FROM shifts s LEFT JOIN users u ON u.id=s.user_id
		WHERE s.tenant_id=$1 ORDER BY s.opened_at DESC LIMIT 100
	`, tenantID)

	shifts := []models.Shift{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var s models.Shift
			var userName, note string
			rows.Scan(&s.ID, &s.UserID, &userName, &s.Date, &s.OpenedAt, &s.ClosedAt, &s.IsAutoClosed, &note)
			s.User = &models.User{ID: s.UserID, FullName: userName}
			if note != "" {
				s.Note = &note
			}
			s.TenantID = tenantID
			shifts = append(shifts, s)
		}
	}
	c.JSON(http.StatusOK, shifts)
}

func GetMyShifts(c *gin.Context) {
	userID := c.GetString("userID")
	tenantID := c.GetString("tenantID")
	rows, _ := database.DB.Query(`
		SELECT id, user_id, date, opened_at, closed_at, is_auto_closed, COALESCE(note,'')
		FROM shifts WHERE user_id=$1 AND tenant_id=$2 ORDER BY opened_at DESC LIMIT 30
	`, userID, tenantID)

	shifts := []models.Shift{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var s models.Shift
			var note string
			rows.Scan(&s.ID, &s.UserID, &s.Date, &s.OpenedAt, &s.ClosedAt, &s.IsAutoClosed, &note)
			if note != "" {
				s.Note = &note
			}
			s.TenantID = tenantID
			shifts = append(shifts, s)
		}
	}
	c.JSON(http.StatusOK, shifts)
}

func OpenShift(c *gin.Context) {
	userID := c.GetString("userID")
	tenantID := c.GetString("tenantID")

	// Check if already open
	var openCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM shifts WHERE user_id=$1 AND tenant_id=$2 AND closed_at IS NULL", userID, tenantID).Scan(&openCount)
	if openCount > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Смена уже открыта"})
		return
	}

	var s models.Shift
	now := time.Now()
	database.DB.QueryRow(`
		INSERT INTO shifts (user_id, date, opened_at, tenant_id) VALUES ($1,$2,$3,$4) RETURNING id, user_id, date, opened_at
	`, userID, now.Format("2006-01-02"), now, tenantID).Scan(&s.ID, &s.UserID, &s.Date, &s.OpenedAt)
	s.TenantID = tenantID
	c.JSON(http.StatusCreated, s)
}

func CloseShift(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")

	now := time.Now()
	database.DB.Exec("UPDATE shifts SET closed_at=$1 WHERE id=$2 AND tenant_id=$3", now, id, tenantID)

	var s models.Shift
	database.DB.QueryRow("SELECT id, user_id, date, opened_at, closed_at, is_auto_closed FROM shifts WHERE id=$1", id).Scan(
		&s.ID, &s.UserID, &s.Date, &s.OpenedAt, &s.ClosedAt, &s.IsAutoClosed,
	)
	s.TenantID = tenantID
	c.JSON(http.StatusOK, s)
}
