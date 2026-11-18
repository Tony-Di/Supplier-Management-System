export type AuthMode = "entra" | "dev" | "password";

export interface MailConfig {
  host: string;
  port: number;
  user: string | undefined;
  password: string | undefined;
  from: string;
}

export interface Config {
  production: boolean;
  port: number;
  origin: string;
  databaseUrl: string;
  sessionSecret: string;
  secureCookies: boolean;
  authMode: AuthMode;
  entra: { tenantId: string; clientId: string; clientSecret: string } | undefined;
  /** AUTH_MODE=password: the email domains that may create an account, lower case and without the @. */
  signUpDomains: string[];
  /** Outgoing mail for sign-up and password links. Unset outside production means links are written to the log. */
  mail: MailConfig | undefined;
  /** Whether a buyer may select a quote without a sample by confirming earlier orders. Switched off once ERP history is in the system. */
  previousOrderSelection: boolean;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  return value;
}

function readAuthMode(value: string | undefined): AuthMode {
  if (!value || value === "entra") return "entra";
  if (value === "dev" || value === "password") return value;
  throw new Error(`AUTH_MODE must be entra, password or dev, not "${value}".`);
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function readSignUpDomains(env: NodeJS.ProcessEnv): string[] {
  const domains = required(env, "SIGN_UP_EMAIL_DOMAINS")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  const invalid = domains.find((domain) => !DOMAIN.test(domain));
  if (invalid) throw new Error(`SIGN_UP_EMAIL_DOMAINS has an entry that is not a domain: ${invalid}`);
  if (domains.length === 0) throw new Error("SIGN_UP_EMAIL_DOMAINS needs at least one domain, such as segsolar.com.");
  return domains;
}

function readMail(env: NodeJS.ProcessEnv): MailConfig | undefined {
  if (!env.SMTP_HOST) return undefined;
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port <= 0) throw new Error("SMTP_PORT must be a port number, such as 587.");
  const from = env.MAIL_FROM || env.SMTP_USER;
  if (!from) throw new Error("MAIL_FROM is required when SMTP_HOST is set and SMTP_USER is not.");
  return { host: env.SMTP_HOST, port, user: env.SMTP_USER || undefined, password: env.SMTP_PASSWORD || undefined, from };
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const authMode = readAuthMode(env.AUTH_MODE);

  if (authMode === "dev" && production) {
    throw new Error("AUTH_MODE=dev cannot run in production. Remove it or unset NODE_ENV=production.");
  }

  const databaseUrl = required(env, "DATABASE_URL");
  const sessionSecret = required(env, "SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");

  const origin = new URL(env.APP_ORIGIN || "http://127.0.0.1:5173").origin;
  if (production && !origin.startsWith("https://")) throw new Error("Production APP_ORIGIN must use HTTPS.");

  const entra =
    authMode === "entra"
      ? {
          tenantId: required(env, "ENTRA_TENANT_ID"),
          clientId: required(env, "ENTRA_CLIENT_ID"),
          clientSecret: required(env, "ENTRA_CLIENT_SECRET"),
        }
      : undefined;

  const signUpDomains = authMode === "password" ? readSignUpDomains(env) : [];
  const mail = readMail(env);
  if (authMode === "password" && production && !mail) {
    throw new Error("AUTH_MODE=password in production needs SMTP_HOST, so sign-up and password links can be emailed.");
  }

  return {
    production,
    port: Number(env.API_PORT ?? 5174),
    origin,
    databaseUrl,
    sessionSecret,
    secureCookies: production || env.COOKIE_SECURE === "true",
    authMode,
    entra,
    signUpDomains,
    mail,
    previousOrderSelection: env.PREVIOUS_ORDER_SELECTION !== "off",
  };
}
