import { randomBytes, createCipheriv, createDecipheriv, scryptSync, createHash } from 'node:crypto';
import type { OAuthTokens } from '../types/index.js';

// Re-export OAuthTokens for convenience
export type { OAuthTokens } from '../types/index.js';

// OpenAI OAuth configuration (based on OpenClaw's Codex OAuth implementation)
const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';

// Client ID for Codex CLI (publicly known, used for PKCE flow)
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

// Fixed port and path that OpenAI has whitelisted for Codex CLI
const OAUTH_CALLBACK_PORT = 1455;
const OAUTH_CALLBACK_PATH = '/auth/callback';

// Scopes needed for API access
const OPENAI_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

// Encryption key derivation (uses machine-specific info)
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export interface PendingOAuthState {
  pkce: PKCEChallenge;
  redirectUri: string;
  createdAt: number;
}

/**
 * Generate a cryptographically secure random string for PKCE
 */
function generateRandomString(length: number): string {
  const bytes = randomBytes(length);
  // Use URL-safe base64 encoding
  return bytes.toString('base64url').slice(0, length);
}

/**
 * Generate SHA256 hash and base64url encode it for PKCE challenge
 */
function sha256Base64Url(input: string): string {
  const hash = createHash('sha256').update(input).digest();
  // Convert to base64url
  return hash.toString('base64url');
}

/**
 * Generate PKCE code verifier and challenge
 */
export function generatePKCE(): PKCEChallenge {
  // Code verifier: 43-128 characters, using [A-Z], [a-z], [0-9], "-", ".", "_", "~"
  const codeVerifier = generateRandomString(64);

  // Code challenge: base64url(sha256(code_verifier))
  const codeChallenge = sha256Base64Url(codeVerifier);

  // State: random string to prevent CSRF
  const state = generateRandomString(32);

  return {
    codeVerifier,
    codeChallenge,
    state,
  };
}

/**
 * Build the OpenAI OAuth authorization URL
 */
export function buildAuthorizationURL(pkce: PKCEChallenge, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OPENAI_SCOPES.join(' '),
    state: pkce.state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
    // Audience for API access
    audience: 'https://api.openai.com/v1',
  });

  return `${OPENAI_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OPENAI_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? Date.now() + (data.expires_in * 1000)
      : undefined,
  };
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: OPENAI_CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    // Use new refresh token if provided, otherwise keep the old one
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + (data.expires_in * 1000)
      : undefined,
  };
}

/**
 * Check if tokens are expired or about to expire (within 5 minutes)
 */
export function isTokenExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) {
    // If no expiry is set, assume it's valid
    return false;
  }
  // Consider expired if within 5 minutes of expiry
  const bufferMs = 5 * 60 * 1000;
  return Date.now() >= (tokens.expiresAt - bufferMs);
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!isTokenExpired(tokens)) {
    return tokens;
  }

  if (!tokens.refreshToken) {
    throw new Error('Access token expired and no refresh token available');
  }

  return refreshAccessToken(tokens.refreshToken);
}

// Token encryption utilities for secure storage in config file

/**
 * Derive an encryption key from a machine-specific secret
 */
function deriveKey(secret: string): Buffer {
  // Use a fixed salt for deterministic key derivation
  // This allows the same machine to decrypt tokens
  const salt = 'weavr-oauth-tokens-v1';
  return scryptSync(secret, salt, 32);
}

/**
 * Get a machine-specific secret for encryption
 * Uses hostname and user info to create a unique key per machine
 */
function getMachineSecret(): string {
  const os = require('node:os');
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const homeDir = os.homedir();
  return `${hostname}:${username}:${homeDir}`;
}

/**
 * Encrypt OAuth tokens for storage
 */
export function encryptTokens(tokens: OAuthTokens): string {
  const key = deriveKey(getMachineSecret());
  const iv = randomBytes(16);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  const json = JSON.stringify(tokens);
  const encrypted = Buffer.concat([
    cipher.update(json, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt OAuth tokens from storage
 */
export function decryptTokens(encrypted: string): OAuthTokens {
  const [ivB64, authTagB64, dataB64] = encrypted.split(':');

  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Invalid encrypted token format');
  }

  const key = deriveKey(getMachineSecret());
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8')) as OAuthTokens;
}

/**
 * Get the OAuth callback port (fixed by OpenAI whitelist)
 */
export function getOAuthCallbackPort(): number {
  return OAUTH_CALLBACK_PORT;
}

/**
 * Create the OAuth callback URL (fixed format required by OpenAI)
 */
export function getCallbackUrl(): string {
  return `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
}

/**
 * Validate that an OAuth state matches the expected value
 */
export function validateState(received: string, expected: string): boolean {
  if (!received || !expected) {
    return false;
  }
  // Use timing-safe comparison to prevent timing attacks
  if (received.length !== expected.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < received.length; i++) {
    result |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}
