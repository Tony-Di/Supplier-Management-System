import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";

// Paths that belong to the API, uploaded files or build assets. A miss there
// is a real 404, not a client-side route.
const NOT_APP_ROUTES = /^\/(api|uploads|assets)(\/|$)/;

/**
 * Serves the built frontend (`npm run build`) from the API's own origin, which
 * the session cookie requires outside development. Every other GET returns the
 * app page so client-side routes survive a reload. Does nothing when the
 * frontend has not been built, as in development, where Vite serves it.
 */
export function serveFrontend(app: Express, distDir: string): void {
  const indexFile = join(distDir, "index.html");
  if (!existsSync(indexFile)) return;

  app.use(express.static(distDir, { index: false }));
  app.get("*", (request, response, next) => {
    if (NOT_APP_ROUTES.test(request.path)) return next();
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(indexFile);
  });
}
