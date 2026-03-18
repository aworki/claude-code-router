type OAuthSession = {
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

export class InMemoryOAuthSessionStore {
  private readonly sessions = new Map<string, OAuthSession>();

  issue(state: string, session: Omit<OAuthSession, "createdAt">) {
    this.sessions.set(state, { ...session, createdAt: Date.now() });
  }

  consume(state: string) {
    const session = this.sessions.get(state);
    this.sessions.delete(state);
    return session;
  }
}
