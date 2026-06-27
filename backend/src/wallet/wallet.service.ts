import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { UpdateWalletSettingsDto } from './dto/update-wallet-settings.dto';
import { buildLoyaltyPass } from './pass-builder';

/**
 * Apple Wallet — карта лояльности (.pkpass). Per-tenant config + on-demand,
 * server-signed store-card generation.
 *
 * OWNS `wallet_settings`. READS (read-only) `clients`, `client_bonuses` and
 * `tenants` to fill the card — it NEVER writes to the loyalty ledger or any other
 * module's table. The bonus balance is computed with the same Σaccrual−Σredemption
 * formula loyalty/ uses.
 *
 * INERT by default: a fresh tenant has no row ⇒ enabled=false, no certs ⇒
 * GET /wallet/pass/:clientId returns 422 with a clear message. Nothing produces a
 * usable pass until the owner uploads a real Pass Type ID cert + key + Apple WWDR
 * cert AND flips `enabled` on.
 *
 * The cert/key/password/WWDR are SERVER SECRETS: stored as-is, NEVER returned to a
 * client (only boolean "stored" flags) and NEVER logged.
 */

/** Internal, secret-bearing config row. NEVER returned to a client as-is. */
interface RawWalletConfig {
  enabled: boolean;
  passTypeId: string | null;
  teamId: string | null;
  organizationName: string | null;
  certPem: string | null;
  certKeyPem: string | null;
  certKeyPassword: string | null;
  wwdrPem: string | null;
  logoUrl: string | null;
  bgColor: string | null;
  updatedAt: string | null;
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger('WalletService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Config ──────────────────────────────────────────────────────────────

  /** Load the raw (secret-bearing) config, or sane defaults when no row exists. */
  private async loadConfig(tenantId: string): Promise<RawWalletConfig> {
    const { rows } = await this.pool.query(
      `SELECT enabled, pass_type_id, team_id, organization_name, cert_pem, cert_key_pem,
              cert_key_password, wwdr_pem, logo_url, bg_color, updated_at
         FROM wallet_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    if (rows.length === 0) {
      return {
        enabled: false,
        passTypeId: null,
        teamId: null,
        organizationName: null,
        certPem: null,
        certKeyPem: null,
        certKeyPassword: null,
        wwdrPem: null,
        logoUrl: null,
        bgColor: null,
        updatedAt: null,
      };
    }
    const r = rows[0];
    return {
      enabled: r.enabled === true,
      passTypeId: r.pass_type_id ?? null,
      teamId: r.team_id ?? null,
      organizationName: r.organization_name ?? null,
      certPem: r.cert_pem ?? null,
      certKeyPem: r.cert_key_pem ?? null,
      certKeyPassword: r.cert_key_password ?? null,
      wwdrPem: r.wwdr_pem ?? null,
      logoUrl: r.logo_url ?? null,
      bgColor: r.bg_color ?? null,
      updatedAt: r.updated_at ?? null,
    };
  }

  /** True when a real pass can actually be generated for this tenant. */
  private isConfigured(cfg: RawWalletConfig): boolean {
    return !!(cfg.enabled && cfg.passTypeId && cfg.teamId && cfg.certPem && cfg.certKeyPem && cfg.wwdrPem);
  }

  /**
   * Public settings shape returned to owner-class clients. The cert/key/password/
   * WWDR are NEVER included — only boolean "stored" flags. (A PEM private key has no
   * meaningful last-4 mask; a flag is the correct masking here.)
   */
  private maskedSettings(cfg: RawWalletConfig) {
    return {
      enabled: cfg.enabled,
      passTypeId: cfg.passTypeId,
      teamId: cfg.teamId,
      organizationName: cfg.organizationName,
      logoUrl: cfg.logoUrl,
      bgColor: cfg.bgColor,
      hasCert: !!cfg.certPem,
      hasCertKey: !!cfg.certKeyPem,
      hasCertKeyPassword: !!cfg.certKeyPassword,
      hasWwdr: !!cfg.wwdrPem,
      configured: this.isConfigured(cfg),
      updatedAt: cfg.updatedAt,
    };
  }

  async getSettings(tenantId: string) {
    return this.maskedSettings(await this.loadConfig(tenantId));
  }

  async updateSettings(tenantId: string, dto: UpdateWalletSettingsDto) {
    // Ensure a config row exists (all columns have DB defaults), then UPDATE only
    // the columns the caller actually sent — keeps the SET placeholders aligned with
    // their values (mirrors the payments/fiscal settings path).
    await this.pool.query(`INSERT INTO wallet_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [
      tenantId,
    ]);

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.enabled !== undefined) {
      sets.push(`enabled = $${idx++}`);
      vals.push(dto.enabled);
    }

    // Semi-public config: empty string clears, value sets.
    const pushTrimmed = (col: string, value: string | undefined) => {
      if (value !== undefined) {
        sets.push(`${col} = $${idx++}`);
        vals.push(value.trim() || null);
      }
    };
    pushTrimmed('pass_type_id', dto.passTypeId);
    pushTrimmed('team_id', dto.teamId);
    pushTrimmed('organization_name', dto.organizationName);
    pushTrimmed('logo_url', dto.logoUrl);
    pushTrimmed('bg_color', dto.bgColor);

    // Secrets: overwritten ONLY when a NON-EMPTY string is sent, so re-saving the
    // form (which shows a flag, not the real PEM) never wipes a stored certificate.
    const pushSecret = (col: string, value: string | undefined) => {
      const next = typeof value === 'string' ? value.trim() : '';
      if (next) {
        sets.push(`${col} = $${idx++}`);
        vals.push(next);
      }
    };
    pushSecret('cert_pem', dto.certPem);
    pushSecret('cert_key_pem', dto.certKeyPem);
    pushSecret('cert_key_password', dto.certKeyPassword);
    pushSecret('wwdr_pem', dto.wwdrPem);

    sets.push(`updated_at = now()`);
    vals.push(tenantId);

    await this.pool.query(`UPDATE wallet_settings SET ${sets.join(', ')} WHERE tenant_id = $${idx}`, vals);

    return this.getSettings(tenantId);
  }

