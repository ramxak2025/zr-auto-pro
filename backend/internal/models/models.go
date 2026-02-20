package models

import (
	"encoding/json"
	"time"
)

type Plan struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	MonthlyPrice float64         `json:"monthlyPrice"`
	Description  *string         `json:"description,omitempty"`
	Features     json.RawMessage `json:"features"`
	MaxUsers     int             `json:"maxUsers"`
	IsActive     bool            `json:"isActive"`
	SortOrder    int             `json:"sortOrder"`
	CreatedAt    time.Time       `json:"createdAt"`
}

type Tenant struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Slug             *string    `json:"slug,omitempty"`
	Phone            *string    `json:"phone,omitempty"`
	Address          *string    `json:"address,omitempty"`
	Email            *string    `json:"email,omitempty"`
	Description      *string    `json:"description,omitempty"`
	Logo             *string    `json:"logo,omitempty"`
	IsActive         bool       `json:"isActive"`
	MaxUsers         int        `json:"maxUsers"`
	PlanID           *string    `json:"planId,omitempty"`
	Plan             *Plan      `json:"plan,omitempty"`
	MonthlyPrice     float64    `json:"monthlyPrice"`
	SubscriptionEnd  *time.Time `json:"subscriptionEnd"`
	SubscriptionNote *string    `json:"subscriptionNote"`
	Users            []User     `json:"users,omitempty"`
	UserCount        *int       `json:"userCount,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type User struct {
	ID            string          `json:"id"`
	Phone         string          `json:"phone"`
	Password      string          `json:"-"`
	FullName      string          `json:"fullName"`
	Username      *string         `json:"username,omitempty"`
	Avatar        *string         `json:"avatar,omitempty"`
	Role          string          `json:"role"`
	SalaryPercent float64         `json:"salaryPercent"`
	Permissions   json.RawMessage `json:"permissions"`
	IsActive      bool            `json:"isActive"`
	TenantID      *string         `json:"tenantId,omitempty"`
	Tenant        *Tenant         `json:"tenant,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type Client struct {
	ID        string   `json:"id"`
	FullName  string   `json:"fullName"`
	Phone     string   `json:"phone"`
	Comment   *string  `json:"comment,omitempty"`
	TenantID  string   `json:"-"`
	Cars      []Car    `json:"cars,omitempty"`
	Checks    []Check  `json:"checks,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Car struct {
	ID          string  `json:"id"`
	PlateNumber string  `json:"plateNumber"`
	MakeModel   string  `json:"makeModel"`
	Comment     *string `json:"comment,omitempty"`
	ClientID    string  `json:"clientId"`
	Client      *Client `json:"client,omitempty"`
	TenantID    string  `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Service struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Category     *string   `json:"category,omitempty"`
	DefaultPrice float64   `json:"defaultPrice"`
	TenantID     string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Product struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Category    *string         `json:"category,omitempty"`
	Photo       *string         `json:"photo,omitempty"`
	CostPrice   float64         `json:"costPrice"`
	SellPrice   float64         `json:"sellPrice"`
	Stock       int             `json:"stock"`
	MinStock    int             `json:"minStock"`
	Unit        string          `json:"unit"`
	IsBundle    bool            `json:"isBundle"`
	BundleItems json.RawMessage `json:"bundleItems"`
	SupplierID  *string         `json:"supplierId,omitempty"`
	Supplier    *Supplier       `json:"supplier,omitempty"`
	TenantID    string          `json:"-"`
	CreatedAt   time.Time       `json:"createdAt"`
}

type Check struct {
	ID                string             `json:"id"`
	Number            int                `json:"number"`
	Date              time.Time          `json:"date"`
	MasterID          string             `json:"masterId"`
	Master            *User              `json:"master,omitempty"`
	ClientID          string             `json:"clientId"`
	Client            *Client            `json:"client,omitempty"`
	CarID             string             `json:"carId"`
	Car               *Car               `json:"car,omitempty"`
	Mileage           *int               `json:"mileage,omitempty"`
	Comment           *string            `json:"comment,omitempty"`
	Discount          float64            `json:"discount"`
	IsDeferred        bool               `json:"isDeferred"`
	PaymentMethod     string             `json:"paymentMethod"`
	CashAmount        float64            `json:"cashAmount"`
	CardAmount        float64            `json:"cardAmount"`
	ServiceTotal      float64            `json:"serviceTotal"`
	ProductTotal      float64            `json:"productTotal"`
	TotalRevenue      float64            `json:"totalRevenue"`
	ProductCostTotal  float64            `json:"productCostTotal"`
	ServiceSalaryTotal float64           `json:"serviceSalaryTotal"`
	TotalCost         float64            `json:"totalCost"`
	Profit            float64            `json:"profit"`
	Services          []CheckServiceLine `json:"services"`
	Products          []CheckProductLine `json:"products"`
	TenantID          string             `json:"-"`
	CreatedAt         time.Time          `json:"createdAt"`
}

