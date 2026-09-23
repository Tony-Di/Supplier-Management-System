import type { NextFunction, Request, Response } from "express";

/**
 * The app's single error-handling middleware. Any error class that carries
 * a numeric `status` (ValidationError, ClaimError, and anything added later)
 * is reported with that status and its own message, rather than falling
 * through to a generic 500 — so a rejected sign-in or a rejected business
 * rule is distinguishable in logs and responses from an actual server fault.
 */
export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
    response.status((error as Error & { status: number }).status).json({ message: error.message });
    return;
  }

  if (error && typeof error === "object" && "issues" in error) {
    response.status(400).json({ message: "Invalid request body", issues: (error as { issues: unknown }).issues });
    return;
  }

  console.error(error);
  response.status(500).json({ message: "Internal server error" });
}
