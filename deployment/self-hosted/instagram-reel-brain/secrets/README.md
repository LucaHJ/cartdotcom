# Secret Contracts

Do not place real values in this directory or in Git.

Later phases will require root-managed server files with mode `0600`, probably
under `/srv/platform/secrets` or a Reel-specific root-owned secrets directory.
Phase 1 services do not mount or read any production secrets.

Expected later secret names:

- `reel_edge_shared_secret`
- `reel_callback_signing_key`
- `reel_admin_token`
- `reel_meta_verify_token`
- `reel_instagram_access_token`
- `reel_r2_mirror_token`
- `reel_codex_auth_state_key`
- `reel_runtime_control_token`
- `reel_database_password`
