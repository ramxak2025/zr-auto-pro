package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all application configuration, validated at startup.
type Config struct {
	DatabaseURL string
	JWTSecret   string
	Port        string

	// Pool settings
	PoolMaxConns     int32
	PoolMinConns     int32
	PoolMaxConnLife  time.Duration
	PoolMaxConnIdle  time.Duration
	PoolHealthCheck  time.Duration
	PoolConnTimeout  time.Duration
}

// Load reads environment variables and returns a validated Config.
// It fails fast if critical variables are misconfigured.
func Load() (*Config, error) {
	cfg := &Config{
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://postgres:postgres@postgres:5432/zr_auto_pro?sslmode=disable"),
		JWTSecret:       getEnv("JWT_SECRET", "change-me-in-production"),
		Port:            getEnv("PORT", "3000"),
		PoolMaxConns:    getEnvInt32("DB_POOL_MAX_CONNS", 25),
		PoolMinConns:    getEnvInt32("DB_POOL_MIN_CONNS", 5),
		PoolMaxConnLife: getEnvDuration("DB_POOL_MAX_CONN_LIFE", 5*time.Minute),
		PoolMaxConnIdle: getEnvDuration("DB_POOL_MAX_CONN_IDLE", 2*time.Minute),
		PoolHealthCheck: getEnvDuration("DB_POOL_HEALTH_CHECK", 30*time.Second),
		PoolConnTimeout: getEnvDuration("DB_POOL_CONN_TIMEOUT", 5*time.Second),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt32(key string, fallback int32) int32 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 32); err == nil {
			return int32(n)
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
