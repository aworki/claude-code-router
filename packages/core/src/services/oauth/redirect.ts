export function assertAllowedLoopbackRedirect(redirectUri: string) {
  const url = new URL(redirectUri);
  const allowed = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (!allowed.has(url.hostname)) {
    throw new Error("Redirect URI must use a loopback host unless explicitly allowlisted");
  }
}
