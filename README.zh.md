# dsh-sub2api：DSH 0.2 适配

[English](./README.md) | [变更记录](./CHANGELOG.md)

将 [Sub2API](https://github.com/Wei-Shaw/sub2api) 网关接入 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)。这是 **duya07/dsh-sub2api** fork，基于 GodD6366 上游提交 `610ff6f26370a587223cff27449ea894ad87da96`。包名暂保持 `@godd6366/dsh-sub2api`，版本为 `0.2.1-dsh02.5`；保留包名不表示 npm 上已有此 fork 的新版本。本次交付不是 npm 发布。

## 已验证范围

本地适配已在 **DSH 0.2.0-rc.2**、**desktop 2.0.17** 上验证，不承诺其他版本兼容。

- 原适配的 136 项自动化测试及服务端、客户端类型检查通过；发布副本增加 packaging 和跨平台测试等待回归检查，合计 138 项通过。
- 浏览器检查覆盖 192 个案例、2,320 次断言和四种视口尺寸。
- Review 已完成。浏览器检查使用 mock 服务，不是生产环境完整聊天验证。

网关可用性、额度、协议支持和真实思考行为取决于上游服务。此次适配不证明 `upstream_error` 已解决。

## 安装此 Fork

推荐从此仓库构建本地 tarball。不要安装 npm 同名包后就认为得到此 fork。准备满足 `package.json` 要求的 Node（`^22.19.0 || >=24.0.0`）、npm、Git 及上述已验证 DSH 环境。

```sh
git clone https://github.com/duya07/dsh-sub2api.git
cd dsh-sub2api
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --ignore-scripts
dsh plugin --profile desktop add ./godd6366-dsh-sub2api-0.2.1-dsh02.5.tgz
```

`npm test` 会先构建再测试，因此即使安装、打包时禁用了生命周期脚本，打出的包仍包含刚构建的 `lib` 产物。上述 tgz 名称来自当前包名与版本；若它们发生变化，请使用 `npm pack` 实际输出的文件名。安装后重启 DSH/desktop。若使用的不是 `desktop` profile，将命令中的 `desktop` 换成自己的 profile 名称。

包声明 `dsh.bundle.patch: ./cordis.patch.yml`，该 bundled patch 以现有包名插入 `llm-sub2api` 条目。普通聊天配置会翻译给宿主 `llm-pi-ai` 适配器，本插件不替换其流式、工具调用实现，也不修改默认 agent 模型。

## 优先使用设置 UI

打开 DSH 设置中的 **Sub2API** 页面，添加端点，选择平台、协议，填写各端点的 key，获取或手动添加模型并保存；之后在 DSH 选择相应路由与模型。端点与模型详情可折叠，便于管理较大的列表。

每个端点拥有独立名称、base URL、凭据引用、协议和模型目录。支持多个独立网关，也支持同一平台使用多个 key。Sub2API key 绑定网关分组，因此获取模型展示的是该 key 返回的目录，不等于所有模型或功能均可用。

base URL 填裸主机地址，例如 `http://localhost:8080` 或 `https://gateway.example.test`，不要附带 `/v1`。协议按网关实际接口选择：`openai-responses`、`openai-completions` 或 `anthropic-messages`。端点 URL 留空时继承共享 URL。非空 `endpoints` 列表完全接管聊天 profiles；没有该列表或列表为空时，仍兼容 legacy 共享 URL 与 `providers` 配置。

DSH 0.2 通过所选 profile 的 **`cordis.patch.yml`** 保存配置，不是 `settings.yaml`。优先用 UI，不需要手改真实 profile。适配使用 `settings.configure({ auto: false })`、volatile schema 字段及延后的首次 profile 同步，遵循 DSH 0.2 loader 契约。

key 写入 DSH credential store，配置只保留引用名，不保存 key 值，读回接口也不返回秘密。例如 `EXAMPLE_SUB2API_KEY_REF` 只是虚构引用名，不是凭据值。只有配置保存明确报告 `not-committed` 时才补偿凭据写入；已提交或提交状态未知时保留 key，包括提交结果不确定的非 200 响应，避免损坏可能已经保存的配置。

## 保守思考档位探测

自动探测**默认关闭**。单个模型可用按钮手动探测。开启某端点的自动选项后，显式执行 **Discover / 获取模型** 或 **Fill / 补全数据** 才会将其模型加入探测队列；所有符合条件的模型都会排队，不只第一项，单纯打开设置页不会启动这类自动批次。

服务端共享全局调度器，上一次探测请求结束到下一次开始至少间隔 **5 秒**。探测会发出真实请求，可能消耗额度。排队及进行中的任务均可取消；限流可能延长等待。

结果分为 `accepted`、`unsupported`、`unknown`。只有同一档位得到两次精确、明确的参数拒绝，且无 effort 参数的对照请求成功，才会从建议中剔除。超时、认证或额度问题、上游失败、模糊响应和参数被转换等情况保持 `unknown`，保守保留该档位。`accepted` 仅表示参数被接受，**不能证明模型实际进行了思考**。

新建、未编辑且未关闭思考的模型行可以自动填入建议；已保存行、手动修改的思考字段和显式 `off` 不会被自动覆盖。使用 **Apply suggestion / 应用建议** 后再保存，才能主动接受修改。公共模型元数据只是起点，不是网关支持的证明。

## 用量与生图

用量查询访问所选端点的 `/v1/usage`，需要网关支持。生图使用单独选择的生成模型，将结果保存到工作区，并可返回内联图片附件；支持端点路由，也兼容 legacy provider 引用。当前聊天模型不必具有生图能力，实际图片及协议支持仍取决于网关。

## 许可与归属

采用 [MIT](./LICENSE)，保留上游 **Copyright (c) 2026 GodD6366** 版权声明。DSH 0.2 适配与 fork 维护位于 [duya07/dsh-sub2api](https://github.com/duya07/dsh-sub2api)，上游来源为文首所列提交。此次适配范围见变更记录。
