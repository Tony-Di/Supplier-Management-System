import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z, type ZodType } from "zod";

import { getConfig } from "../config";
import { pool, transaction } from "../db";
import { sendMail, type Mail } from "../mailer";
import {
  createPasswordLink,
  emailDomain,
  findAccountByEmail,
  readPasswordLink,
  recordSignIn,
  usePasswordLink,
} from "../passwordAccounts";
import { passwordLinkUrl, resetMail, signUpMail } from "../passwordMail";
import { hashPassword, PASSWORD_MAX_LENGTH, passwordProblem, verifyPassword } from "../passwords";
import { requireAuth, signIn, verifyCsrf } from "../session";

const config = getConfig();

/** Email and password sign-in, mounted at /api/auth/password. Only answers when AUTH_MODE=password. */
export const passwordRouter = Router();

class PasswordAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const LINK_SENT = "Check your inbox. If this address can use the system, a link is on its way.";
const LINK_EXPIRED = "This link has expired or has already been used. Ask for a new one.";
const DEACTIVATED = "This account has been deactivated. Contact the sourcing system administrator.";

passwordRouter.use((_request, response, next) => {
  if (config.authMode !== "password") {
    response.status(404).json({ message: "Email and password sign-in is not switched on." });
    return;
  }
  next();
});

// Only JSON bodies are read, so a form on another site cannot post here: a
// cross-site JSON request needs a CORS preflight, which this app refuses.
const email = z.string().trim().toLowerCase().email().max(254);
const signInBody = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });
const signUpBody = z.object({ name: z.string().trim().min(1).max(100), email });
const forgotBody = z.object({ email });
const tokenBody = z.object({ token: z.string().min(1).max(200) });
const setBody = tokenBody.extend({ password: z.string() });

function parse<T>(schema: ZodType<T>, body: unknown, message: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PasswordAuthError(400, message);
  return parsed.data;
}

function requireSignUpDomain(address: string) {
  if (config.signUpDomains.includes(emailDomain(address))) return;
  const domains = config.signUpDomains.map((domain) => `@${domain}`).join(" or ");
  throw new PasswordAuthError(400, `Use your ${domains} email address.`);
}

// Sent after the response, so a slow mail server does not hold up the page,
// and an address with no account answers as quickly as one with an account.
function deliver(mail: Mail) {
  sendMail(mail).catch((error) => console.error(`Could not email ${mail.to}:`, error instanceof Error ? error.message : error));
}

function handle(fn: RequestHandler): RequestHandler {
  return async (request, response, next) => {
    try {
      await fn(request, response, next);
    } catch (error) {
      next(error);
    }
  };
}

const tooMany = { message: "Too many attempts. Wait a minute and try again." };

// Failed sign-ins only. Five wrong passwords lock an address for the rest of
// the minute, whichever computer they come from: the app trusts one proxy hop,
// so without a proxy in front a client could change its apparent IP at will.
const accountLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: tooMany,
  keyGenerator: (request) => `sign-in|${String(request.body?.email ?? "").trim().toLowerCase()}`,
});
// And one IP trying many addresses.
const signInIpLimiter = rateLimit({ windowMs: 60_000, limit: 20, skipSuccessfulRequests: true, message: tooMany });
const linkLimiter = rateLimit({ windowMs: 60_000, limit: 5, message: tooMany });
const tokenLimiter = rateLimit({ windowMs: 60_000, limit: 20, message: tooMany });

passwordRouter.post("/sign-in", signInIpLimiter, accountLimiter, handle(async (request, response) => {
  const body = parse(signInBody, request.body, "Enter your email address and password.");
  const account = await findAccountByEmail(pool, body.email);
  const matches = await verifyPassword(body.password, account?.passwordHash);
  if (!account || !matches) throw new PasswordAuthError(401, "Email or password is incorrect.");
  if (!account.user.active) throw new PasswordAuthError(403, DEACTIVATED);
  await recordSignIn(pool, account.user.id);
  await signIn(request, account.user);
  response.json({ ok: true });
}));

passwordRouter.post("/sign-up", linkLimiter, handle(async (request, response) => {
  const body = parse(signUpBody, request.body, "Enter your name and your work email address.");
  requireSignUpDomain(body.email);
  const account = await findAccountByEmail(pool, body.email);
  if (!account || account.user.active) {
    // Someone who already has an account gets a link to change its password,
    // so the answer never shows whether an address is registered.
    const url = passwordLinkUrl(config.origin, await createPasswordLink(pool, body.email, account ? null : body.name));
    deliver(account?.passwordHash ? resetMail(body.email, account.user.name, url) : signUpMail(body.email, account?.user.name ?? body.name, url));
  }
  response.status(202).json({ message: LINK_SENT });
}));

passwordRouter.post("/forgot", linkLimiter, handle(async (request, response) => {
  const body = parse(forgotBody, request.body, "Enter your work email address.");
  requireSignUpDomain(body.email);
  const account = await findAccountByEmail(pool, body.email);
  if (account?.user.active) {
    const url = passwordLinkUrl(config.origin, await createPasswordLink(pool, body.email, null));
    deliver(account.passwordHash ? resetMail(body.email, account.user.name, url) : signUpMail(body.email, account.user.name, url));
  }
  response.status(202).json({ message: LINK_SENT });
}));

passwordRouter.post("/link", tokenLimiter, handle(async (request, response) => {
  const { token } = parse(tokenBody, request.body, LINK_EXPIRED);
  const link = await readPasswordLink(pool, token);
  if (!link) throw new PasswordAuthError(400, LINK_EXPIRED);
  response.json(link);
}));

passwordRouter.post("/set", tokenLimiter, handle(async (request, response) => {
  const body = parse(setBody, request.body, LINK_EXPIRED);
  const problem = passwordProblem(body.password);
  if (problem) throw new PasswordAuthError(400, problem);
  const passwordHash = await hashPassword(body.password);
  const result = await transaction((client) => usePasswordLink(client, body.token, passwordHash));
  if (result.status === "expired") throw new PasswordAuthError(400, LINK_EXPIRED);
  if (result.status === "deactivated") throw new PasswordAuthError(403, DEACTIVATED);
  await signIn(request, result.user);
  response.json({ ok: true });
}));

// Signed in: email a link to the account's own address, to choose a new
// password from it. The current password keeps working until the link is used.
const changeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 3,
  message: tooMany,
  keyGenerator: (request) => `change|${request.user!.email.toLowerCase()}`,
});

passwordRouter.post("/change-link", requireAuth, verifyCsrf, changeLimiter, handle(async (request, response) => {
  const user = request.user!;
  const account = await findAccountByEmail(pool, user.email);
  const url = passwordLinkUrl(config.origin, await createPasswordLink(pool, user.email, null));
  deliver(account?.passwordHash ? resetMail(user.email, user.name, url) : signUpMail(user.email, user.name, url));
  response.status(202).json({ email: user.email });
}));
