package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"zr-auto-pro/internal/database"
	"zr-auto-pro/internal/models"
)

func GetSchedule(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	dateFrom := c.DefaultQuery("dateFrom", time.Now().AddDate(0, 0, -7).Format("2006-01-02"))
	dateTo := c.DefaultQuery("dateTo", time.Now().AddDate(0, 0, 30).Format("2006-01-02"))

	rows, err := database.DB.Query(`
		SELECT se.id, se.user_id, u.full_name, se.date, COALESCE(se.shift_start,''), COALESCE(se.shift_end,''),
			   se.is_day_off, se.actual_arrival, se.late_minutes, se.late_status, COALESCE(se.note,''), se.is_manual_override
		FROM schedule_entries se LEFT JOIN users u ON u.id=se.user_id
		WHERE se.tenant_id=$1 AND se.date >= $2 AND se.date <= $3
		ORDER BY se.date, u.full_name
	`, tenantID, dateFrom, dateTo)
	if err != nil {
		serverError(c, "schedule query", err)
		return
	}
	defer rows.Close()

	entries := []models.ScheduleEntry{}
	for rows.Next() {
		var e models.ScheduleEntry
		var userName, shiftStart, shiftEnd, note string
		var lateStatus *string
		if err := rows.Scan(&e.ID, &e.UserID, &userName, &e.Date, &shiftStart, &shiftEnd,
			&e.IsDayOff, &e.ActualArrival, &e.LateMinutes, &lateStatus, &note, &e.IsManualOverride); err != nil {
			serverError(c, "schedule row scan", err)
			return
		}
		e.User = &models.User{ID: e.UserID, FullName: userName}
		if shiftStart != "" {
			e.ShiftStart = &shiftStart
		}
		if shiftEnd != "" {
			e.ShiftEnd = &shiftEnd
		}
		e.LateStatus = lateStatus
		if note != "" {
			e.Note = &note
		}
		e.TenantID = tenantID
		entries = append(entries, e)
	}
	c.JSON(http.StatusOK, entries)
}

func CreateScheduleEntry(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		UserID     string  `json:"userId"`
		Date       string  `json:"date"`
		ShiftStart *string `json:"shiftStart"`
		ShiftEnd   *string `json:"shiftEnd"`
		IsDayOff   bool    `json:"isDayOff"`
		Note       *string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	var e models.ScheduleEntry
	err := database.DB.QueryRow(`
		INSERT INTO schedule_entries (user_id, date, shift_start, shift_end, is_day_off, note, tenant_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, user_id, date
	`, body.UserID, body.Date, body.ShiftStart, body.ShiftEnd, body.IsDayOff, body.Note, tenantID).Scan(
		&e.ID, &e.UserID, &e.Date,
	)
	if err != nil {
		serverError(c, "create schedule entry", err)
		return
	}
	e.ShiftStart = body.ShiftStart
	e.ShiftEnd = body.ShiftEnd
	e.IsDayOff = body.IsDayOff
	e.Note = body.Note
	e.TenantID = tenantID
	c.JSON(http.StatusCreated, e)
}