  // ─── Reads (read-only over clients / bonuses / tenants) ─────────────────────

  /** Assert the client exists in this tenant; return display name + phone. */
  private async requireClient(tenantId: string, clientId: string): Promise<{ name: string; phone: string | null }> {
    const { rows } = await this.pool.query(`SELECT full_name, phone FROM clients WHERE id = $1 AND tenant_id = $2`, [
      clientId,
      tenantId,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    return { name: rows[0].full_name as string, phone: (rows[0].phone as string) ?? null };
  }

  /** Σaccrual − Σredemption for one client (the loyalty balance). Read-only. */
  private async balanceOf(tenantId: string, clientId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'accrual' THEN amount ELSE -amount END), 0) AS balance
         FROM client_bonuses WHERE tenant_id = $1 AND client_id = $2`,
      [tenantId, clientId],
    );
    return round2(num(rows[0].balance));
  }

  /** Tenant display name for the shop / organization label. Read-only. */
  private async tenantName(tenantId: string): Promise<string | null> {
    const { rows } = await this.pool.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
    return rows.length ? ((rows[0].name as string) ?? null) : null;
  }

  // ─── Pass generation ───────────────────────────────────────────────────────

  /**
   * Build + sign the client's loyalty .pkpass for this tenant. Returns the raw
   * bytes and a download filename. 422 when the module is disabled or the cert
   * bundle is incomplete; 404 when the client is not in this tenant.
   */
  async generatePass(tenantId: string, clientId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const cfg = await this.loadConfig(tenantId);

    if (!cfg.enabled) {
      throw new UnprocessableEntityException({
        message: 'Apple Wallet отключён. Включите карты лояльности в настройках.',
      });
    }
    if (!cfg.passTypeId || !cfg.teamId || !cfg.certPem || !cfg.certKeyPem || !cfg.wwdrPem) {
      throw new UnprocessableEntityException({
        message: 'Apple Wallet не настроен: загрузите сертификат Pass Type ID, приватный ключ и сертификат Apple WWDR.',
      });
    }

    const client = await this.requireClient(tenantId, clientId);
    const balance = await this.balanceOf(tenantId, clientId);
    const shopName = (cfg.organizationName || (await this.tenantName(tenantId)) || 'Автосервис').trim();

    try {
      const buffer = await buildLoyaltyPass({
        passTypeId: cfg.passTypeId,
        teamId: cfg.teamId,
        certPem: cfg.certPem,
        certKeyPem: cfg.certKeyPem,
        certKeyPassword: cfg.certKeyPassword,
        wwdrPem: cfg.wwdrPem,
        organizationName: cfg.organizationName?.trim() || shopName,
        shopName,
        clientId,
        clientName: client.name,
        clientPhone: client.phone,
        balance,
        bgColor: cfg.bgColor,
      });
      return { buffer, fileName: `loyalty-${clientId}.pkpass` };
    } catch (err) {
      // The signer threw — almost always an invalid / mismatched certificate bundle.
      // Log WITHOUT any secret material (no cert/key/password is ever interpolated).
      this.logger.warn(
        `Wallet pass generation failed for tenant ${tenantId}, client ${clientId}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      throw new UnprocessableEntityException({
        message: 'Не удалось сформировать карту: проверьте сертификат Pass Type ID и приватный ключ.',
      });
    }
  }
}
