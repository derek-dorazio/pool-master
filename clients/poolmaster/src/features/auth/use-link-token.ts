import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * The token rides in the link's fragment (`#token=...`), which the browser never sends to a
 * server. Read once on arrival; the page then clears it from the address bar.
 */
function readTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token?.trim() ? token : null;
}

/**
 * The token of an emailed link that a page opens with, such as a password reset or an email
 * change undo: read from the fragment once, null when there is none, and cleared from the
 * address bar so it is not left in history or shared by copying the URL.
 */
export function useLinkToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => readTokenFromHash(location.hash));

  // Synchronises with the browser's location, an external system.
  useEffect(() => {
    if (location.hash) {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  return token;
}
