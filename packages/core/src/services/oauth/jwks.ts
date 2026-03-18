import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
} from "jose";

const JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
const ISSUER = "https://auth.openai.com/";

export interface ValidateIdTokenOptions {
  fetch?: typeof fetch;
  jwksUrl?: string;
  issuer?: string;
}

export async function validateIdToken(
  idToken: string,
  clientId: string,
  options: ValidateIdTokenOptions = {},
): Promise<JWTPayload> {
  const jwks = createRemoteJWKSet(
    new URL(options.jwksUrl ?? JWKS_URL),
    options.fetch ? { [customFetch]: options.fetch } : undefined,
  );
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: options.issuer ?? ISSUER,
    audience: clientId,
  });
  return payload;
}
