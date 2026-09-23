export interface Config {
  production: boolean;
  port: number;
  origin: string;
  databaseUrl: string;
  sessionSecret: string;
  secureCookies: boolean;
  authMode: "entra" | "dev";
  entra: { tenantId: string; clientId: string; clientSecret: string } | undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  return value;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const authMode = env.AUTH_MODE === "dev" ? "dev" : "entra";

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

  return {
    production,
    port: Number(env.API_PORT ?? 5174),
    origin,
    databaseUrl,
    sessionSecret,
    secureCookies: production || env.COOKIE_SECURE === "true",
    authMode,
    entra,
  };
}
