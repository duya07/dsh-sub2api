# Changelog

## 0.2.1-dsh02.5

- Adapted settings to the verified DSH 0.2.0-rc.2 / desktop 2.0.17 loader contract: volatile configuration, `settings.configure({ auto: false })`, and deferred initial profile synchronization.
- Added independent endpoint/key/protocol/model configuration, foldable details, and endpoint-aware image selection while retaining legacy provider configuration compatibility.
- Added conservative reasoning probes: default-off automatic mode, explicit Discover/Fill batches, manual single-model runs, a global five-second gap from request end to next start, cancellation, unknown-level retention, and explicit Apply for saved/manual/off rows. Parameter acceptance is not proof of actual reasoning.
- Protected credential persistence: compensate only explicitly uncommitted settings saves; retain keys when a commit is confirmed or uncertain.
- Documented source-to-local-tarball installation and the verified scope: original 136 tests plus one packaging test (137 total), server/client typechecks, and 192 mocked browser cases with 2,320 assertions across four viewport sizes. Review completed; production full-chat validation and resolution of `upstream_error` are not claimed.
- Fork maintained at `duya07/dsh-sub2api`, based on GodD6366 upstream commit `610ff6f26370a587223cff27449ea894ad87da96`. Retained `@godd6366/dsh-sub2api` package identity and upstream MIT attribution. No new fork npm package or npm publication is implied.