func UpdateScheduleEntry(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body struct {
		ShiftStart *string `json:"shiftStart"`
		ShiftEnd   *string `json:"shiftEnd"`
		IsDayOff   *bool   `json:"isDayOff"`
		Note       *string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if _, err := database.DB.Exec(`
		UPDATE schedule_entries SET
			shift_start=COALESCE($1,shift_start), shift_end=COALESCE($2,shift_end),
			is_day_off=COALESCE($3,is_day_off), note=COALESCE($4,note), is_manual_override=true
		WHERE id=$5 AND tenant_id=$6
	`, body.ShiftStart, body.ShiftEnd, body.IsDayOff, body.Note, id, tenantID); err != nil {
		serverError(c, "update schedule entry", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Обновлено"})
}

func DeleteScheduleEntry(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	result, err := database.DB.Exec("DELETE FROM schedule_entries WHERE id=$1 AND tenant_id=$2", id, tenantID)
	if err != nil {
		serverError(c, "delete schedule entry", err)
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		serverError(c, "delete schedule entry rows affected", err)
		return
	}
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "Не найдено"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Удалено"})
}

func GetWorkModes(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	rows, err := database.DB.Query(`
		SELECT id, name, type, work_days, off_days, COALESCE(week_days,'[]'), shift_start, shift_end
		FROM work_modes WHERE tenant_id=$1 ORDER BY name
	`, tenantID)
	if err != nil {
		serverError(c, "work modes query", err)
		return
	}
	defer rows.Close()

	modes := []models.WorkMode{}
	for rows.Next() {
		var m models.WorkMode
		if err := rows.Scan(&m.ID, &m.Name, &m.Type, &m.WorkDays, &m.OffDays, &m.WeekDays, &m.ShiftStart, &m.ShiftEnd); err != nil {
			serverError(c, "work modes row scan", err)
			return
		}
		m.TenantID = tenantID
		modes = append(modes, m)
	}
	c.JSON(http.StatusOK, modes)
}

func CreateWorkMode(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	var body struct {
		Name       string          `json:"name"`
		Type       string          `json:"type"`
		WorkDays   int             `json:"workDays"`
		OffDays    int             `json:"offDays"`
		WeekDays   json.RawMessage `json:"weekDays"`
		ShiftStart string          `json:"shiftStart"`
		ShiftEnd   string          `json:"shiftEnd"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	wd := body.WeekDays
	if wd == nil {
		wd = json.RawMessage(`[]`)
	}

	var m models.WorkMode
	err := database.DB.QueryRow(`
		INSERT INTO work_modes (name, type, work_days, off_days, week_days, shift_start, shift_end, tenant_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, type, work_days, off_days, shift_start, shift_end
	`, body.Name, body.Type, body.WorkDays, body.OffDays, string(wd), body.ShiftStart, body.ShiftEnd, tenantID).Scan(
		&m.ID, &m.Name, &m.Type, &m.WorkDays, &m.OffDays, &m.ShiftStart, &m.ShiftEnd,
	)
	if err != nil {
		serverError(c, "create work mode", err)
		return
	}
	m.WeekDays = wd
	m.TenantID = tenantID
	c.JSON(http.StatusCreated, m)
}

func UpdateWorkMode(c *gin.Context) {
	id := c.Param("id")
	tenantID := c.GetString("tenantID")
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Неверный формат"})
		return
	}

	if name, ok := body["name"].(string); ok {
		if _, err := database.DB.Exec("UPDATE work_modes SET name=$1 WHERE id=$2 AND tenant_id=$3", name, id, tenantID); err != nil {
			serverError(c, "update work mode name", err)
			return
		}
	}
	if t, ok := body["type"].(string); ok {
		if _, err := database.DB.Exec("UPDATE work_modes SET type=$1 WHERE id=$2 AND tenant_id=$3", t, id, tenantID); err != nil {
			serverError(c, "update work mode type", err)
			return
		}
	}
	if ss, ok := body["shiftStart"].(string); ok {
		if _, err := database.DB.Exec("UPDATE work_modes SET shift_start=$1 WHERE id=$2 AND tenant_id=$3", ss, id, tenantID); err != nil {
			serverError(c, "update work mode shift_start", err)
			return
		}
	}
	if se, ok := body["shiftEnd"].(string); ok {
		if _, err := database.DB.Exec("UPDATE work_modes SET shift_end=$1 WHERE id=$2 AND tenant_id=$3", se, id, tenantID); err != nil {
			serverError(c, "update work mode shift_end", err)
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Обновлено"})
}

func GetTodaySchedule(c *gin.Context) {
	tenantID := c.GetString("tenantID")
	today := time.Now().Format("2006-01-02")

	rows, err := database.DB.Query(`
		SELECT u.id, u.full_name, u.role,
			   COALESCE(se.is_day_off, false),
			   se.shift_start, se.shift_end,
			   se.actual_arrival, COALESCE(se.late_minutes,0), se.late_status,
			   CASE WHEN se.id IS NOT NULL THEN true ELSE false END,
			   CASE WHEN s.id IS NOT NULL AND s.closed_at IS NULL THEN true ELSE false END
		FROM users u
		LEFT JOIN schedule_entries se ON se.user_id=u.id AND se.date=$2
		LEFT JOIN shifts s ON s.user_id=u.id AND s.date=$2 AND s.closed_at IS NULL
		WHERE u.tenant_id=$1 AND u.is_active=true AND u.role IN ('master','admin')
		ORDER BY u.full_name
	`, tenantID, today)
	if err != nil {
		serverError(c, "today schedule query", err)
		return
	}
	defer rows.Close()

	statuses := []models.TodayEmployeeStatus{}
	for rows.Next() {
		var s models.TodayEmployeeStatus
		if err := rows.Scan(&s.UserID, &s.FullName, &s.Role, &s.IsDayOff,
			&s.ShiftStart, &s.ShiftEnd, &s.ActualArrival,
			&s.LateMinutes, &s.LateStatus, &s.HasSchedule, &s.IsWorking); err != nil {
			serverError(c, "today schedule row scan", err)
			return
		}
		statuses = append(statuses, s)
	}
	c.JSON(http.StatusOK, statuses)
}

// GetMyStats returns schedule statistics for the current user
func GetMyStats(c *gin.Context) {
	userID := c.GetString("userID")
	tenantID := c.GetString("tenantID")

	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	type MyStats struct {
		TotalScheduled int `json:"totalScheduled"`
		TotalWorked    int `json:"totalWorked"`
		TotalLate      int `json:"totalLate"`
		TotalLateMinor int `json:"totalLateMinor"`
		TotalLateMajor int `json:"totalLateMajor"`
		TotalOnTime    int `json:"totalOnTime"`
		TotalDaysOff   int `json:"totalDaysOff"`
		AvgLateMinutes int `json:"avgLateMinutes"`
	}
	var stats MyStats

	if err := database.DB.QueryRow(`
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE NOT is_day_off),
			COUNT(*) FILTER (WHERE late_minutes > 0 AND NOT is_day_off),
			COUNT(*) FILTER (WHERE late_status = 'late_minor'),
			COUNT(*) FILTER (WHERE late_status = 'late_major'),
			COUNT(*) FILTER (WHERE late_status = 'on_time' OR (late_minutes = 0 AND NOT is_day_off AND actual_arrival IS NOT NULL)),
			COUNT(*) FILTER (WHERE is_day_off),
			COALESCE(AVG(late_minutes) FILTER (WHERE late_minutes > 0 AND NOT is_day_off), 0)
		FROM schedule_entries
		WHERE user_id=$1 AND tenant_id=$2 AND date >= $3 AND date <= $4
	`, userID, tenantID, monthStart.Format("2006-01-02"), now.Format("2006-01-02")).Scan(
		&stats.TotalScheduled, &stats.TotalWorked, &stats.TotalLate,
		&stats.TotalLateMinor, &stats.TotalLateMajor, &stats.TotalOnTime,
		&stats.TotalDaysOff, &stats.AvgLateMinutes,
	); err != nil {
		serverError(c, "my stats query", err)
		return
	}

	c.JSON(http.StatusOK, stats)
}
