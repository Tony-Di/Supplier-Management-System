import { randomBytes } from "node:crypto";
import type { Request } from "express";
import * as client from "openid-client";

import { getConfig } from "../config";

const config = getConfig();

let configuration: client.Configuration | undefined;

async function getConfiguration(): Promise<client.Configuration> {
  if (!config.entra) throw new Error("Entra is not configured.");
  configuration ??= await client.discovery(
    new URL(`https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`),
    config.entra.clientId,
    config.entra.clientSecret,
  );
  return configuration;
}

const redirectUri = `${config.origin}/api/auth/callback`;

export async function getAuthorizationUrl(request: Request): Promise<string> {
  const configured = await getConfiguration();
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  request.session.oidc = { state, nonce, verifier };

  return client.buildAuthorizationUrl(configured, {
    redirect_uri: redirectUri,
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  }).href;
}

export async function exchangeCallback(request: Request): Promise<Record<string, unknown>> {
  const pending = request.session.oidc;
  if (!pending) throw new Error("This sign-in attempt expired. Start again.");
  delete request.session.oidc;

  const configured = await getConfiguration();
  const tokens = await client.authorizationCodeGrant(
    configured,
    new URL(`${config.origin}${request.originalUrl}`),
    { pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce },
  );
  return tokens.claims() as Record<string, unknown>;
}
