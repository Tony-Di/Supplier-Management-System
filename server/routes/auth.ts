import { Router } from "express";
import rateLimit from "express-rate-limit";

import { validateClaims } from "../auth/claims";
import { exchangeCallback, getAuthorizationUrl } from "../auth/entra";
import { getConfig } from "../config";
import { pool } from "../db";
import { csrfToken, requireAuth, signIn } from "../session";
import { upsertUserFromClaims } from "../users";

const config = getConfig();
export const authRouter = Router();

const callbackLimiter = rateLimit({ windowMs: 60_000, limit: 20 });

const DEV_CLAIMS = { tid: "dev", oid: "dev-oid", preferred_username: "dev@segsolar.com", name: "Dev User" };

authRouter.get("/login", async (request, response, next) => {
  try {
    if (config.authMode === "dev") {
      const user = await upsertUserFromClaims(pool, validateClaims(DEV_CLAIMS, "dev"));
      await signIn(request, user);
      response.redirect(302, "/");
      return;
    }
    response.redirect(302, await getAuthorizationUrl(request));
  } catch (error) {
    next(error);
  }
});

authRouter.get("/callback", callbackLimiter, async (request, response, next) => {
  try {
    const claims = await exchangeCallback(request);
    const mapped = validateClaims(claims, config.entra!.tenantId);
    const user = await upsertUserFromClaims(pool, mapped);
    if (!user.active) {
      response.redirect(302, "/?error=deactivated");
      return;
    }
    await signIn(request, user);
    response.redirect(302, "/");
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (request, response) => {
  request.session.destroy(() => response.json({ ok: true }));
});

authRouter.get("/me", requireAuth, (request, response) => {
  const user = request.user!;
  response.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    csrfToken: csrfToken(request),
  });
});
