# 候选发布的语义与边界评审

本目录的评审只读取已经保存的候选运行，不发起网页、SSH、模型或数据库请求，不修改原始记录，也不把题目和判断标准上传到知识库。

## 已核对的用例与记录结构

- `boundary-cases.json`：44道单题＝原20题＋24道新变体，另有3组各2轮的会话场景，以及16项执行边界场景。
- 原20题没有 `category` 和 `semanticChecks`，辅助脚本兼容；新增题使用这些字段提示人工核对重点，不存放固定答案。
- 单轮记录沿用 `smoke_content.py` 的 `id/attempt/question/runId/sessionId/summary/messages/events/answer/citations/sourceChecks`。
- 多轮使用 `scenarioId` 和从1开始的 `turnIndex`，也接受 `C01-T1`、`C01-T2` 形式的id。同组必须使用同一session，各轮保留自己的runId和答案关联。
- 取不到本轮 `answerMessageId` 时，答复应保持空，不能退回历史中最后一条助手消息。旧采集脚本的这个回退在多轮中会误取旧答案。

## 自动判定与人工判断

| 检查 | 辅助脚本能做什么 | 还需要什么 |
| --- | --- | --- |
| 原题与轮次 | 精确核对case问题和指定attempt，保留每次记录 | 不把改写后的问题冒充原题通过 |
| 终态与答案关联 | 检查成功但无答复、关联消息不符、跨run答复、重复正文 | 不能只凭SUCCEEDED推断回答质量 |
| 本轮真实检索 | 对应实际请求的KnowledgeTool响应，确认引用ID和来源来自该run | 缺少messages时只能待补证据，不能自动宣称归属通过 |
| 来源完整性 | 检查保存的哈希/行号结果，复算300 UTF-16单位节选，比较实际命中身份 | 哈希全文件原件由采集端核对；本脚本不冒称重新下载了文档 |
| 完整原文交付 | 将明确的原文引用块恢复，与sourceLines比较；标出遗漏、额外正文或复杂格式差异 | 渲染差异由人工确认，不能把转义差异直接当语义错误 |
| 无资料 | 确认固定不足结果之前有本轮可读检索，区分不可用与无匹配 | 有资料的问题是否被错误拒答，必须看题目和原文 |
| 相关性与复合问题 | 按预期文件和类别提示风险，生成逐题原文评审包 | 判断核心证据是否齐全、跨章节是否错配、两个问题是否都覆盖 |
| 条件、版本和绝对化 | 完整原文一致说明未机械删句 | 仍需判断选中的原文是否适用题设，不能以固定关键词打分 |
| 多轮 | 检查同session、本轮答案及来源归属 | 检查指代、是否补答旧任务、是否丢失前轮版本限制 |
| 取消、租约和步骤上限 | 不用普通问答替代故障注入 | 查看相应单元及真实PG回归证据；本辅助脚本不执行故障操作 |

`PASS` 的机械结果只意味着上述机械检查通过。没有独立人工结论时，最终结果保持 `PENDING`。降级原文参考单独记为 `SOURCE_REFERENCE_FALLBACK`，不把它自动算成完成了生成回答，也不自动选为精选。

`PARTIAL_SOURCE_ANSWER` 单独统计部分覆盖交付。固定提示只说明已声明未覆盖部分，并不能证明选中的原文正确回答了已覆盖部分；仍需人工核对。辅助脚本同时识别a1旧降级文案及修复后的明确未确认文案，不改写历史记录。

覆盖声明从本轮 `answerMessageId` 所关联消息的真实 `sourceAnswer` 参数读取，与服务端固定提示核对，不只信任采集端的便捷字段。省略 `coverage` 视为 `full`；`partial` 和 `insufficient` 分别核对对应正文，声明与正文不符属于机械问题。这个检查验证交付契约，不能代替人工判断是否确实覆盖了问题。

模型初次失败后，如果没有经过选择的资料，固定未确认输出单独记为 `DEGRADED_UNCONFIRMED`。它必须保留本轮降级事件和可读检索证据；检索不可用不能冒充正常资料不足。真实执行状态可仍为 `SUCCEEDED`，但这个输出没有回答问题，不进入精选，也不能使 `allContentCasesPassed` 为真。故障后已有来源的原文参考仍是 `SOURCE_REFERENCE_FALLBACK`，同样单独统计。

每轮和汇总报告都保留真实 `MODEL_CALL`、`MODEL_RETRY` 的成功与失败计数，以及已有诊断中的失败类别和 HTTP 状态。答复最终完成不会抹掉之前的失败尝试；缺少类别记为 `UNSPECIFIED`，不从时间或回退结果推断供应商根因。

这里计数的是调用方登记的模型调用尝试，不能把每条事件等同于已发出的网络 HTTP。固定传输容量已满或服务已关闭时，客户端会在发送前拒绝，诊断保留 `dispatch=not-started`；审核汇总单列这类尝试。未记录该字段不代表已证明发送，供应商 HTTP 失败则按已有状态码独立统计。

采集端的 `probeError`、`collectionError` 会保留为待核对项，实际运行status不被覆盖；超时后由探针请求取消单独标记。报告的 `allContentCasesPassed` 仅覆盖本轮内容用例，`overallReleaseVerdict` 固定为未判定，不能替代16项执行场景和真实PostgreSQL验证。

## 建议的最短验收流程

1. 候选执行器按同一attempt跑44单题，并在各自同一会话中跑3组多轮；每次尝试原样保留。不要先挑成功记录再交给评审。
2. 对这一轮运行辅助脚本，先处理 `ISSUE`，再看 `REVIEW` 提示。脚本没有网络依赖，不会重复产生模型调用费用。
3. 将 `review-packet.md` 按Java/Spring、MySQL/Redis、网络/OS/项目三组并行分派。原文段落能恢复一致时，评审包只列原文一次，避免同时阅读同一内容的answer与sourceLines副本。
4. 人工填写模板的 `verdict`、`reason`、`showcaseSuitable`；理由说明核心证据与条件是否满足，而非“看起来没问题”。真实语义问题判 `ISSUE`，纯表述风格不阻断。
5. 合并人工结果时写入另一个新输出目录。失败仍保留，不按旧脚本的“最后一次成功”规则替换；精选从最终通过且人工明确适合展示的记录中选择。

Windows 示例：

```powershell
python 'D:/Code/Java/JChatMind/docs/interview-kb/verification-20261111-fixes/review_boundary_results.py' `
  --results '候选证据目录的绝对路径' --attempt 'candidate-a1' --output '新评审目录的绝对路径'
```

合并人工结果时增加 `--decisions '人工判断JSON绝对路径'`，可重复提供多个文件，并使用新的 `--output` 目录。JSON为数组，条目包含 `id`、`attempt`、`runId`、`verdict`、`reason`、`showcaseSuitable`。同一id/attempt有多个运行时必须用runId消歧，不能把一次的判断套给另一轮。

输出包括 `summary.json`、`mechanical-review.json`、`semantic-decisions-template.json`、`review-packet.md`。脚本拒绝覆盖已经存在的输出目录，退出后控制台仅显示计数与输出路径，不输出会话Cookie、密码或运行正文。
