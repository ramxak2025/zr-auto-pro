import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { AppModule } from './app.module';

/**
 * Pre-startup migration: converts old PostgreSQL enum columns to varchar
 * so TypeORM synchronize can work with the updated entity definitions.
 * Safe to run multiple times — does nothing if already migrated.
 */
async function migrateEnumsToVarchar() {
  const logger = new Logger('Migration');

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'zr_auto_pro',
  });

  try {
    await client.connect();
    logger.log('Running pre-startup migration...');

    // List of enum columns to convert to varchar
    const migrations = [
      {
        table: 'users',
        column: 'role',
        enumType: 'users_role_enum',
        defaultVal: "'master'",
        length: 30,
      },
      {
        table: 'checks',
        column: '"paymentMethod"',
        enumType: 'checks_paymentmethod_enum',
        defaultVal: "'cash'",
        length: 20,
      },
      {
        table: 'deliveries',
        column: '"paymentStatus"',
        enumType: 'deliveries_paymentstatus_enum',
        defaultVal: "'unpaid'",
        length: 20,
      },
      {
        table: 'stock_movements',
        column: 'type',
        enumType: 'stock_movements_type_enum',
        defaultVal: "'income'",
        length: 20,
      },
    ];

    for (const m of migrations) {
      // Check if the enum type exists
      const enumCheck = await client.query(
        `SELECT 1 FROM pg_type WHERE typname = $1`,
        [m.enumType],
      );

      if (enumCheck.rowCount > 0) {
        logger.log(`Migrating ${m.table}.${m.column} from enum to varchar...`);

        // Check if table exists first
        const tableCheck = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
          [m.table],
        );

        if (tableCheck.rowCount > 0) {
          await client.query(`
            ALTER TABLE "${m.table}"
            ALTER COLUMN ${m.column} SET DATA TYPE varchar(${m.length})
            USING ${m.column}::text
          `);
          await client.query(`
            ALTER TABLE "${m.table}"
            ALTER COLUMN ${m.column} SET DEFAULT ${m.defaultVal}
          `);
        }

        // Drop the old enum type
        await client.query(`DROP TYPE IF EXISTS "${m.enumType}" CASCADE`);
        logger.log(`Migrated ${m.table}.${m.column} successfully`);
      }
    }

    // Handle old check.number generated column issue
    const checksTable = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'checks'`,
    );
    if (checksTable.rowCount > 0) {
      try {
        const colInfo = await client.query(`
          SELECT is_identity FROM information_schema.columns
          WHERE table_name = 'checks' AND column_name = 'number'
        `);
        if (colInfo.rows[0]?.is_identity === 'YES') {
          await client.query(
            `ALTER TABLE "checks" ALTER COLUMN "number" DROP IDENTITY IF EXISTS`,
          );
          logger.log('Removed identity from checks.number');
        }
      } catch {
        // column might not exist yet — fine
      }
    }

    logger.log('Pre-startup migration complete');
  } catch (error) {
    logger.warn(`Migration warning (non-fatal): ${error.message}`);
  } finally {
    await client.end();
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Run enum→varchar migration BEFORE NestJS/TypeORM starts
  await migrateEnumsToVarchar();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Server running on port ${port}`);
}
bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
