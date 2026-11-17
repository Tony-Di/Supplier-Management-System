import { useCallback, useEffect, useRef, useState } from "react";
import { defaultViewState, viewFromLocation, viewPath, type ViewState } from "./lib/route";

const RETURN_TO_KEY = "sourcing.returnTo";

const currentAddress = () => `${window.location.pathname}${window.location.search}`;

/**
 * Remembers the address a signed-out visitor asked for, so the link they
 * followed still opens after sign-in sends them back to the root address.
 * A visitor at the root address asked for nothing, which also forgets an
 * earlier request. Session storage can be unavailable (private windows); the
 * link is then lost and nothing else changes.
 */
export function rememberRequestedAddress() {
  try {
    if (window.location.pathname === "/") window.sessionStorage.removeItem(RETURN_TO_KEY);
    else window.sessionStorage.setItem(RETURN_TO_KEY, currentAddress());
  } catch {
    // Without storage the visitor lands on the Dashboard.
  }
}

function initialView(): ViewState {
  let address = currentAddress();
  try {
    const requested = window.sessionStorage.getItem(RETURN_TO_KEY);
    // Only parsed into a view, never navigated to, so a tampered value cannot leave the app.
    if (requested && window.location.pathname === "/") address = requested;
  } catch {
    // Fall through to the address as it is.
  }
  const [pathname, search = ""] = address.split("?");
  return viewFromLocation(pathname, search ? `?${search}` : "", defaultViewState);
}

/**
 * The current view, kept in step with the browser's address: a reload or a
 * shared link opens the same section, tab and case, and Back and Forward move
 * between views. `navigate` changes the view and adds a history entry;
 * `{ replace: true }` rewrites the current entry instead, for changes the user
 * did not ask for, such as selecting the first case once the data has loaded.
 */
export function useNavigation() {
  const [view, setView] = useState<ViewState>(initialView);
  // The latest view for event handlers, so two changes in one handler build on each other.
  const latest = useRef(view);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(RETURN_TO_KEY);
    } catch {
      // Nothing was stored.
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      latest.current = viewFromLocation(window.location.pathname, window.location.search, latest.current);
      setView(latest.current);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // The address always shows the view on screen, including after an unknown or shortened address.
  useEffect(() => {
    const path = viewPath(view);
    if (path !== currentAddress()) window.history.replaceState(null, "", path);
  }, [view]);

  const navigate = useCallback((patch: Partial<ViewState>, options: { replace?: boolean } = {}) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    const path = viewPath(next);
    if (path !== currentAddress()) {
      if (options.replace) window.history.replaceState(null, "", path);
      else window.history.pushState(null, "", path);
    }
    setView(next);
  }, []);

  return { view, navigate };
}
