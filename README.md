# dsh-sub2api: DSH 0.2 Adaptation

[中文文档](./README.zh.md) | [Changelog](./CHANGELOG.md)

Connect a [Sub2API](https://github.com/Wei-Shaw/sub2api) gateway to [DeepSeek Harness](https://github.com/deepseek-ai/dsh). This is the **duya07/dsh-sub2api** fork of GodD6366's plugin, based on upstream commit `610ff6f26370a587223cff27449ea894ad87da96`. The package identity remains `@godd6366/dsh-sub2api`, version `0.2.1-dsh02.5`; that name does not identify a new fork release on npm. This delivery is not an npm publication.

## Verified Scope

The local adaptation was verified with **DSH 0.2.0-rc.2** and **desktop 2.0.17**. Other versions are not covered by this verification.

- The original adaptation's 136 automated tests and server/client typechecks passed. The release copy adds packaging and bounded cross-platform test-wait regressions, for 138 passing tests in total.
- Browser checks covered 192 cases and 2,320 assertions across four viewport sizes.
- Review was completed. Browser checks used mocked services and are not a production full-chat validation.

Gateway availability, quotas, protocol support and actual reasoning behavior depend on the upstream service. This adaptation does not establish that `upstream_error` is resolved.

## Install This Fork

Use a local tarball built from this repository. Do not install the npm package by name and assume it is this fork. Use a Node version allowed by `package.json`: `^22.19.0 || >=24.0.0`, plus npm, Git and the verified DSH installation.

```sh
git clone https://github.com/duya07/dsh-sub2api.git
cd dsh-sub2api
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --ignore-scripts
dsh plugin --profile desktop add ./godd6366-dsh-sub2api-0.2.1-dsh02.5.tgz
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
