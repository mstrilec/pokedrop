const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

export function hasSessionCookie(cookies: { has(name: string): boolean }): boolean {
  return SESSION_COOKIES.some((name) => cookies.has(name));
}
