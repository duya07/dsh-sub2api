# Changelog

## 0.2.1-dsh02.9

- Reasoning probe: the `maxTokens > cap` short-circuit is gone for every protocol. It predicted `budget-limited` from the model's own output limit even though the probe always requests `maxTokens: cap`, so on OpenAI-style routes it stranded all five levels before a single request went out (the payload writes `max_output_tokens = cap`, which is exactly the accepted bound). Levels are now judged by the payload the SDK actually built; `budget-limited` survives as a real payload verdict and still carries the `maxTokens`/`cap` numbers the settings page renders.
- Verification: 213 tests plus server/client typechecks, and three mutations turn the new assertions red (re-introducing the OpenAI-only exemption, short-circuiting every protocol, dropping the budget numbers).

## 0.2.1-dsh02.8

- Reasoning probe failures are visible: the probe route returns a short classified reason (request parsing, draft parsing, key resolution, probe start) instead of the fixed `probe request unavailable` string, and the client bounds that reason where it is stored (200 characters) rather than only where it is rendered. A level that was transformed or never sent now names the wire parameter, the observed value and the expected level instead of the generic "parameter converted or not sent".
- Claude platform: an adaptive anthropic route declares the `off` level again (wire value `null`) so the host no longer drops it from the picker and thinking can be turned off. Selecting it makes pi-ai send `thinking: { type: "disabled" }` on the wire; whether a deployment accepts that flag is not verified, and OpenAI-style routes keep their verbatim `reasoning_effort` spelling.
- Verification: 212 tests plus server/client typechecks. Each fix is covered by a mutation that turns its own assertions red (probe reason classification, storage-time bound, not-exact wording, `off` declaration).

## 0.2.1-dsh02.7

- Reasoning probe: a failed no-effort control now ends the probe as "aborted" with a visible reason (was reported as "complete" with every level unknown); a rate-limited control is retried once after `Retry-After` (skipped beyond the 10-minute task lifetime); 401/403 are never retried; levels are never removed because of an abort.
- Claude platform: anthropic-messages routes write `compat.forceAdaptiveThinking: true` (per-model `thinkingMode: 'budget'` opts out); OpenAI routes unchanged.
- Added optional `web_search` provider (default off), `generate_image` reference-image editing via `/images/edits`, image-slot endpoint route persistence fix, and per-endpoint `streamIdleTimeoutMs`.
- Verification: 196 tests plus typechecks; real-gateway checks limited to one `/images/edits` and one `web_search` request (on 0.2.1-dsh02.6). The probe-abort and Claude fixes are not verified against a real gateway.

## 0.2.1-dsh02.5

- Adapted settings to the verified DSH 0.2.0-rc.2 / desktop 2.0.17 loader contract: volatile configuration, `settings.configure({ auto: false })`, and deferred initial profile synchronization.
- Added independent endpoint/key/protocol/model configuration, foldable details, and endpoint-aware image selection while retaining legacy provider configuration compatibility.
- Added conservative reasoning probes: default-off automatic mode, explicit Discover/Fill batches, manual single-model runs, a global five-second gap from request end to next start, cancellation, unknown-level retention, and explicit Apply for saved/manual/off rows. Parameter acceptance is not proof of actual reasoning.
- Protected credential persistence: compensate only explicitly uncommitted settings saves; retain keys when a commit is confirmed or uncertain.
- Documented source-to-local-tarball installation and the verified scope: original 136 tests plus packaging and bounded cross-platform test-wait regressions (138 total), server/client typechecks, and 192 mocked browser cases with 2,320 assertions across four viewport sizes. Review completed; production full-chat validation and resolution of `upstream_error` are not claimed.
- Fork maintained at `duya07/dsh-sub2api`, based on GodD6366 upstream commit `610ff6f26370a587223cff27449ea894ad87da96`. Retained `@godd6366/dsh-sub2api` package identity and upstream MIT attribution. No new fork npm package or npm publication is implied.
