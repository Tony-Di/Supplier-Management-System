export class ClaimError extends Error {
  status = 403;
}

export function validateClaims(claims: Record<string, unknown>, expectedTenantId: string) {
  if (claims.tid !== expectedTenantId) {
    throw new ClaimError("This account belongs to a different tenant.");
  }
  const oid = typeof claims.oid === "string" ? claims.oid : "";
  if (!oid) throw new ClaimError("The sign-in response carried no oid claim.");

  const emailRaw = String(claims.preferred_username ?? claims.email ?? "").trim();
  const email = emailRaw.toLowerCase();
  if (!email) throw new ClaimError("The sign-in response carried no email address.");

  const name = String(claims.name ?? "").trim() || emailRaw.split("@")[0];
  return { oid, email, name };
}
