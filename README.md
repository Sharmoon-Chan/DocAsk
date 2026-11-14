# 问档 DocAsk

在开源 [JChatMind](https://github.com/youngyangyang04/JChatMind) 基础上持续开发的 Spring AI Java Agent 系统。继承 **Think-Execute 循环 + 状态机**，新增持久化执行、后台权限、正文检索评测及资料原文交付。

技术栈：Java 21 · Spring Boot 3.5.8 · Spring AI 1.1.0 · PostgreSQL 17 + pgvector · MyBatis · React 19 + TypeScript + Ant Design

> **当前验收回填（2026-11-12）**：已上线、具可靠执行和证据验收的工程MVP，6c与公开两库13篇/150片段保持。单元473=469通过+4既有跳过，PG70为r6且r7相关类等价；新9run独立8通过/1问题、来源8/8与HTTP14通过。10真实精选/19引用、最终13原文和6项桌面UI均已核对，旧v7与候选完成归档清理。B14超时参考噪声保留；检索仍单路向量，BM25混检/重排/校准阈值未完成，详见[修复记录](docs/development/deliveries/20261111-source-answer-fixes.md)。

> **名称说明**：产品对外名称是 **问档 DocAsk**。仓库历史代号、数据库名、表前缀（`exobrain_*`）、
> 环境变量（`EXOBRAIN_IT_*`）、Cookie、部署目录 `/opt/exobrain` 与镜像标签仍沿用 `exobrain`，
> 这些是内部标识，改名需要数据迁移与停机，未随本次改名一起调整。

## 在线入口：游客免登录与账号密码登录

| 模式 | 入口 | 访问范围 |
| --- | --- | --- |
| 游客免登录 | [公开体验](https://docask.sharmoon.cc.cd/) | 指定演示 Agent、公开知识库、当前浏览器的个人体验历史及只读示例对话 |
| 普通用户登录 | [账号登录](https://docask.sharmoon.cc.cd/admin/) | 自己的 Agent、知识库、文档与会话；可使用公开助手和只读公开资料 |
| 管理员登录 | [账号登录](https://docask.sharmoon.cc.cd/admin/) | 管理用户、系统 LLM / Embedding 模型及公开演示；私有知识库、助手和会话仍按账号隔离 |

账号模式使用应用内登录页和服务端会话，可退出登录与修改自己的密码。管理员可以创建账号、调整角色、启停账号和重置密码；停用、改密或变更角色会撤销已有登录。所有账号的私有资源和历史相互独立，管理员角色也不能列出、预览、检索、修改或删除其他账号的私有知识库，不能通过其助手或会话绕过隔离。公开助手和知识库在普通用户工作区中只读。当前账号由管理员创建，不提供自助注册。

新建知识库默认仅当前账号可见。“我的知识库”与“公开演示库”分开展示；新建、上传和聊天不会把私人资料自动发布。共享同一登录账号的使用者属于同一数据空间，需要互相隔离时应使用不同账号。

知识库详情提供“删除知识库”及二次确认，删除该库的文档、检索索引和模型绑定，并解除助手引用。原文件在数据库提交后清理，临时失败会进入持久队列重试；删除事务失败时保留原数据和文件。已有聊天记录不随知识库一起删除。

- **个人体验历史**：消息保存在数据库，访客身份由 HttpOnly Cookie 识别。HTTPS 下 Cookie 使用 Secure、SameSite=Lax，有效期 30 天。同一 Cookie 可在刷新后继续读取历史；清除 Cookie、过期后获得新 Cookie 或更换浏览器，不能凭新身份找回原访客会话。历史不会自动变成公开内容。
- **示例对话**：[查看示例](https://docask.sharmoon.cc.cd/showcase) 展示使用公开资料实际执行、经审核后发布的问答、工具调用和结果，用于说明项目能力。示例为只读，原访客也不能继续发送、改名、删除或订阅其 SSE；体验同一问题需新建个人会话。
- **Agent 关联标识**：历史列表、对话顶部及示例页按会话保存的 `agentId` 匹配当前可见 Agent 名称，桌面与移动端均可查看。缺失关联、加载失败和不可见状态有独立提示，不回退为默认 Agent。名称不是历史配置快照；空关联的会话仍可读，但不能继续发送空 Agent ID 的消息。
- **工具范围（修复版源码）**：公开执行器只装配 `KnowledgeTool`、`getDate`、`sourceAnswer`、`terminate`；知识检索受当前身份、助手范围和公开白名单限制。`sourceAnswer`由公开执行器显式创建，不作为通用组件改变账号侧工具语义。普通用户不能启用管理工具；管理员可配置已注册的邮件等可选工具。数据库查询、文件系统示例工具禁止进入账号执行器，生产环境不注册通用SQL查询工具。

前端由同一源码构建游客版和账号版，账号版按角色显示管理入口。接口在后端校验登录、角色、资源归属和写请求验证，不依赖菜单是否可见。构建、资源白名单、网关和更新步骤见 [部署说明](deploy/README.md#build)。

管理员可在“系统模型”新增、编辑、启停和测试系统 LLM / Embedding 模型；新建助手从已启用的 LLM 列表选择。API Key 加密存储且不在读取接口中返回。每个知识库绑定自己的 Embedding 模型，切换默认值只影响新知识库；已有绑定禁止直接变更模型名、协议或维度，避免混用向量。当前向量维度为 1024。

## 公开示例资料

2026-11-11已完成v10索引切换及6c代码热升级；当前公开资料为v10项目库和100题学习库：

| 知识库 | 内容 | 对应发布的有效片段 |
| --- | --- | --- |
| [问档项目资料 v10](docs/public-demo/v10-2026-11-11/manifest.json) | 产品导览、工程案例、能力归属；3篇，包含原文交付、调用期限与分块严格进展的实现和边界 | 40 |
| [高频八股学习整理](docs/interview-kb/xiaolin-2026-11-11/README.md) | 基于小林 coding 公开资料独立整理；10 篇、100 题，逐题保留官方参考链接 | 110 |

八股主题包括 Java 基础与集合、并发、JVM、Spring、MySQL 索引与事务、Redis 数据结构与缓存、计算机网络和操作系统。整理稿不是原站镜像或官方答案，“高频”表达备考优先级。

只有两份manifest的documents正文用于索引，提示词、测试清单、验收报告、README与manifest不上传。11-11 v7发布时备份清理原三个过时项目库及9篇文档；11-12又经完整备份删除退役v7库及其3篇文档，并完成文件清理，当前两库和10条精选保持。历史对话正文、本地v1/v7及其他冻结原件保留；已删旧库的原文入口不再可读。

[只读示例](https://docask.sharmoon.cc.cd/showcase)已于11-12实际发布10条核对通过的真实回答：9条full、1条明确partial，19处引用对应9份可读原文，原回答没有手改。2026-11-11 15:34的v7曾有10条精选与31次抽查，其[v7历史验收](docs/interview-kb/verification-20261111/README.md)和原失败记录保留；旧v7库已于11-12完成备份与退役删除。v8/v9准备稿和触发原件保留。新增100道学习问答不等于100题检索基准，下面的历史50题指标不作为新库成绩。

在知识库的文档列表点击 Markdown 文件名或“预览”入口，可以打开只读内容并切换“预览 / 源码”。支持 UTF-8 编码的 `.md`、`.markdown` 文件，扩展名不区分大小写，原文件最大 **2 MiB（2,097,152 字节）**。源码视图显示文件原文；索引方式见下一条。

- **索引与引用**：新建知识库按**正文**切块建索引（章节路径 + 正文，带源文件 SHA-256 与行号范围），检索结果包含可核验的来源位置；回答默认展示紧凑来源入口，展开后可逐条打开授权原文并定位到对应行。**未显式重建的旧知识库继续使用原有的标题向量索引**，两种策略不混用；旧记录没有可靠行号时只打开整份文档，不伪造位置。引用有效只证明来源身份与位置可核对，不代表答案已被判定正确。
- **排队与中断**：提问的返回表示用户消息、固定输入快照与**持久化运行任务**已在同一事务落库（`QUEUED`，响应带 `runId`）；执行由数据库队列的worker领取，重启后排队任务继续领取，已执行而结果未知的运行标为**中断**。同幂等键重试取得同一运行，不再创建第二条用户消息或任务；同一次运行中的模型请求仍可能按策略重试。**不承诺**任意步骤的无重复续跑，也不自动重放结果未知的外部调用。

游客只能预览已列入公开名单的知识库文档。登录后可以预览自己有权访问的文档，接口为 `/api/` 或 `/admin/api/`，均校验服务端会话和知识库权限；文档原文接口不返回服务器存储路径。接口与部署要求见 [Markdown 预览说明](deploy/README.md#markdown-preview)。

## 检索评测

自建 50 题冻结评测集：40 题有答案、10 题资料不足，按语义问题组切成 dev 30 题和保留测试集 20 题。语料是 4 份文档（正文切块后 23 个片段），其中 1 份是刻意写入错误数字的干扰文档。只测检索，不调用生成模型；两种策略使用同一语料、同一 `BAAI/bge-m3`，每题取前 3 个片段。

| 命中口径 | 检索策略 | Hit@1 | Hit@3 | MRR@3 |
| --- | --- | --- | --- | --- |
| `frozen-v1` | 上游做法：只对章节标题建向量 | 0.650 | 0.850 | 0.738 |
| `frozen-v1` | 本仓库：正文切块 | 0.525 | 0.600 | 0.562 |
| `body-window-v2` | 上游做法：只对章节标题建向量 | 0.650 | 0.850 | 0.738 |
| `body-window-v2` | 本仓库：正文切块 | **0.875** | **1.000** | **0.933** |

- **为什么有两种口径**：`frozen-v1` 要求片段的行范围包含证据的标题行。正文切块的片段从正文第一行开始，标题放在元数据里，所以 44 个证据单元中有 17 个在这个口径下结构性不可命中。`body-window-v2` 只改这一条：片段覆盖证据的正文，且标题在片段的章节路径里。它是看到 `frozen-v1` 的结果之后才定的，所以两组数字并列给出，旧数字保留。
- **下一步看什么**：这40道有答案题的Hit@3已达1.000，但完整证据仍为43/44，且干扰片段可能同样进入前三条。还需改善首位排序、证据完整性和无答案拒答（10题在检索阶段仍不拒）。原文交付不会自动改变这些检索指标，后续策略要用可区分的新样本继续比较。
- 口径定义、逐题差异和复现命令见 [`evaluation/README.md`](evaluation/README.md)。上表数字由离线测试固定：`python -m pytest evaluation/tests`。

---

## 它和「聊天机器人」差在哪

本项目的普通对话示例完成一次模型请求；Agent 运行时则循环执行“决策 → 工具执行 → 结果回填”。模型根据已获得的信息，决定继续取资料、使用工具，还是交付最终答复。

### 修复版公开知识检索的流程示意

```text
用户询问项目实现
→ think：选择 KnowledgeTool，提供获准知识库 ID 与查询文本
→ execute：检索并回填结构化片段（含文档、章节与行号范围），保存工具调用记录
→ think：调用 sourceAnswer，选择来源ID、连续原文锚点及full/partial覆盖状态
→ 服务端：核验本轮来源、锚点和权限，完整展示命中片段并生成编号；部分覆盖显示固定提示
→ execute：完成交付确认；正文是资料原文，来源可打开核对
```

这是已部署公开运行时的流程示意。非法交付允许一次修正；已有检索时可给明确的原文参考，没有既有本轮来源时仅显示未确认服务提示。受限检索仍按权限执行，故障不能被当作已经证明资料不存在。原文交付保留片段内的条件和例外，partial只表明模型声明尚未覆盖部分，不证明语义正确。`CityTool`和`WeatherTool`只是非生产示例；getDate读取真实日期，复合日期与知识问题继续检索。

当前[v10提示词模板](docs/public-demo/v10-2026-11-11/agent-system-prompt.md)增加了通用的关系、组合保证与成立前提的检索规则，模板指纹见[清单的prompt字段](docs/public-demo/v10-2026-11-11/manifest.json)。三篇知识正文保持冻结；旧ded1模板和其完整50次候选回归保留，当前提示词的13次代表复验单独记录，不能将旧50次运行当作当前提示词成绩。

---

## 循环是怎么终止的

运行时支持以下结束路径：

| 路径 | 触发 | 代码位置 |
|---|---|---|
| **公开原文交付** | `sourceAnswer`选择本轮来源，服务端校验并交付完整原文 | `think()` / `execute()` |
| **兼容答复通道** | 账号/旧策略下按实际工具使用`directAnswer`或`groundedAnswer` | `think()` / `execute()` |
| **自然终止** | 模型这一轮没调工具，且已经产出面向用户的答复 | `think()` / `step()` |
| **主动终止** | 执行 `terminate`，并检查是否已经给出答复 | `execute()` |
| **步骤上限** | 达到`MAX_STEPS = 20`仍无答复时置ERROR，避免空答复成功 | `run()` |

收尾与修正有预算，混合取证和交付批次在执行前拒绝。原文参考可以是明确标识的交付结果，但运行完成仍不能代替对相关性、来源事实和问题覆盖的判断。

---

## 关键设计

### 1. 手动接管工具执行

```java
this.chatOptions = DefaultToolCallingChatOptions.builder()
        .internalToolExecutionEnabled(false)   // ← 关键
        .build();
```

Spring AI 的内部工具执行可以接管工具调用与结果回填。本项目关闭这一行为，由自己的运行时逐步执行，从而在每轮模型响应和工具结果之间插入记录与状态处理：

- 拿到**原始的、带 `toolCalls` 的**响应，能记录执行轨迹（`logToolCalls()`）
- **「是否继续」的判断权**回到自己手里
- 状态机 `AgentState` 能跟着走
- 消息持久化 + SSE 推送有了挂载点

这为扩展重试或中断提供了位置，但不代表所有工具都已实现中断和回滚。

### 2. 工具系统：声明 → 发现 → 分类 → 装配

- **声明**：实现 `Tool` 接口 + `@Component`，方法上标 `@Tool(name=..., description=...)`
- **发现**：`ToolFacadeServiceImpl` 构造器注入 `List<Tool>` —— Spring 把容器里所有实现 `Tool` 的 Bean 自动收集成 List。**没有注册表，发现靠集合注入**
- **分类**：按 `ToolType` 分成 `FIXED`（系统强制，如 `terminate`）/ `OPTIONAL`（按 Agent 配置下发）
- **装配**：`JChatMindFactory.resolveRuntimeTools()` = 全部 FIXED + 按该 Agent 的 `allowedTools` 挑 OPTIONAL
- **转换**：`MethodToolCallbackProvider` 把 `@Tool` 方法反射成 `ToolCallback[]`，在 `think()` 里交给模型

同一个工具可以有两套名字：

| 类 | `Tool.getName()`（系统侧名称） | `@Tool(name=)`（模型侧调用名称） |
|---|---|---|
| `KnowledgeTools` / 公开执行器的 `DemoKnowledgeTool` | `KnowledgeTool` | `KnowledgeTool` |
| `DateTool` | `dateTool` | `getDate` |
| `DataBaseTools` | `dataBaseTool` | `databaseQuery` |
| `EmailTools` | `emailTool` | `sendEmail` |

`Tool` 接口 + `ToolType` 用于管理、分类和配置；`@Tool` 注解 + `ToolCallback` 用于模型调用。`allowed_tools` 填系统侧的**可选工具**名称；固定工具无需填写。不匹配的可选名称会被跳过。

公开执行器有独立的四工具白名单，`SourceAnswerTool`由它显式创建，不走通用组件发现。它清空的只是当前运行时配置副本中的可选工具列表，数据库中的管理端选择保持不变。公开知识检索还会再次验证知识库是否在发布名单内，权限不依赖提示词约束。

### 3. Agent 是数据，不是代码

`system_prompt`、`model`、`allowed_tools`、`allowed_kbs`、`chat_options` 都存在 `agent` 表里。账号登录后可按资源权限创建、修改或删除 Agent，配置修改不需要重新构建代码。会话保存关联的 `agent_id`；删除 Agent 后，数据库会把该关联置空并保留会话历史。

### 4. 系统模型目录

`ChatClientRegistry` 根据 `agent.model` 保存的目录 ID，读取数据库中的已启用 LLM 配置，再由 `ModelRuntimeService` 创建实际客户端。目录 ID 和发给服务商的模型名独立；管理员可在“系统模型”配置 DeepSeek、OpenAI 兼容接口及智谱，无需修改前端选项或重新编译。模型被停用或不存在时会明确拒绝运行，不回退到旧的静态客户端。

首次启动导入已有服务配置，后续以数据库中的管理配置为准。API Key 使用独立持久密钥进行 AES-GCM 加密，读取接口仅返回是否已配置。Embedding 支持 OpenAI 兼容接口和 Ollama，每个知识库固定绑定一个 1024 维模型；切换默认值只影响新知识库。已绑定模型更换服务地址必须保持相同模型和向量空间，换模型或供应商时应新建模型与知识库并重新导入资料。

### 5. RAG：PostgreSQL 一套体系管结构化数据和向量

`chunk_bge_m3` 保存正文片段和 1024 维向量。当前只对 Markdown（`.md` / `.markdown`）自动解析与索引。新库使用 `body-v1`：按章节与正文长度切块，以章节路径和正文生成向量，记录来源哈希、行号与索引 revision；查询只读取该库已发布的活动 revision。未重建的旧库保留标题向量策略。

建表脚本配置 `ivfflat (embedding vector_l2_ops)`，与 L2 查询距离算子匹配；实际是否使用索引由数据库规划器决定。入库和查询使用同一 Embedding 绑定与维度。检索返回结构化来源，答复工具只接受本轮真实检索产生的引用 ID。PDF/Word 解析、混合检索与重排仍未实现。

---

## 可靠性处理与当前限制

以下机制分别处理答复交付、推送中断和模型繁忙等情况；执行流程结束与回答正确是不同的判断。

### 1. 区分决策输出与最终答复

公开SOURCE_EXTRACTIVE策略不展示模型改写的正文，只接受来源选择或真实检索后的不足信号。服务端由同一来源生成完整片段与编号，固定不足提示不拼模型reason。旧directAnswer/content回退仅存在于相应兼容策略，不能作为公开旁路。

### 2. SSE 推送中断与历史恢复

统一的 `trySend()` 捕获推送失败，避免单纯的连接中断终止 Agent。已经入库的消息可从历史接口重新读取；SSE 每 15 秒发送注释心跳，前端重连后刷新历史并按消息 ID 去重。

### 3. 检查是否有面向用户的答复

`userAnswerProduced`在答复持久化成功后才置为true；达到20步仍无答复则ERROR。普通消息和成功终态在事务写前写后核验取消与数据库当前时刻的租约，等待期间过期不能继续成功提交。取消、中断和租约丢失不会被内容回退吞掉。

### 4. 模型失败分类、有界重试与原文参考

根据实际状态码和异常类型区分限流、连接、读取超时、上游故障与响应解析问题，对适合重试的请求有界处理。公开模式无法可靠交付时，可以给出明确的真实原文参考；这不是自动切换模型，也不是生成模型已经答对。历史五次模型阶段失败只确认I15-a2为429，其余四次旧日志原因未知，不能统一归因为限流。

### 5. SSE 状态事件

运行时推送 `AI_THINKING`、`AI_EXECUTING`、`AI_GENERATED_CONTENT` 和 `AI_DONE`。`AI_PLANNING` 仍是预留事件类型，不表示已经实现单独的规划阶段。

**尚未实现**：自动切换备用模型和自助注册。账号、角色、普通用户资源隔离以及系统模型管理已实现。

---

## 快速开始

### 依赖

| 组件 | 版本 | 说明 |
|---|---|---|
| JDK | 21 | 编译目标与部署运行时均为 21 |
| Maven | 使用仓库 Wrapper | 当前 Wrapper 为 3.9.11 |
| PostgreSQL | 17 + pgvector | 部署模板使用 `pgvector/pgvector:pg17` |
| Node.js | 22+ | 仅前端需要 |

### 1. 起数据库（pgvector）

以下是本地开发示例。先在当前终端环境提供 `POSTGRES_PASSWORD`，不要把密码写进源码或提交到 Git。

```bash
docker run -d --name jchatmind-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD -e POSTGRES_DB=jchatmind \
  -p 127.0.0.1:5433:5432 -v jchatmind_pgdata:/var/lib/postgresql/data \
  pgvector/pgvector:pg17
```

### 2. 建表

```bash
docker exec -i jchatmind-postgres psql -U postgres -d jchatmind -v ON_ERROR_STOP=1 < db/jchatmind.sql
docker exec -i jchatmind-postgres psql -U postgres -d jchatmind -v ON_ERROR_STOP=1 < deploy/migrations/20261014-accounts.sql
docker exec -i jchatmind-postgres psql -U postgres -d jchatmind -v ON_ERROR_STOP=1 < deploy/migrations/20261014-models.sql
docker exec -i jchatmind-postgres psql -U postgres -d jchatmind -v ON_ERROR_STOP=1 < deploy/migrations/20261016-storage-cleanup.sql
```

基础脚本创建业务表、`vector` 扩展、索引和默认 Agent；迁移补充账号、会话、资源归属、模型目录和文件清理队列。已有数据库升级时只执行尚未应用的迁移，不重复执行带默认数据的基础脚本。

### 3. 配置并启动后端

按 [application.yaml](jchatmind/src/main/resources/application.yaml) 的结构，在本机 `jchatmind/src/main/resources/application-dev.yaml` 配置数据库连接、模型服务和嵌入服务。嵌入服务必须返回 1024 维向量。该开发文件已被模块 `.gitignore` 排除，打包规则也排除它；真实密码和 API Key 不应写入跟踪文件。

另在仓库外准备管理员初始密码文件，以及内容为 32 个随机字节的 Base64 文本的模型加密密钥文件，在开发配置中设置：

```yaml
app:
  auth:
    public-origin: http://localhost:5173
    secure-cookie: false # 仅本机 HTTP 开发；HTTPS 部署使用 true
    bootstrap-admin-username: admin
    bootstrap-admin-password-file: /absolute/private/path/admin-password
  models:
    encryption-key-file: /absolute/private/path/models-encryption-key
```

初始密码仅在账号表为空时用于创建管理员。首次启动会把现有模型配置导入加密模型目录，并给旧知识库绑定原 Embedding；后续在界面维护模型，重启不会覆盖修改。请保留并备份加密密钥。

在仓库根目录使用 PowerShell，确认 `JAVA_HOME` 指向 JDK 21：

```powershell
Set-Location jchatmind
.\mvnw.cmd spring-boot:run '-Dspring-boot.run.profiles=dev'
```

IDEA 的 Active profiles 同样填 `dev`。生产环境使用 `prod`，具体见 [部署说明](deploy/README.md)。

### 4. 起前端

另开终端，从仓库根目录运行：

```powershell
Set-Location ui
npm ci
npm run dev
```

默认本地开发使用管理功能的 `/api` 与 `/sse`，Vite 将请求代理到本机后端。公开体验还需配置演示 Agent 和资源发布名单；线上游客版与登录版应按 [双构建说明](deploy/README.md#build) 分别构建，不能只修改运行时环境变量来切换。

### 5. 用 curl 调（可选）

以下仅演示本机开发 API。先准备包含 `username`、`password` 的私有 `login.json`，登录后保留 Cookie，并从响应 `data.csrfToken` 读取写请求验证值到 `CSRF_TOKEN`。登录文件和 Cookie 文件应放在仓库外。使用前替换真实的 Agent / 会话 ID；游客继续使用受限的 `/api/demo/` 与 `/sse/demo/`。

```bash
# 登录并保存 Cookie；响应包含 data.csrfToken
curl -c cookies.txt -X POST localhost:8080/api/auth/login \
  -H "Content-Type: application/json" --data-binary @login.json

# 建会话
curl -b cookies.txt -X POST localhost:8080/api/chat-sessions \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"agentId":"<id>","title":"test"}'

# 先挂 SSE 长连接（后台）
curl -b cookies.txt -N -s "http://localhost:8080/sse/connect/<chatSessionId>" > sse.log &

# 再发消息（role 必须小写 user）
curl -b cookies.txt -X POST localhost:8080/api/chat-messages \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"agentId":"<id>","sessionId":"<sid>","role":"user","content":"请调用日期工具告诉我今天的日期。"}'

# 看轨迹
curl -b cookies.txt -s "http://localhost:8080/api/chat-messages/session/<sid>"
rg -o '"type":"[A-Z_]*"' sse.log | sort | uniq -c
```

关键接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` / `GET` | `/api/auth/login` / `/api/auth/me` | 登录与当前账号身份 |
| `POST` / `PATCH` | `/api/auth/logout` / `/api/auth/password` | 退出与修改自己的密码 |
| `GET` / `POST` / `PATCH` | `/api/admin/users` / `/api/admin/users/{id}` | 管理员维护账号 |
| `GET` | `/api/models` | 当前账号可选的启用模型，不含凭据 |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/admin/models` / `/api/admin/models/{id}` | 管理员维护系统模型 |
| `POST` | `/api/admin/models/{id}/test` | 管理员测试模型连接 |
| `GET` / `POST` / `DELETE` | `/api/knowledge-bases` / `/api/knowledge-bases/{id}` | 按账号列出、创建和删除知识库；列表以 `publicResource` 区分公开演示资料 |
| `POST` | `/api/chat-sessions` | 建会话，返回 `chatSessionId` |
| `POST` | `/api/chat-messages` | 发消息，异步触发 Agent |
| `GET` | `/api/chat-messages/session/{id}` | 完整消息历史（含 toolCalls / toolResponse） |
| `GET` | `/sse/connect/{chatSessionId}` | SSE 长连接，收状态与生成内容 |
| `GET` | `/api/agents` `/api/tools` | Agent 列表 / 可用工具列表 |
| `GET` | `/api/documents/{documentId}/content` | 登录后按资源权限读取 Markdown 原文；线上亦可通过 `/admin/api/documents/{documentId}/content` 访问 |
| `GET` | `/api/demo/documents/{documentId}/content` | 游客读取已公开知识库中的 Markdown 原文 |

两种原文接口均返回 `ApiResponse`，其 `data` 为 `{documentId, filename, content}`；`content` 是按 UTF-8 解码并移除可选 BOM 的文件文本。预览是只读操作，文件格式与大小限制对游客和账号模式均适用。


---

## 目录结构

```
jchatmind/src/main/java/com/kama/jchatmind/
├── agent/
│   ├── JChatMind.java          # Agent 运行时：think / execute / step / run
│   ├── JChatMindFactory.java   # 按 Agent 配置装配运行时（工具 / 知识库 / 会话记忆）
│   ├── AgentState.java         # 状态机
│   ├── examples/               # 演进过程：V1 基础聊天 → V2 引入循环
│   └── tools/                  # 工具实现（知识库 / 数据库 / 邮件 / terminate）
├── auth/                       # 登录会话、角色、资源归属与运行时权限
├── citation/                   # 引用登记：只有本轮真实检索到的片段能被答复引用
├── config/                     # ChatClientRegistry、CORS、异步
├── controller/                 # REST + SSE 入口
├── demo/                       # 游客身份、公开资源白名单、独立执行器与精选记录
├── event/                      # ChatEvent：提交后唤醒队列 worker，事件丢失不丢任务
├── execution/                  # 运行记录与事件追踪（模型 / 检索 / 工具 / 落库耗时）、查询接口
├── ingestion/                  # 持久化导入队列：上传入队、失败重试、孤儿文件清理
├── models/                     # 系统模型目录、密钥加密、动态客户端与知识库绑定
├── retrieval/                  # 正文切块、候选索引核对后原子发布、检索授权
├── runs/                       # 持久化对话任务：同事务入队、SKIP LOCKED 领取、租约与 fencing、后台权限复核
├── service/                    # 会话 / 消息 / 知识库 / RAG
└── ...
ui/                             # React 19 + antd 前端
db/jchatmind.sql                # 建表脚本
deploy/                         # 双构建、容器与 Nginx 部署模板
docs/public-demo/               # 公开示例、检索测试与演示提示词
docs/development/               # 开发任务书、共享契约与交付记录
```

---

## 开发指南

[优化开发指南](docs/development/README.md) 保留任务书、契约与各轮交付记录；任务 01–07 已有实现，不能把历史任务书统一理解为未完成。[访客体验优化](docs/development/visitor-experience/README.md) 记录一键提问、运行恢复、阅读定位与真实问答验收。是否已发布，以相应交付记录中的版本与线上证据为准。

---

## 工程文档与检查

- [架构说明](docs/architecture.md)：实际请求链路、身份校验、索引发布与执行恢复边界，并明确区分已实现能力与待实现方案（03–07）。
- [设计决策（ADR）](docs/adr/README.md)：后台工作线程的权限传播等决策；其余任务的条目位置先保留，内容由对应任务提供。
- [来源与许可](docs/provenance.md)：上游 JChatMind 来源、MIT 许可，以及继承能力与本仓库新增能力的划分。
- 构建、双前端、网关与更新/回滚步骤见[部署说明](deploy/README.md#build)；历史验证记录保留在该文档内，不在本 README 重复。
- 统一检查入口（CI 与本地使用同一份逻辑）：`scripts/check.sh`（Linux / CI）与 `scripts/check.ps1`（Windows）。默认只跑确定性单元 profile；`--postgres-it` 跑真实 PostgreSQL 17 + pgvector 集成（未配置数据库时如实报告为跳过），`--frontend` 跑前端 lint，`--build` 跑游客版与账号版两次构建，`--all` 全部执行。CI 工作流为 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)，不注入生产凭据、不自动部署。
- 检索评测的冻结语料、题集与运行脚本在 [`evaluation/`](evaluation/)；真实语义评测不属于常规检查，需显式运行，未运行时如实标记。

---

## 来源与许可

问档 DocAsk 基于 [JChatMind](https://github.com/youngyangyang04/JChatMind) 持续开发，Java 包名沿用 `com.kama.jchatmind`。项目保留上游作者程序员 Carl 的版权声明，并遵循 [MIT License](LICENSE)；继承能力与本仓库新增能力的划分见[来源与能力归属](docs/provenance.md)。使用和再分发时请保留原许可与版权声明。
