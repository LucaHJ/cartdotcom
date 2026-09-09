const READ_ONLY_POST_ROUTES = [
  /^\/integration\/reel-library\/status$/,
  /^\/integration\/reel-library\/jobs\/[^/]+\/(?:video|audio|carousel|thumbnail)$/,
];

export function phase7WakeNeeded(method: string, pathname: string, status: number): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) || status >= 500) return false;
  return !READ_ONLY_POST_ROUTES.some((pattern) => pattern.test(pathname));
}