type CheckServiceLine struct {
	ID        string  `json:"id"`
	CheckID   string  `json:"-"`
	ServiceID *string `json:"serviceId,omitempty"`
	MasterID  *string `json:"masterId,omitempty"`
	Master    *User   `json:"master,omitempty"`
	Name      string  `json:"name"`
	Price     float64 `json:"price"`
	Quantity  int     `json:"quantity"`
	Total     float64 `json:"total"`
}

type CheckProductLine struct {
	ID        string  `json:"id"`
	CheckID   string  `json:"-"`
	ProductID *string `json:"productId,omitempty"`
	Name      string  `json:"name"`
	SellPrice float64 `json:"sellPrice"`
	CostPrice float64 `json:"costPrice"`
	Quantity  int     `json:"quantity"`
	TotalSell float64 `json:"totalSell"`
	TotalCost float64 `json:"totalCost"`
}

type Supplier struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Phone          *string   `json:"phone,omitempty"`
	ContactPerson  *string   `json:"contactPerson,omitempty"`
	Comment        *string   `json:"comment,omitempty"`
	TotalPurchases float64   `json:"totalPurchases"`
	TotalPaid      float64   `json:"totalPaid"`
	CurrentDebt    float64   `json:"currentDebt"`
	TenantID       string    `json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Delivery struct {
	ID            string         `json:"id"`
	SupplierID    string         `json:"supplierId"`
	Supplier      *Supplier      `json:"supplier,omitempty"`
	Date          time.Time      `json:"date"`
	Items         []DeliveryItem `json:"items"`
	TotalAmount   float64        `json:"totalAmount"`
	PaymentStatus string         `json:"paymentStatus"`
	Comment       *string        `json:"comment,omitempty"`
	TenantID      string         `json:"-"`
}

type DeliveryItem struct {
	ID         string   `json:"id"`
	DeliveryID string   `json:"-"`
	ProductID  string   `json:"productId"`
	Product    *Product `json:"product,omitempty"`
	Quantity   int      `json:"quantity"`
	Price      float64  `json:"price"`
	Total      float64  `json:"total"`
}

type SupplierPayment struct {
	ID         string    `json:"id"`
	SupplierID string    `json:"supplierId"`
	Amount     float64   `json:"amount"`
	Date       time.Time `json:"date"`
	Comment    *string   `json:"comment,omitempty"`
	TenantID   string    `json:"-"`
}

type StockMovement struct {
	ID          string    `json:"id"`
	ProductID   string    `json:"productId"`
	Product     *Product  `json:"product,omitempty"`
	Type        string    `json:"type"`
	Quantity    int       `json:"quantity"`
	StockBefore int       `json:"stockBefore"`
	StockAfter  int       `json:"stockAfter"`
	Reason      *string   `json:"reason,omitempty"`
	TenantID    string    `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Shift struct {
	ID           string     `json:"id"`
	UserID       string     `json:"userId"`
	User         *User      `json:"user,omitempty"`
	Date         string     `json:"date"`
	OpenedAt     time.Time  `json:"openedAt"`
	ClosedAt     *time.Time `json:"closedAt"`
	IsAutoClosed bool       `json:"isAutoClosed"`
	Note         *string    `json:"note,omitempty"`
	TenantID     string     `json:"tenantId"`
}

type ScheduleEntry struct {
	ID               string     `json:"id"`
	UserID           string     `json:"userId"`
	User             *User      `json:"user,omitempty"`
	Date             string     `json:"date"`
	ShiftStart       *string    `json:"shiftStart"`
	ShiftEnd         *string    `json:"shiftEnd"`
	IsDayOff         bool       `json:"isDayOff"`
	ActualArrival    *time.Time `json:"actualArrival"`
	LateMinutes      int        `json:"lateMinutes"`
	LateStatus       *string    `json:"lateStatus"`
	Note             *string    `json:"note,omitempty"`
	IsManualOverride bool       `json:"isManualOverride"`
	TenantID         string     `json:"tenantId"`
}

type WorkMode struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Type       string          `json:"type"`
	WorkDays   int             `json:"workDays"`
	OffDays    int             `json:"offDays"`
	WeekDays   json.RawMessage `json:"weekDays"`
	ShiftStart string          `json:"shiftStart"`
	ShiftEnd   string          `json:"shiftEnd"`
	TenantID   string          `json:"tenantId"`
}

