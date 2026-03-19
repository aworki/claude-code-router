import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
} from "jose";

export const OPENAI_JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
export const OPENAI_OIDC_ISSUER = "https://auth.openai.com";

export interface ValidateIdTokenOptions {
  fetch?: typeof fetch;
  jwksUrl?: string;
  issuer?: string;
  audience?: string;
}

export async function validateIdToken(
  idToken: string,
  clientId: string,
  options: ValidateIdTokenOptions = {},
): Promise<JWTPayload> {
  const jwks = createRemoteJWKSet(
    new URL(options.jwksUrl ?? OPENAI_JWKS_URL),
    options.fetch ? { [customFetch]: options.fetch } : undefined,
  );
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: options.issuer ?? OPENAI_OIDC_ISSUER,
    audience: options.audience ?? clientId,
  });
  return payload;
}
