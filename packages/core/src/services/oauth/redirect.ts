const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertAllowedLoopbackRedirect(
  redirectUri: string,
  allowlist: readonly string[] = [],
) {
  const url = new URL(redirectUri);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Redirect URI must use http: or https:");
  }

  const hostname = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname)) {
    return;
  }

  if (allowlist.some((allowedHost) => allowedHost.toLowerCase() === hostname)) {
    return;
  }

  throw new Error("Redirect URI must use a loopback host unless explicitly allowlisted");
}
