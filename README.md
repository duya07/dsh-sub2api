# dsh-sub2api: DSH 0.2 Adaptation

[中文文档](./README.zh.md) | [Changelog](./CHANGELOG.md)

Connect a [Sub2API](https://github.com/Wei-Shaw/sub2api) gateway to [DeepSeek Harness](https://github.com/deepseek-ai/dsh). This is the **duya07/dsh-sub2api** fork of GodD6366's plugin, based on upstream commit `610ff6f26370a587223cff27449ea894ad87da96`. The package identity remains `@godd6366/dsh-sub2api`, version `0.2.1-dsh02.7`; that name does not identify a new fork release on npm. This delivery is not an npm publication.

## Changes Relative To Upstream

Compared with upstream `GodD6366/dsh-sub2api` at `610ff6f`:

1. **DSH 0.2.0-rc.2 adaptation.** Upstream calls the removed `settings.installSection`; this fork uses `settings.configure({ auto: false })`, volatile fields and deferred boot synchronization.
2. **Multiple independent endpoints and keys**, each with its own base URL, protocol, key reference and model list; foldable endpoint rows.
3. **Safer key saving.** Preflight before any key write, serialized saves, and compensation only for a proven `not-committed` configuration failure.
4. **Conservative reasoning-effort probing**, default off, with a global five-second request gap, cancellation, and no removal of a level without repeated explicit rejection plus a successful control.
5. **Probe aborts are now visible.** If the no-effort control request fails (429, authentication/quota, SDK unavailable), the probe shows "probe aborted" with the reason instead of "probe complete" with every level unknown. A rate-limited control is retried once after the gateway's `Retry-After` (never when it exceeds the 10-minute task lifetime); 401/403 are never retried. Other control failures still continue level by level, and no level is removed.
6. **Claude-platform thinking fix.** Anthropic-messages routes write `compat.forceAdaptiveThinking: true` (opt out per model with `thinkingMode: 'budget'`), because models such as `claude-sonnet-5-5` reject the `thinking.type=enabled` request the host would otherwise send (`400 ... requires adaptive thinking`). OpenAI-route output is unchanged and covered by a baseline fixture.
7. **Optional `web_search` provider** for the host web seam (id `sub2api`, off by default, only available for `openai-responses` endpoints, one request without hidden retries).
8. **`generate_image` reference-image editing** through `/images/edits` (1-5 references; invalid references are an error, never silently downgraded to text-to-image), and a fix so an endpoint route chosen in the image slot is saved instead of dropped.
9. **Per-endpoint `streamIdleTimeoutMs`** for slow streaming gateways.

Not adopted from reviewed projects: subscription logins, account pools, quota displays, Claude Code credential reuse, changing the default model, `x_search` and video generation.

## Verified Scope

The local adaptation was verified with **DSH 0.2.0-rc.2** and **desktop 2.0.17**. Other versions are not covered by this verification.

- The full suite (196 tests, including packaging and cross-platform wait regressions) and server/client typechecks passed. Behaviors above were covered by mutation tests that fail when the fix is removed.
- Browser checks (192 cases, 2,320 assertions, four viewport sizes) were run on the earlier 0.2.1-dsh02.5 build; they have not been re-run for the later additions.
- Against a real gateway, one `/images/edits` request and one `web_search` request were each verified once on the 0.2.1-dsh02.6 build. The probe-abort/retry behavior (item 5) and the Claude adaptive-thinking fix (item 6) are verified with mocked transports and the real host SDK request builder only; they have **not** been verified against a real rate-limited or Claude-platform gateway.
- Review was completed. Browser checks used mocked services and are not a production full-chat validation.

Gateway availability, quotas, protocol support and actual reasoning behavior depend on the upstream service.

## Install This Fork

Use a local tarball built from this repository. Do not install the npm package by name and assume it is this fork. Use a Node version allowed by `package.json`: `^22.19.0 || >=24.0.0`, plus npm, Git and the verified DSH installation.

```sh
git clone https://github.com/duya07/dsh-sub2api.git
cd dsh-sub2api
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --ignore-scripts
dsh plugin --profile desktop add ./godd6366-dsh-sub2api-0.2.1-dsh02.7.tgz
```

`npm test` runs the build before the tests, so the tarball includes freshly built `lib` assets even though lifecycle scripts are disabled during install and packing. The tarball name above follows the current package name and version; use the actual filename printed by `npm pack` if they change. Restart DSH/desktop after adding the plugin. If your active profile is not `desktop`, replace `desktop` with your own profile name.

The package declares `dsh.bundle.patch: ./cordis.patch.yml`. That bundled patch inserts the `llm-sub2api` entry using the existing package name. Normal chat profiles are translated into the host's `llm-pi-ai` adapter; this plugin does not replace its streaming or tool-call implementation and does not change the default agent model.

## Configure In The UI

Open DSH Settings and select **Sub2API**. Add endpoint rows, choose a platform and protocol, enter each endpoint's key, obtain or add its models, and save. Then select the desired route/model in DSH. Endpoint and model details can be folded to keep a large catalog manageable.

Each endpoint has its own name, base URL, credential reference, protocol and model catalog. Multiple independent gateways or multiple keys on the same platform are supported. Sub2API keys belong to gateway groups, so discovery reflects the catalog returned for that key, not proof that every model or feature is operational.

Enter a bare gateway host, such as `http://localhost:8080` or `https://gateway.example.test`, without `/v1`. Choose the protocol the gateway actually serves: `openai-responses`, `openai-completions` or `anthropic-messages`. An endpoint with an empty base URL inherits the shared URL. A nonempty `endpoints` list is the sole source of chat profiles; the legacy shared URL and `providers` configuration remain supported when that list is absent or empty.

DSH 0.2 persists configuration through the selected profile's **`cordis.patch.yml`**, not `settings.yaml`. Prefer the UI rather than editing a real profile manually. The adapter uses `settings.configure({ auto: false })`, volatile schema fields and deferred initial profile synchronization for the DSH 0.2 loader contract.

Keys are written to the DSH credential store; configuration retains references, not key values, and read-back never returns secrets. A fictional reference such as `EXAMPLE_SUB2API_KEY_REF` is a reference name, not a credential value. Credential writes are compensated only when settings persistence explicitly reports `not-committed`. A committed or unknown outcome, including a non-200 response with an uncertain commit state, retains the key to avoid breaking configuration that may already have been saved.

## Reasoning Probes

Automatic probing is **off by default**. A per-model button starts a manual single-model probe. Enable an endpoint's automatic option before explicitly using **Discover / 获取模型** or **Fill / 补全数据** to enqueue its models. All eligible models are queued, not just the first model; opening settings alone does not start that automatic batch.

Probes share a server-wide scheduler with at least **five seconds from one request ending to the next starting**. They send real, potentially billable requests. Queued and running probes can be cancelled. Rate limits can extend the wait.

Results distinguish `accepted`, `unsupported` and `unknown`. A level is excluded from the suggestion only after two exact, explicit parameter rejections with a successful no-effort control. Timeouts, authentication/quota problems, upstream failures, ambiguous responses and parameter transformations remain `unknown` and are retained conservatively. `accepted` means the parameter was accepted, **not proof that the model actually reasoned**.

Suggestions may populate new, unedited rows that have not disabled reasoning. Saved rows, manual reasoning edits and explicit `off` are not automatically overwritten: use **Apply suggestion / 应用建议**, then save, to accept a change. Public metadata is a starting point, not evidence of gateway support.

## Usage And Images

Usage lookup queries the selected endpoint's `/v1/usage` when supported. Image generation uses a separately selected generation model, saves the result to the workspace and can return an inline attachment. It supports endpoint routes and legacy provider references. Generation does not require the current chat model to generate images; actual image/protocol support remains gateway-dependent.

## License And Attribution

[MIT](./LICENSE). The upstream copyright notice, **Copyright (c) 2026 GodD6366**, is retained. DSH 0.2 adaptation and fork maintenance are in [duya07/dsh-sub2api](https://github.com/duya07/dsh-sub2api); upstream provenance is the commit noted above. See the changelog for this adaptation's scope.
