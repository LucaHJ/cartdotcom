# Instagram Reel Brain

Cloudflare-hosted Reel capture, archival, transcription, multimodal Codex research, HTML research-file generation, search, and retrieval.

## Current safety mode

`INGEST_MODE=live`: new allowlisted Instagram shares and commands are accepted without `#brain-test`. Historical inbox messages are never drained automatically. Backlog work requires the protected, idempotent pilot endpoint, an explicit pilot key, the literal confirmation `ENQUEUE_EXACTLY_10`, and a target locked to ten posts.

Duplicates are rejected before Codex in two places. Intake canonicalises Reel/post URLs into a case-sensitive shortcode key protected by a partial unique D1 index before any Queue message is sent. After yt-dlp resolves carousel/CDN child links to their parent post, the container calls the Worker again before transcription and Codex; a resolved duplicate is marked `duplicate` and stopped. Pilot runs exclude those jobs and can select a replacement without exceeding ten unique non-duplicate runs.

## Live architecture

```text
Instagram DM / protected test request
  -> Worker validation + D1 job
  -> Cloudflare Queue
  -> 1 GiB Cloudflare Container
       -> yt-dlp download + public comments/metadata
       -> FFmpeg audio + eight sampled frames
       -> Workers AI Whisper transcription
       -> GPT-5.6 Luna Codex CLI visual research
  -> R2 original media and evidence
  -> D1 searchable index
  -> R2 + KV HTML root and resource profiles
```

Cloud resources:

- Worker: `cartdotcom-instagram-reel-brain`
- D1: `cartdotcom-instagram-reel-brain`
- R2: `cartdotcom-instagram-reel-brain`
- Queue: `cartdotcom-instagram-reel-brain`
- DLQ: `cartdotcom-instagram-reel-brain-dlq`
- Container: `cartdotcom-instagram-reel-brain-reelbraincontainer`
- URL: <https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev>

## Storage layout

```text
reels/<shortcode>/<job-id>/video/original.mp4
reels/<shortcode>/<job-id>/audio/audio.mp3
reels/<shortcode>/<job-id>/carousel_item/slide-01.jpg
reels/<shortcode>/<job-id>/carousel_manifest/carousel-manifest.json
reels/<shortcode>/<job-id>/frame/frame-01.jpg
reels/<shortcode>/<job-id>/metadata/metadata.json
reels/<shortcode>/<job-id>/comments/comments.json
reels/<shortcode>/<job-id>/transcript/transcript.json
reels/<shortcode>/<job-id>/synthesis/synthesis.json
library/reels/<job-id>/index.html
library/<resource-type-folder>/<resource-slug>-<source-shortcode>.html
library/<artifact-collection>/index.html
```

The primary root HTML file links to typed resource profiles and exposes authenticated archived-media and MP3 controls in the Reel Library. Each page records its measured Codex input, output, cached-input, reasoning-output, and total tokens; the Status view reports the measured-job average. Audio attribution prefers music metadata exposed by Instagram's Reel payload/downloader metadata; otherwise Codex may identify it only from explicit evidence plus a verified source. Unidentified audio remains an unlabeled MP3. Resource profiles live in reusable global folders such as `recipes/`, `software-tools/`, `products/`, `people/`, and `techniques/`, not below a creator or Reel. Common artifacts are additionally routed into dedicated folders and central indexes: `fonts/`, `quotes/`, `films/`, `tv-shows/`, `recipes/`, `books/`, `music/`, and `podcasts/`. Every artifact detail page links to its collection and source Reel, while every collection entry links back to both. Film and TV pages replace the generic canonical/source link area with a top-of-page Australian JustWatch panel. A dedicated JustWatch Content Partner widget key enables the official multi-provider offer widget; without that key, the page falls back to its branded Australian JustWatch title link. Each type has its own synthesis rules; recipes require ingredients, quantities, timing, yield, ordered steps, substitutions, dietary and food-safety notes, and the original source. D1 holds jobs, resource summaries, artifact classifications, artifact paths, settings, notes, state transitions, token usage, and encrypted refreshed Codex authentication. Historical Markdown remains archived but is no longer the primary generation format.

Carousel posts retain every original slide, an ordered manifest, one analysis frame per slide, and a generated three-second-per-slide overview MP4 as a preservation fallback. The Reel Library presents the original images as a private previous/next and swipeable slideshow. Native Meta attachment URLs are resolved from their Instagram CDN cache key to a child post shortcode; the downloader then normalises that child URL to the canonical parent carousel before capture.

Comments are ranked by `like_count` within the set returned by Instagram/yt-dlp. The pipeline archives up to 200 returned comments, publishes up to 100 in the page, and supplies the highest-ranked 40 to Codex for research. This is a useful-sample ranking, not a guarantee of Instagram's globally most-liked comments, because the extractor endpoint does not expose a global popularity-order selector.

## Required secrets

Set with `wrangler secret put`; never commit values:

