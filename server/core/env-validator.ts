/**
 * Production Environment & Configuration Validator (Issue #147 / Issue #149).
 *
 * Enforces startup validation for runtime configuration before accepting requests:
 * - Validates PORT range (1..65535)
 * - Verifies DATA_DIR is accessible or creatable
 * - In production mode:
 *   * Enforces non-empty, strong ADMIN_PASSWORD (min 12 chars)
 *   * Enforces valid BASE_URL
 *   * Disallows dangerous default fallback credentials
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ValidatedConfig {
  port: number;
  host: string;
  dataDir: string;
  baseUrl: string;
  isProduction: boolean;
  adminPasswordProvided: boolean;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`[CONFIG VALIDATION ERROR] ${message}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateEnvironment(): ValidatedConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const portRaw = process.env.PORT || '3000';
  const port = parseInt(portRaw, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigValidationError(`Invalid PORT value: "${portRaw}". Must be an integer between 1 and 65535.`);
  }

  const host = process.env.HOST || '0.0.0.0';
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));

  // Verify DATA_DIR can be created or written to
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    // Test write permission with temporary probe file
    const probePath = path.join(dataDir, '.write-probe');
    fs.writeFileSync(probePath, 'ok');
    fs.unlinkSync(probePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigValidationError(`Cannot write to DATA_DIR (${dataDir}): ${msg}`);
  }

  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  try {
    new URL(baseUrl);
  } catch {
    throw new ConfigValidationError(`Invalid BASE_URL format: "${baseUrl}". Must be a valid URL (e.g. https://game.example.com).`);
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminPasswordProvided = Boolean(adminPassword && adminPassword.trim().length > 0);

  if (isProduction) {
    if (!adminPasswordProvided) {
      throw new ConfigValidationError(
        'In production mode (NODE_ENV=production), ADMIN_PASSWORD environment variable MUST be explicitly set.'
      );
    }
    if (adminPassword!.length < 12) {
      throw new ConfigValidationError(
        `ADMIN_PASSWORD in production must be at least 12 characters long (was ${adminPassword!.length}).`
      );
    }
  }

  return {
    port,
    host,
    dataDir,
    baseUrl,
    isProduction,
    adminPasswordProvided
  };
}
