import { Router } from "express";

import { countAuditEntries } from "../auditLog";
import { pool } from "../db";
import { requireAdmin } from "../session";
import { deleteUser, listUsers, setUserActive, setUserRole, UserRuleError } from "../users";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get("/users", async (_request, response, next) => {
  try {
    response.json(await listUsers(pool));
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:id/role", async (request, response, next) => {
  try {
    const role = request.body?.role;
    if (role !== "admin" && role !== "user") throw new UserRuleError("Role must be admin or user.");
    response.json(await setUserRole(pool, Number(request.params.id), role, request.user!.id));
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:id/active", async (request, response, next) => {
  try {
    const active = request.body?.active;
    if (typeof active !== "boolean") throw new UserRuleError("Active must be a boolean.");
    response.json(await setUserActive(pool, Number(request.params.id), active, request.user!.id));
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/users/:id", async (request, response, next) => {
  try {
    await deleteUser(pool, Number(request.params.id), request.user!.id);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/audit-usage", async (_request, response, next) => {
  try {
    response.json(await countAuditEntries(pool));
  } catch (error) {
    next(error);
  }
});
