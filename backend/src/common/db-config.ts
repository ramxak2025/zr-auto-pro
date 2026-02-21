import { PoolConfig } from 'pg';

export function getDbConfig(): PoolConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return { connectionString: databaseUrl, max: 20, idleTimeoutMillis: 30000 };
  }
  return {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'zr_auto_pro',
    max: 20,
    idleTimeoutMillis: 30000,
  };
}