- `ADMIN_TOKEN`
- `CODEX_AUTH_JSON`
- `CODEX_AUTH_STATE_KEY`
- `DOWNLOAD_SIGNING_KEY`
- `META_APP_SECRET` before moving the Meta callback
- `META_WEBHOOK_VERIFY_TOKEN` before moving the Meta callback
- `INSTAGRAM_ACCESS_TOKEN` for reactions and video replies
- `INSTAGRAM_USER_ID` for reactions and video replies
- `INSTAGRAM_ALLOWED_SENDER_IDS` to restrict accepted senders
- `REEL_LIBRARY_SHARED_TOKEN` for the authenticated Pages-to-Worker archived-video relay
- `JUSTWATCH_WIDGET_API_KEY` for the official film/TV streaming-offer widget. This must be a dedicated JustWatch Content Partner widget key. The key is delivered to the browser by the official widget, so never reuse a control-plane credential.

## API

- `GET /health`
- `POST /api/test/jobs` — protected; requires `confirm_test: true`
- `GET /api/jobs/:id` — protected
- `GET /api/jobs/:id/markdown` — protected
- `GET /api/jobs/:id/html` — protected
- `GET /api/jobs/:id/video` — protected
- `POST /api/jobs/:id/publish` — protected; republishes an existing job into the HTML Reel Library
- `POST /api/jobs/:id/publish-markdown` — protected legacy Second Brain republish
- `POST /api/backlog/pilot` — protected; dry-run or idempotently enqueue exactly ten unique backlog posts
- `GET /api/backlog/pilot?pilot_key=...` — protected pilot progress, failures, and token total
- `POST /api/admin/instagram-confirm-live` — protected, idempotent live-mode confirmation DM
- `GET /api/search?q=...` — protected
- `GET /api/settings/emojis` — protected
- `POST /api/settings/emoji` — protected
- `POST /api/container/recycle` — protected; use after a container image rollout
- `GET|POST /instagram/webhook` — Meta verification and signed event intake
- `GET /download/jobs/:id/video?expires=...&sig=...` — short-lived retrieval URL used by Instagram
- `GET /download/jobs/:id/audio?expires=...&sig=...` — private one-hour MP3 playback/download URL

## Viewing generated research files

Open <https://cartdotcom.com/reel-library>. The default reader view is a responsive three-wide gallery of synthesised Reels and carousel posts; selecting a card opens its research index. The original file tree remains on the left for direct access to every Reel, detail page, and artifact collection. Every document and the Status view expose a back-to-gallery action. Each root file requests private one-hour video, carousel-slide, and MP3 playback/download links without exposing the R2 bucket. When audio is identified reliably, its title, artist, and source link appear beside the player; otherwise only the MP3 controls appear. Historical raw Markdown remains downloadable through the protected legacy route.

## Status reactions

Instagram chat status is reaction-only and never sends emoji status messages. A live diagnostic call proved that Meta accepts literal UTF-8 emoji in `payload.reaction`: U+1F4AC (`💬`, UTF-8 `F0 9F 92 AC`) returned HTTP 200. The default sequence is `⬇️` queued, `📥` downloading, `💬` synthesising, `✅` complete, with distinct single-emoji reactions for each failure stage.

The `change the emoji for <stage> to <emoji>` command updates both the dashboard icon and the literal reaction value without sending a confirmation message.

## Retrieval delivery policy

A normal retrieval request returns the original Instagram Reel URL so the Instagram app can open the creator profile, caption, and current comments. The archived MP4 is a backup, selected only when the request explicitly asks for a `video file`, `MP4`, `archived video`, or says that the original is private, removed, deleted, taken down, or unavailable.

Before an archived MP4 is sent, the system sends two separate text messages in strict order: first `@username`, then the captured creator description. If either context message fails, the file is not sent.

## Commands

```powershell
npm install
npm run typecheck
npm test
npm run migrate:local
npm run migrate:remote
npx wrangler deploy
```

After a container image change, recycle warm instances:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev/api/container/recycle" `
  -Headers @{ Authorization = "Bearer <ADMIN_TOKEN>" }
```

## Verified cloud test

Reel `DZIkrEoSoZj` completed on the cloud pipeline in one attempt after moving the multimodal container from 256 MiB to 1 GiB. It archived 15 artifacts, generated a 4.5k-character root note, and created eight linked resource profiles. The transcript, Research tree, frontmatter, `[[wikilinks]]`, original video, and retrieval paths were verified.

## Backlog policy

- Keep automatic historical backlog draining disabled even while live intake is enabled.
- Run a dry selection before every pilot and require ten recoverable, previously unseen canonical post IDs.
- Use a unique `pilot_key`; retries return or resume the same run rather than creating another ten jobs.
- Stop after the keyed target. Inspect completion, failures, duplicates, token use, and library publication before approving another pilot.
- Pilot `backlog-pilot-2026-08-09-10` completed ten of ten jobs on the first attempt, with zero failures or duplicates and 968,025 total Codex tokens.
