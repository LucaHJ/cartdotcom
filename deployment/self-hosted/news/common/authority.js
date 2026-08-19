export const AUTHORITY_SCOPE = "news-processing";
export const LOCAL_AUTHORITY_OWNER = "self_hosted";

export async function processingAuthority(client) {
  const result = await client.query(
    `SELECT scope, owner, epoch, updated_at, note
     FROM runtime_authority
     WHERE scope = $1`,
    [AUTHORITY_SCOPE],
  );
  return result.rows[0] || {
    scope: AUTHORITY_SCOPE,
    owner: "cloudflare",
    epoch: 0,
    updated_at: null,
    note: "Missing authority row; failing closed to Cloudflare.",
  };
}

export async function hasLocalProcessingAuthority(client) {
  const authority = await processingAuthority(client);
  return authority.owner === LOCAL_AUTHORITY_OWNER;
}
