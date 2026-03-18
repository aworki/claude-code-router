type OAuthSession = {
  codeVerifier: string;
  redirectUri: string;
};

type StoredOAuthSession = OAuthSession & {
  createdAt: number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class InMemoryOAuthSessionStore {
  private readonly sessions = new Map<string, StoredOAuthSession>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  issue(state: string, session: OAuthSession) {
    this.pruneExpired();
    this.sessions.set(state, { ...session, createdAt: this.now() });
  }

  consume(state: string) {
    this.pruneExpired();
    const session = this.sessions.get(state);
    this.sessions.delete(state);
    if (!session) return undefined;

    return {
      codeVerifier: session.codeVerifier,
      redirectUri: session.redirectUri,
    };
  }

  private pruneExpired() {
    const now = this.now();
    for (const [state, session] of this.sessions) {
      if (now - session.createdAt >= this.ttlMs) {
        this.sessions.delete(state);
      }
    }
  }
}
