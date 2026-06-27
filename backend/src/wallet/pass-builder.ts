import { PKPass } from 'passkit-generator';
import sharp from 'sharp';

/**
 * Apple Wallet store-card (.pkpass) builder for the loyalty / bonus card.
 *
 * Signing approach: `passkit-generator` builds the .pkpass ZIP and produces a
 * PKCS#7 *detached* signature over `manifest.json` (a SHA-1 digest of every file in
 * the bundle), using the tenant's Pass Type ID certificate + private key and the
 * Apple WWDR intermediate to complete the chain. That is exactly the signature
 * Apple Wallet verifies, so the resulting bytes install on a real iPhone — once the
 * owner has uploaded a REAL Pass Type ID cert (+ key) and the WWDR cert. With a fake
 * / missing cert the underlying signer throws, which the service maps to a 422.
 *
 * This module is pure (no DB, no secrets-at-rest): the service passes the resolved
 * config + the already-read bonus balance in. It NEVER logs the cert/key/password.
 */

export interface BuildLoyaltyPassInput {
  // Apple identity / signing material (resolved from the tenant config).
  passTypeId: string;
  teamId: string;
  certPem: string;
  certKeyPem: string;
  certKeyPassword?: string | null;
  wwdrPem: string;

  // Card content.
  organizationName: string;
  shopName: string;
  clientId: string;
  clientName: string;
  clientPhone?: string | null;
  /** Current bonus balance (Σaccrual − Σredemption) — already computed, read-only. */
  balance: number;

  // Optional branding.
  bgColor?: string | null;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse '#1E88E5' / '1e88e5' → {r,g,b}; fall back to a dark slate when invalid. */
function parseHexColor(hex: string | null | undefined, fallback: Rgb): Rgb {
  if (!hex) return fallback;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return fallback;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

const rgbCss = ({ r, g, b }: Rgb): string => `rgb(${r}, ${g}, ${b})`;

/** Group thousands with a non-breaking space (locale-independent, no Intl/ICU dep). */
function formatNumber(n: number): string {
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const [intPart, fracPart] = String(Math.abs(rounded)).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = rounded < 0 ? '-' : '';
  return fracPart ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`;
}

/** A solid-color square PNG used as a deterministic, self-contained icon/logo. */
function solidPng(width: number, height: number, bg: Rgb): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { ...bg, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/**
 * Build and SIGN a storeCard .pkpass. Returns the raw .pkpass bytes (a signed ZIP).
 * Throws if the certificate / key / WWDR are invalid (caller maps that to a 422).
 */
export async function buildLoyaltyPass(input: BuildLoyaltyPassInput): Promise<Buffer> {
  const bg = parseHexColor(input.bgColor, { r: 28, g: 32, b: 40 });

  // Required Apple asset is `icon.png`; we supply the @2x/@3x variants and a logo so
  // the card renders cleanly. These are solid-color placeholders the owner can later
  // replace with branded artwork — they make the pass VALID, not pretty.
  const [icon, icon2x, icon3x, logo, logo2x] = await Promise.all([
    solidPng(29, 29, bg),
    solidPng(58, 58, bg),
    solidPng(87, 87, bg),
    solidPng(160, 50, bg),
    solidPng(320, 100, bg),
  ]);

  const pass = new PKPass(
    {
      'icon.png': icon,
      'icon@2x.png': icon2x,
      'icon@3x.png': icon3x,
      'logo.png': logo,
      'logo@2x.png': logo2x,
    },
    {
      wwdr: input.wwdrPem,
      signerCert: input.certPem,
      signerKey: input.certKeyPem,
      signerKeyPassphrase: input.certKeyPassword || undefined,
    },
    {
      serialNumber: input.clientId,
      description: `${input.shopName} — карта лояльности`,
      organizationName: input.organizationName,
      passTypeIdentifier: input.passTypeId,
      teamIdentifier: input.teamId,
      logoText: input.shopName,
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(255, 255, 255)',
      backgroundColor: rgbCss(bg),
    },
  );

  // storeCard: balance up front, who it belongs to below, details on the back.
  pass.type = 'storeCard';

  pass.primaryFields.push({
    key: 'balance',
    label: 'Бонусы',
    value: formatNumber(input.balance),
  });

  pass.secondaryFields.push({
    key: 'client',
    label: 'Клиент',
    value: input.clientName || 'Клиент',
  });

  if (input.clientPhone) {
    pass.auxiliaryFields.push({
      key: 'phone',
      label: 'Телефон',
      value: input.clientPhone,
    });
  }

  pass.backFields.push(
    { key: 'shop', label: 'Автосервис', value: input.shopName },
    {
      key: 'about',
      label: 'О карте',
      value: 'Покажите QR-код администратору при визите — по нему начисляются и списываются бонусы.',
    },
  );

  // QR encodes the clientId so staff can scan the card straight into the bonus flow.
  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: input.clientId,
    messageEncoding: 'iso-8859-1',
    altText: input.clientName || undefined,
  });

  return pass.getAsBuffer();
}
