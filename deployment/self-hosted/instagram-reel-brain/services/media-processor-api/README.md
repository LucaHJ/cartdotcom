# Phase 2 media processor API

Internal-only wrapper for the existing Python media processor contract.

Phase 2 constraints:

- binds to loopback when run directly;
- is not referenced by production ingress;
- defaults to `REEL_MEDIA_PROCESSOR_ENABLED=false`;
- supports fixture-only processing only when explicitly enabled in tests;
- refuses paths outside `REEL_TEST_STORAGE_ROOT`;
- does not call Instagram, Codex, Cloudflare, or outbound services.