// Request/Response types
type LoginRequest struct {
	Phone    string `json:"phone" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type RegisterRequest struct {
	Phone      string `json:"phone" binding:"required"`
	Password   string `json:"password" binding:"required"`
	FullName   string `json:"fullName" binding:"required"`
	TenantName string `json:"tenantName"`
}

type PaginatedResponse struct {
	Data  interface{} `json:"data"`
	Total int         `json:"total"`
	Page  int         `json:"page"`
	Limit int         `json:"limit"`
}

type DashboardStats struct {
	TodayRevenue float64 `json:"todayRevenue"`
	TodayChecks  int     `json:"todayChecks"`
	WeekRevenue  float64 `json:"weekRevenue"`
	MonthRevenue float64 `json:"monthRevenue"`
	TodayProfit  float64 `json:"todayProfit"`
	MonthProfit  float64 `json:"monthProfit"`
}

type EmployeeRankEntry struct {
	MasterID   string  `json:"masterId"`
	MasterName string  `json:"masterName"`
	Revenue    float64 `json:"revenue"`
	CheckCount int     `json:"checkCount"`
}

type EmployeeRanking struct {
	Today []EmployeeRankEntry `json:"today"`
	Month []EmployeeRankEntry `json:"month"`
}

type SalarySummary struct {
	Today         float64 `json:"today"`
	Week          float64 `json:"week"`
	Month         float64 `json:"month"`
	Total         float64 `json:"total"`
	MasterName    string  `json:"masterName"`
	SalaryPercent float64 `json:"salaryPercent"`
	TodayChecks   int     `json:"todayChecks"`
	MonthChecks   int     `json:"monthChecks"`
	TodayCash     float64 `json:"todayCash"`
	TodayCard     float64 `json:"todayCard"`
	TodayWarranty float64 `json:"todayWarranty"`
}

type MasterSalary struct {
	MasterID      string  `json:"masterId"`
	MasterName    string  `json:"masterName"`
	SalaryPercent float64 `json:"salaryPercent"`
	TotalEarnings float64 `json:"totalEarnings"`
	TotalRevenue  float64 `json:"totalRevenue"`
	CheckCount    int     `json:"checkCount"`
}

type FinancialReport struct {
	DateFrom    string  `json:"dateFrom"`
	DateTo      string  `json:"dateTo"`
	Revenue     float64 `json:"revenue"`
	ProductCost float64 `json:"productCost"`
	Salaries    float64 `json:"salaries"`
	GrossProfit float64 `json:"grossProfit"`
	NetProfit   float64 `json:"netProfit"`
	CheckCount  int     `json:"checkCount"`
}

type CashFlowDay struct {
	Date     string  `json:"date"`
	Cash     float64 `json:"cash"`
	Card     float64 `json:"card"`
	Warranty float64 `json:"warranty"`
	Total    float64 `json:"total"`
}

type CashFlowData struct {
	Days   []CashFlowDay `json:"days"`
	Totals CashFlowDay   `json:"totals"`
}

type TodayEmployeeStatus struct {
	UserID        string  `json:"userId"`
	FullName      string  `json:"fullName"`
	Role          string  `json:"role"`
	IsDayOff      bool    `json:"isDayOff"`
	ShiftStart    *string `json:"shiftStart"`
	ShiftEnd      *string `json:"shiftEnd"`
	ActualArrival *string `json:"actualArrival"`
	LateMinutes   int     `json:"lateMinutes"`
	LateStatus    *string `json:"lateStatus"`
	IsWorking     bool    `json:"isWorking"`
	HasSchedule   bool    `json:"hasSchedule"`
}

type CreateCheckRequest struct {
	Date          string                    `json:"date"`
	MasterID      string                    `json:"masterId"`
	ClientID      string                    `json:"clientId"`
	CarID         string                    `json:"carId"`
	Mileage       *int                      `json:"mileage"`
	Comment       *string                   `json:"comment"`
	Discount      float64                   `json:"discount"`
	IsDeferred    bool                      `json:"isDeferred"`
	PaymentMethod string                    `json:"paymentMethod"`
	CashAmount    float64                   `json:"cashAmount"`
	CardAmount    float64                   `json:"cardAmount"`
	Services      []CreateCheckServiceLine  `json:"services"`
	Products      []CreateCheckProductLine  `json:"products"`
}

type CreateCheckServiceLine struct {
	ServiceID *string `json:"serviceId"`
	MasterID  *string `json:"masterId"`
	Name      string  `json:"name"`
	Price     float64 `json:"price"`
	Quantity  int     `json:"quantity"`
}

type CreateCheckProductLine struct {
	ProductID *string `json:"productId"`
	Name      string  `json:"name"`
	SellPrice float64 `json:"sellPrice"`
	CostPrice float64 `json:"costPrice"`
	Quantity  int     `json:"quantity"`
}

type TenantStats struct {
	TotalTenants  int `json:"totalTenants"`
	ActiveTenants int `json:"activeTenants"`
	TotalUsers    int `json:"totalUsers"`
}
