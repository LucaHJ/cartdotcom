# R2 Corpus Migration

The Cloudflare R2 article corpus is mirrored under
`/srv/cartdotcom/article-corpus`. Object paths remain identical to
`article_corpus_objects.object_key`, so the API can replace R2 reads with a
traversal-safe local filesystem adapter.

## Migration method

Wrangler stores OAuth credentials in its encrypted credential store. The
migration therefore uses `tools/r2-export-proxy`, a minimal temporary Worker
started with `wrangler dev --remote`. The local exporter calls that process with
an ephemeral token from an untracked `.dev.vars` file. Never decrypt, print, or
commit Wrangler credentials or the migration token.

The exporter is resumable: a file with the expected byte count is skipped.
Set `CORPUS_EXPORT_VERIFY_EXISTING=1` for the final pass. Verification parses
each JSON object and compares the SHA-256 of `content.plaintext` with
`article_corpus_objects.content_sha256`. A mismatch is redownloaded.

## Installed snapshot

- Object count: 76,248
- Server archive: `/srv/cartdotcom/imports/cartdotcom-article-corpus-20260819T1708.tar`
- Archive SHA-256: `e52536fef29c4f8e2c2bdd9819af82abac1eb2db228777a38c0bcd7136dd3b35`
- Extracted corpus: `/srv/cartdotcom/article-corpus`

The temporary Wrangler process must be stopped and `.dev.vars` erased after an
export. Cloudflare remains authoritative until the separate cutover runbook is
completed.
