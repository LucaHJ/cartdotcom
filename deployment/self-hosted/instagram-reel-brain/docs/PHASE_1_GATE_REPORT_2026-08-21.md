# Phase 1 Health Gate Report

Decision: passed; Phase 2 contract and isolated-fixture work approved.

Reviewed at: 2026-08-21 01:10 Australia/Brisbane

Cloudflare remains the sole production authority. This approval does not
authorise production data import, live intake, local job claims, Codex
execution, outbound Instagram actions, publication, credential rotation,
cutover, or any real backlog processing.

## Evidence

- The amended deadline of 2026-08-21 01:00 Australia/Brisbane passed before
  this decision.
- The synthetic workload completed normally at
  2026-08-20T15:00:00.876Z after 22,405 cycles.
- The workload wrote 1,124 synthetic records and exercised the isolated Reel
  health endpoints, CPU, memory, and Reel test volume only.
- The monitor recorded 121 samples. Reel and News unhealthy counts remained
  zero after the documented initial probe defect was invalidated.
- All six Reel containers were healthy after the gate with zero restarts.
- News services were healthy after the gate. The server retained about 13 GiB
  available memory, load remained modest, and the root volume was 6% used.
- News completed 1,624 research jobs during the gate. Average synthesis time
  was 26.9 seconds and p95 was 41.0 seconds, compared with 26.6 seconds and
  38.0 seconds in the available pre-gate sample.
- News retry incidence was effectively unchanged: 11 of 106 successful jobs
  needed a second attempt before the gate (10.4%), compared with 172 of 1,674
  during the gate (10.3%). No associated research job remained pending,
  running, or permanently failed at review time.

## Failure-marker adjudication

The raw `failure.detected` file is retained as evidence. Its only remaining
line is:

```text
2026-08-20T15:00:01+00:00 reel_unhealthy=0 news_unhealthy=0 stress_running=false
```

This is not a valid workload or service failure. The synthetic process reached
its configured deadline and wrote `state: complete` at 15:00:00.876Z. The
monitor then sampled at 15:00:01Z and treated the expected stopped process as a
failure before its deadline-finalisation branch ran. No Reel or News service
was unhealthy in that sample.

## Bounded Phase 2 approval

Approved:

- Port Cloudflare-independent domain logic into tested local modules.
- Implement the PostgreSQL repository and local object-store contracts.
- Adapt the existing Python media processor behind an internal-only API.
- Add disabled adapters for Cloudflare Whisper, Browser Rendering, R2 mirror,
  KV/library publication, and Instagram outbound operations.
- Run synthetic fixtures and a scrubbed export only in an isolated test
  database and test storage root.
- Add database, artifact, deduplication, carousel, interruption, idempotency,
  and authority-fence tests.

Not approved:

- Production D1 import or R2 backfill.
- Live/shadow intake or production delta mirroring.
- Local dispatch, Codex, publication, outbound actions, or authority changes.
- Real backlog replay or selection.
- Phase 3 or any later migration phase.

Phase 2 is complete only when its test gate passes and its evidence has been
reviewed independently.
