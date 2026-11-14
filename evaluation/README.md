# ExoBrain 检索评测（开发任务 02）

本目录是可复现的检索评测基线：冻结语料、题集与标签、离线校验器、离线测试、真实检索运行器与对比脚本。
它只测**检索**（Embedding + 向量查询），不调用生成模型，因此不产出回答质量或事实支持度结论。

- 任务说明：[docs/development/tasks/02-retrieval-evaluation.md](../docs/development/tasks/02-retrieval-evaluation.md)
- 共享契约（来源哈希/行号/indexVersion 语义）：[docs/development/contracts.md](../docs/development/contracts.md) 第 2、3 节
- 交付报告：[docs/development/deliveries/02.md](../docs/development/deliveries/02.md)

**结果一览**（50 题冻结集：40 题有答案、10 题资料不足；语料 4 份文档；同一 `BAAI/bge-m3`，`topK = 3`）

| 命中口径 | 检索策略 | Hit@1 | Hit@3 | MRR@3 |
| --- | --- | --- | --- | --- |
| `frozen-v1`（第 3 节） | `legacy-title-v1`：只对章节标题建向量 | 0.650 | 0.850 | 0.738 |
| `frozen-v1`（第 3 节） | `body-v1`：正文切块 | 0.525 | 0.600 | 0.562 |
| `body-window-v2`（第 3.1 节） | `legacy-title-v1`：只对章节标题建向量 | 0.650 | 0.850 | 0.738 |
| `body-window-v2`（第 3.1 节） | `body-v1`：正文切块 | 0.875 | 1.000 | 0.933 |

两种口径用的是同一批逐题检索结果，差别只在命中判据。两组数字要一起读，读法见第 7.2 节。

## 1. 目录与职责

| 路径 | 内容 |
| --- | --- |
| `corpus/v1-2026-10-14/manifest.json` | 冻结语料清单：只有 `documents` 列出的原始文档进入索引 |
| `corpus/v1-2026-10-14/docs/*.md` | 三份公开演示资料（与 `docs/public-demo/` 逐字节相同） |
| `corpus/v1-2026-10-14/synthetic/eval-only-java-notes.md` | 评测专用合成文档（`synthetic-eval-only`，不得上传产品知识库） |
| `datasets/questions-v1.jsonl` | 50 题（40 有答案 / 10 资料不足），含 gold 证据单元与期望事实 |
| `datasets/freeze.json` | 冻结记录：题集与保留测试集哈希（调参前固定） |
| `datasets/criteria-v2.json` | 命中口径 v2 的冻结记录：判据定义、适用的题集与语料哈希、两次基线运行的结果指纹（第 3.1 节） |
| `scripts/exo_common.py` | 路径、哈希、JSON(L)、分位数等工具 |
| `scripts/exo_corpus.py` | manifest 校验、语料快照、分节规则 |
| `scripts/exo_dataset.py` | 题集结构/证据/split 校验 |
| `scripts/exo_scoring.py` | 命中判据与指标（纯函数，离线可测） |
| `scripts/exo_criteria.py` | 命中口径 v2（`body-window-v2`）的判据实现；`frozen-v1` 仍在 `exo_scoring.py` |
| `scripts/exo_runtime.py` | Embedding HTTP 客户端、psql 桥、检索策略适配器 |
| `scripts/validate.py` | 命令行校验器（题集 + 语料 + 冻结哈希） |
| `scripts/run.py` | 真实运行器：建索引、逐题检索、输出结果与 run manifest |
| `scripts/compare.py` | 同条件两次运行的对比报告 |
| `scripts/diagnose_boundaries.py` | 命中差距的边界归因诊断（只读；不改变冻结指标） |
| `scripts/rescore.py` | 按口径 v2 重算已有运行（只读 `results.jsonl`，不调用 Embedding、不访问数据库） |
| `runs/legacy-title-v1/` | 真实基线结果（逐题 JSONL、失败、请求、SQL、run manifest） |
| `runs/body-v1/` | 真实候选结果（同一题集与模型；含 `comparison.md`、`chunks.csv`、`index-snapshot.json`、`boundary-diagnostic.json`） |
| `runs/<运行>/summary.body-window-v2.json` | 该运行按口径 v2 的汇总；`summary.json` 仍是 `frozen-v1` |
| `runs/body-window-v2-report.md` / `.json` | 两种口径并列的报告，逐条列出判定不同的证据单元 |
| `tests/` | 离线 pytest（失败路径与已知排名夹具），不访问网络与数据库 |

## 2. 语料与来源许可

- 三份公开演示资料是本仓库自写的项目说明（仓库根 `LICENSE`：MIT），核对日期 2026-10-14；语料副本与 `docs/public-demo/01..03*.md` **逐字节相同**（`tests/test_frozen_assets.py` 会校验）。`manifest.documents[].sourcePath` 记录来源路径，`sha256`/`normalizedSha256` 记录原始字节与标准化文本（UTF-8 解码 → 去首个 BOM → CRLF/CR 统一为 LF）的哈希。
- `synthetic/eval-only-java-notes.md` 是本任务自写的合成文本，`role = synthetic-eval-only`。它**刻意写入与仓库事实不符的数字**（Java 17、Spring Boot 3.2.0、React 16、512 维、返回 10 个片段、MySQL 全文检索），用于制造「同标题不同内容」与「相近但错误干扰信息」。任何引用它的回答都应判为错误；它不得上传到产品知识库、公开演示环境或产品文档。
- **不入库**：题集/答案标注/冻结记录（`datasets/**`）、评测脚本与测试、`docs/development/**`、`docs/public-demo/99_test_questions.md`（只作为出题种子）与 `agent-system-prompt.md`。索引只从 `manifest.documents` 取文档，`run.py` 不会扫描目录。
- 语料不含私人数据、账号信息、Cookie 或线上配置；密钥从不进入语料、题集、结果或仓库内任何文件。
- 评测在**隔离目标库**中进行：容器 `exobrain-dev-pg` 里的 `exobrain_eval`，只操作本次运行自己的 `kb_id`（`DELETE FROM chunk_bge_m3 WHERE kb_id = <eval kb uuid>`），不触碰 `exobrain`（应用库）。

## 3. 命中判据（固定口径）

一条 hit（检索片段）**覆盖**某个 gold 证据单元 `E`，当且仅当：

1. `hit.docKey == E.docKey`，且两侧 `sourceHash` 都存在时相等（任一侧缺失则跳过哈希比对，只能靠行号与事实核验）；
2. hit 的来源行范围**完全包含** `E` 的行范围（`hit.startLine <= E.startLine` 且 `hit.endLine >= E.endLine`）——只与某一行相交**不算**命中；
3. `E.facts` 中每条事实字符串（空白折叠后）都出现在 hit 返回给模型的**正文**（`payload`）里；
4. hit 缺少 `startLine/endLine` 或缺少 payload 时视为「无法核验」，不计命中。

证据单元角色：`required`（参与 Hit/Recall/MRR）、`distractor`（相近但错误的干扰，单独统计）、`insufficiency`（资料不足题里说明边界的语句，不参与命中率）。

题集里的证据用 `docKey + sourceHash + startLine/endLine + facts` 标注（**不使用会随重新分块变化的 chunk UUID**）；同一个语义问题组内的多个问题共用同一证据签名；不同 `groupId` 不允许出现完全相同的必填证据签名（防止同义改写被拆到不同组/不同 split）。

## 3.1 命中判据 v2（`body-window-v2`，2026-11-10 冻结）

第 3 节的判据（下称 `frozen-v1`）要求单个片段的行范围**完整包含**证据单元。44 个 required 单元里有 17 个以章节标题行开头，而 `body-v1` 的片段从正文第一行开始，标题进入元数据 `headingPath` 和向量输入。这 17 个单元在 `frozen-v1` 下结构性不可命中（第 7.1 节）。`body-window-v2` 只改这一条，其余与 `frozen-v1` 相同。

一条 hit 覆盖证据单元 `E`，当且仅当：

1. `hit.docKey == E.docKey`，且两侧 `sourceHash` 都存在时相等；
2. hit 的行范围完全包含 `E` 的**正文窗口**：`E` 行范围内第一行到最后一行的非空、非标题行。`E` 内没有正文行时要求整段包含；
3. `E.facts` 的每条事实字符串（空白折叠后）都出现在 hit 的 `payload` 里；
4. `E` 行范围内的每个标题行，要么落在 hit 的行范围内，要么标题文本（去掉全部空白后）出现在 `hit.headingPath` 里；
5. hit 缺少 `startLine/endLine` 或 `payload` 时不计命中。

约束与边界：

- **`frozen-v1` 判为覆盖的 hit，在 v2 下一定仍然覆盖**：整段包含同时满足第 2、4 条。v2 没有放宽文档、来源哈希、事实字符串这三项。`tests/test_criteria_v2.py` 在夹具和两次真实运行上都断言了这一点。
- **两种口径并存**。`frozen-v1` 的 `summary.json`、`comparison.md` 不改不删；v2 的结果写在各运行目录的 `summary.body-window-v2.json` 和 `runs/body-window-v2-report.md`。
- **这是事后口径**：它在 `body-v1` 的 `frozen-v1` 结果出来之后才提出（2026-10-18，[交付报告](../docs/development/deliveries/02.md)第 12.5 节），不是预先登记的。对外报 v2 的数字时，要同时给出 `frozen-v1` 的数字。
- **冻结记录** `datasets/criteria-v2.json` 固定判据定义、题集与 dev/test 哈希、语料 manifest 哈希，以及两次基线运行的 `runId` 和逐题结果指纹。记录与当前文件不一致时 `rescore.py` 拒绝运行，已有记录不会被覆盖。之后新增的检索策略都按这份记录计分；再改判据需要新的口径 id 和新的记录。
- 标题行按 `exo_corpus.split_sections` 的规则识别：ATX 标题，围栏代码块里的 `#` 行不算。带闭合 `#` 的标题（`## 标题 ##`）可能和产品写入 `headingPath` 的文本对不上，会被判为未覆盖；冻结语料里没有这种写法。

## 4. 指标口径

| 指标 | 分母/算法 | 说明 |
| --- | --- | --- |
| Hit@k | 前 k 含**至少一个**被覆盖 required 证据单元的有答案题数 / 有答案题数 | 覆盖判据见第 3 节，不只按文档名 |
| Recall@k | 每题被覆盖的 required 证据单元数 / 该题 required 证据单元总数，再按题平均 | 重复片段覆盖同一证据只算一次 |
| MRR@k | 每题第一个正确证据排名的倒数（无命中记 0），再平均 | 只在有答案题统计 |
| 微平均 Recall@k | 所有题的 (被覆盖证据数 / gold 证据总数) 汇总比 | 与宏平均并列，避免小题数类别放大 |
| 跨文档覆盖率@k | 每题覆盖的**文档**数 / 该题 required 涉及的文档数，按题平均 | `allRequiredDocumentsCoveredRateAt` 为全文档覆盖的题目比例 |
| 无答案拒绝表现 | 无答案题中检索返回 `NO_MATCH` 的比例 | 检索级拒绝；**服务故障不计入拒绝**，单独计数并给出排除故障后的比例 |
| 干扰片段命中率 | 有 distractor 单元的题中，干扰单元被 top-k 返回的比例 | 衡量「相近但错误」资料的干扰程度 |
| 延迟 | 检索（含 Embedding）与每题 Embedding 分别报 `n / min / p50 / p95 / max / mean` | 顺序执行、无缓存、已预热一次；样本量小时 p95 只是插值点，见第 8 节 |

排期与 k：`kValues = [1, 3]`，`topK = 3`；`compare.py` 默认按 k=3 报告。回答级指标（引用有效性、事实支持度）不在本任务范围。

## 5. 语料、题集与 split 冻结

- `datasets/questions-v1.jsonl`：50 题 = 40 有答案 + 10 资料不足；按**语义问题组**切分为 dev 30 题（60%）/ test 20 题（40%）。同一 `groupId` 只出现在一个 split 里，同义改写（`paraphrase-zh`）与政策问题（`same-title-different-content`、`distractor`）与其原始问题同组，因此**不会一份在调参集、一份在测试集**。
- 类别分布：`body-fact` 18、`title-fact` 10、`insufficient-info` 10、`paraphrase-zh` 5、`cross-document` 4、`same-title-different-content` 2、`distractor` 1。
- 冻结记录 `datasets/freeze.json` 固定 `datasetSha256`、`testSplitSha256`、`devSplitSha256`、`corpusManifestSha256`、每个文档的 `sha256`；`validate.py --freeze` 与 `run.py --freeze` 都会校验，任何改动都会失败退出。**调参前先冻结，改动题集或语料后必须重新生成冻结记录并重跑基线**，不能在旧基线上比较。
- 语料版本 `v1-2026-10-14` 与题集一起冻结；本任务不因为指标数字修改任何一个事实。

## 6. 精确复现命令

环境：`D:\Soft\Python\Anaconda5.3.0\python.exe`（Python 3.7.0，pytest 3.8.0）。所有命令在仓库根目录执行，密钥只通过环境变量传递。

```powershell
# 0) 设密钥：只写当前 shell 进程的环境变量，绝不写入仓库文件或命令行参数
#    下面这条从仓库内未跟踪的 jchatmind/src/main/resources/application-dev.yaml 读取第一个 api-key（embedding 块）
$env:EXOBRAIN_EVAL_EMBEDDING_API_KEY = (Select-String -Path jchatmind\src\main\resources\application-dev.yaml -Pattern 'api-key:\s*(\S+)').Matches[0].Groups[1].Value
$env:PYTHONIOENCODING = "utf-8"
# 1) 离线校验（题集 + 语料快照 + 冻结哈希）；失败时退出码 2
D:\Soft\Python\Anaconda5.3.0\python.exe evaluation/scripts/validate.py `
  --dataset evaluation/datasets/questions-v1.jsonl `
  --corpus-manifest evaluation/corpus/v1-2026-10-14/manifest.json `
  --freeze evaluation/datasets/freeze.json

# 2) 重新生成冻结记录（只在明确要改动题集时执行，之后必须重跑基线）
D:\Soft\Python\Anaconda5.3.0\python.exe evaluation/scripts/validate.py `
  --dataset evaluation/datasets/questions-v1.jsonl --emit-freeze

# 3) 离线测试（不访问网络与数据库）
D:\Soft\Python\Anaconda5.3.0\python.exe -m pytest evaluation/tests -q

# 4) 真实基线：配置放在仓库之外（示例见 evaluation/run-config.example.json，不含密钥）
D:\Soft\Python\Anaconda5.3.0\python.exe evaluation/scripts/run.py `
  --config <仓库外路径>\eval-config.json `
  --dataset evaluation/datasets/questions-v1.jsonl `
  --corpus-manifest evaluation/corpus/v1-2026-10-14/manifest.json `
  --freeze evaluation/datasets/freeze.json `
  --variant legacy-title-v1 --build-index --out evaluation/runs/legacy-title-v1

# 5) 候选策略 body-v1：索引由产品自己建（上传 -> 导入队列 -> IndexPublisher），
#    本脚本只读；配置需给 kbId，并打开 useActiveRevision 与 docKeyFromDocumentName
D:\Soft\Python\Anaconda5.3.0\python.exe evaluation/scripts/run.py `
  --config <仓库外路径>\body-v1-config.json `
  --dataset evaluation/datasets/questions-v1.jsonl `
  --corpus-manifest evaluation/corpus/v1-2026-10-14/manifest.json `
  --freeze evaluation/datasets/freeze.json `
  --variant body-v1 --out evaluation/runs/body-v1

# 6) 对比（可比性检查 + 逐题差异）
D:\Soft\Python\Anaconda5.3.0\python.exe evaluation/scripts/compare.py `
  --baseline evaluation/runs/legacy-title-v1 --candidate evaluation/runs/body-v1 --k 3

# 7) 归因诊断（只读；把命中差距拆成边界差异与真实检索缺口）
D:\Soft\Python\Anaconda5.3.0\python.exe evaluation/scripts/diagnose_boundaries.py `
  --out evaluation/runs/body-v1/boundary-diagnostic.json

# 8) 按口径 v2 重算（只读 results.jsonl；不需要密钥、Embedding 或数据库）
#    口径记录 datasets/criteria-v2.json 已存在：与当前题集、语料、判据定义或基线结果不一致时退出码 2
D:\Soft\Python\Anaconda5.3.0\python.exe evaluation/scripts/rescore.py `
  --run evaluation/runs/legacy-title-v1 --run evaluation/runs/body-v1
```

第 8 步的输出是确定的：同一批输入重跑，`summary.body-window-v2.json` 与 `runs/body-window-v2-report.*` 逐字节相同（Python 3.7 与 3.11 下都核对过）。`--emit-criteria-freeze --frozen-at <日期>` 只在口径记录不存在时写入，用于将来冻结新的口径 id；已有记录不会被覆盖。新增检索策略时，先用第 4 或第 5 步产出该策略的 `results.jsonl`，再把它的目录加到第 8 步的 `--run` 里。

说明与注意：

- `run.py` 从配置的 `embedding.apiKeyEnv`（默认 `EXOBRAIN_EVAL_EMBEDDING_API_KEY`）读密钥；配置里出现 `apiKey/api_key/key/token` 字段或 `Bearer ` 文本会被拒绝运行，run manifest 只记录环境变量名与是否存在。
- Embedding 服务 `https://emrank.tech/v1`（模型 `BAAI/bge-m3`，1024 维）前置了 Cloudflare：**urllib 默认 User-Agent 会被 403 / `error code: 1010` 拒绝**，客户端因此显式发送 `User-Agent: ExoBrain-Eval/0.1 (+https://github.com/2458438169/ExoBrain)`。
- 仓库内 `application-dev.yaml` 的 `cloudflare/bge-m3` 已失效（404），基线统一用 `BAAI/bge-m3`。
- pgvector 通过 `docker exec ... psql` 访问（本机 Python 环境没有 psycopg2）：容器 `exobrain-dev-pg`、库 `exobrain_eval`、用户 `exobrain`。

## 7. 真实基线结果（legacy-title-v1，2026-10-17）

- 运行：`runId = legacy-title-v1-v1-2026-10-14-20261017T102252Z`，代码提交 `0aa79ed`（运行时刻 HEAD；`evaluation/**` 变更尚未提交），语料 `v1-2026-10-14`（manifest `7999340d…`），题集 `questions-v1.jsonl`（`c795c7f6…`，测试集 `d60b933e…`），50 题全部 `OK`，服务故障 0、重试 0。
- 索引：23 个 section → 23 行，`kbId = b2026ba5-c6c0-5190-96df-028437751e73`，`indexRevision = legacy-title-v1/v1-2026-10-14/62408bc8895f`；Embedding 输入是章节标题，23 次调用共 122.6 s。
- 数据库：PostgreSQL 17.11 + pgvector 0.8.7；生产 SQL（`WHERE kb_id = … ORDER BY embedding <-> :q LIMIT 3`）在该规模下走 `Sort → Bitmap Heap Scan(idx_chunk_bge_m3_kb)`，**未使用 ivfflat 索引**；强制顺序扫描的结果与自然计划 50/50 完全一致（`planDiagnosticMismatch = 0`）。

| 范围 | n | Hit@1 | Hit@3 | Recall@1 | Recall@3 | MRR@1 | MRR@3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 全部 | 40 | 0.650 | 0.850 | 0.637 | 0.812 | 0.650 | 0.738 |
| dev（调参集） | 23 | 0.565 | 0.826 | 0.565 | 0.783 | 0.565 | 0.674 |
| test（保留集） | 17 | 0.765 | 0.882 | 0.735 | 0.853 | 0.765 | 0.824 |

其它真实数字：微平均 Recall@3 = 0.773（全）/ 0.760（dev）/ 0.789（test）；跨文档覆盖率@3 = 0.812，全文档覆盖题比例 = 0.775；干扰片段命中率@3 = 0.857（6/7 题的干扰单元进入 top-3，`distractor` 类别那一题因此完全失败）；无答案 10 题**检索级拒绝率 0.000**（`topK=3` 无阈值，10 题全部返回 3 个片段）；每题检索延迟（含 Embedding）：n=50，p50 = 5467 ms，p95 = 5891 ms，max = 6055 ms，而每题 Embedding 单独看 p50 = 5285 ms——**延迟由远端 Embedding 调用主导**（每次约 5.2–5.9 s），本地向量查询只占几十毫秒。距离分布：有答案题 top1 L2 均值 0.806（min 0.426，max 0.997），无答案题均值 0.935（min 0.736，max 1.033）——**有重叠，不能直接拿单一 L2 阈值当「资料不足」判据**，需要 03 用 dev 集校准。10 道题的 top-3 内部出现完全相同的距离（并列），排名不可区分。

## 7.1 候选结果（body-v1，2026-10-18）与归因

- 索引来源：**产品路径**。冻结语料经 `POST /api/documents/upload` 进入 `exobrain_ingestion_job`
  队列，由 `IndexPublisher` 用产品的 `BodyChunker` 切块、用同一个 `BAAI/bge-m3` 建向量；
  评测端只执行只读 SQL，**没有**在 Python 里重实现切块。一次性库 `exobrain_eval02`，
  发布 revision `7b69ef54-…`，`chunk_count = 23`、`document_count = 4`（`runs/body-v1/index-snapshot.json`、`chunks.csv`）。
- 适配器要求：`kbId` + `useActiveRevision`（产品检索按「KB + 当前 PUBLISHED revision」过滤）
  + `docKeyFromDocumentName`（产品元数据写 `documentName`，`docKey` 是评测标注键）。
- 真实结果（`runs/body-v1/comparison.md`，可比性检查“一致”）：

| 范围 | Hit@1 | Hit@3 | Recall@3 | MRR@3 |
| --- | --- | --- | --- | --- |
| 全部（40 题） | 0.525 | 0.600 | 0.588 | 0.562 |
| dev（23 题） | — | 0.783 | 0.761 | 0.717 |
| test（17 题） | — | 0.353 | 0.353 | 0.353 |

  干扰片段命中率@3 = 0.286（基线 0.857）；无答案检索拒绝率仍为 0.000；检索延迟 p50 = 5182 ms、p95 = 5343 ms。
  **0.286 同样是 `frozen-v1` 的边界产物，不能读成「正文切块更少返回干扰资料」**：7 个干扰单元里有 5 个也以标题行开头。同口径数字见第 7.2 节。
- **必须一起读的归因**（`scripts/diagnose_boundaries.py` → `runs/body-v1/boundary-diagnostic.json`）：
  44 个 required 单元里，body-v1 冻结口径覆盖 26 个，其中 **17 个是「boundary-only」**——片段覆盖了
  去掉首尾标题/空行后的正文窗口、事实字符串也都在 payload 里，只差把标题行算进行范围；
  真实检索缺口只有 1 个。原因是 03 的切块把标题行排除在正文之外（标题进 `headingPath`），
  而本文第 3 节的判据要求单个片段完整包含 gold 行范围。按“正文窗口”诊断口径，body-v1 覆盖
  43/44 单元、40/40 题，legacy 仍是 34/44、34/40。
- 因此：**当前冻结判据下 body-v1 的 Hit/Recall/MRR 低于基线，但差距几乎全部来自判据与切块边界的
  结构性冲突**，不是检索质量下降。判据本身**未修改**；若要正式改变口径，必须重新冻结题集
  （`freeze.json`）并重跑两侧，见 `docs/development/deliveries/02.md` 第 12 节。
  2026-11-10 已按这条要求另行冻结口径 v2，结果见第 7.2 节。

## 7.2 两种口径并列的结果（`body-window-v2`，2026-11-10）

`rescore.py` 用第 7、7.1 节两次真实运行的 `results.jsonl` 原样重新计分，没有重新调用 Embedding 或数据库。
题集、语料和 `freeze.json` 都没有改动；两侧的输入完全相同，差别只在命中判据。完整报告见
[`runs/body-window-v2-report.md`](runs/body-window-v2-report.md)，其中逐条列出了两种口径判定不同的证据单元。

| 范围 | 指标 | 标题向量 / `frozen-v1` | 标题向量 / v2 | 正文切块 / `frozen-v1` | 正文切块 / v2 |
| --- | --- | --- | --- | --- | --- |
| 全部（40 题） | Hit@1 | 0.650 | 0.650 | 0.525 | **0.875** |
| 全部（40 题） | Hit@3 | 0.850 | 0.850 | 0.600 | **1.000** |
| 全部（40 题） | Recall@3 | 0.812 | 0.812 | 0.588 | **0.988** |
| 全部（40 题） | MRR@3 | 0.738 | 0.738 | 0.562 | **0.933** |
| 全部（40 题） | 证据单元覆盖@3 | 34/44 | 34/44 | 26/44 | 43/44 |
| dev（23 题） | Hit@1 / Hit@3 / MRR@3 | 0.565 / 0.826 / 0.674 | 同左 | 0.652 / 0.783 / 0.717 | 0.826 / 1.000 / 0.906 |
| test（17 题） | Hit@1 / Hit@3 / MRR@3 | 0.765 / 0.882 / 0.824 | 同左 | 0.353 / 0.353 / 0.353 | 0.941 / 1.000 / 0.971 |
| 带干扰单元的 7 题 | 干扰片段命中率@1 / @3 | 0.286 / 0.857 | 同左 | 0.000 / 0.286 | 0.286 / 1.000 |
| 无答案 10 题 | 检索级拒绝率 | 0.000 | 0.000 | 0.000 | 0.000 |

怎么读：

1. **同口径下，正文切块比标题向量好**：Hit@1 0.650 → 0.875，Hit@3 0.850 → 1.000，MRR@3 0.738 → 0.933；dev 与保留测试集方向一致。
2. **标题向量的数字在两种口径下逐项相同**。它的片段行范围本来就含标题行，v2 没有给它加分，也没有扣分。
3. **`frozen-v1` 下的下降来自判据**：两种口径判定不同的 required 单元正好是那 17 个以标题行开头的单元，没有别的。
4. **还剩 1 个真实检索缺口**：q022（跨文档题）需要的 `exobrain-overview` 第 25 行没有进入前 3；该题另一份文档的证据排在第 1，所以题目级仍算命中。
5. **正文切块并没有更少返回干扰资料**。同口径下，带干扰单元的 7 题里干扰单元进入前 3 的有 7 题，标题向量是 6 题；排在第 1 的两侧都是 2 题。此前「0.286 对 0.857、干扰明显减少」的说法是 `frozen-v1` 的边界产物，以本节为准。
6. **排第 1 的还差 5 题**（q006、q013、q016、q023、q032），其中 q016、q032 的第 1 名是合成干扰文档。
7. **无答案题在检索阶段仍然一题都不拒**：没有阈值，10 题都返回 3 个片段。正文切块下第 1 名的 L2 距离，有答案题是 0.596–0.968，无答案题是 0.907–1.069，区间重叠。
8. **这套题对「召回」已经到顶**。Hit@3 = 1.000 之后，它分不出更好的召回策略；还能看出差别的只有排序（上面 5 题）和拒答（10 题）。要评估混合检索这类召回侧的改动，需要先补更难的题或更大的语料，并重新冻结。

局限见第 8 节：v2 是事后口径，样本量小，只测检索不测回答。

## 8. 已知局限

1. **只测检索，不测回答**：本任务不调用生成模型，回答级「资料不足」拒绝率、引用有效性与事实支持度均未测（`summary.noAnswer.answerLevelRejection = null`）。
2. **样本量小**：40 有答案题 + 10 资料不足题，2%–3% 的差异不具统计显著性；延迟 p95 只有 50 个样本且是线性插值点，不能当作 SLA。
3. **延迟受远端服务支配**：顺序执行、无缓存、限流未启用；Embedding 单次约 5.3 s，本地查询与网络耗时没有分离测量，生产环境（批量、缓存、并发）会明显不同。
4. **基线语义就是「标题建向量」**：命中判据要求正文里含事实，因此该策略对「事实只出现在正文」的问题天然吃亏（如 q013/q014/q020/q033 的失败），这正是 03 要解决的；不能把本基线分数当成 RAG 效果上限。
5. **合成文档加大难度**：语料含 1 份 `synthetic-eval-only` 干扰文档，与公开演示文档存在同名章节；公开演示资料单独构成的 section 数是 18（与公开基线「3 份文档 18 个 section」一致），加入合成文档后共 23。做对外汇报时若要复现公开基线，应剔除合成文档后重跑，并重新冻结。
6. **单模型单库单机**：只测 `BAAI/bge-m3`(1024) 与 pgvector 0.8.7 / PostgreSQL 17；换模型/距离算子/索引类型都必须重建索引并重新基线。
7. **题集由作者人工标注**：`insufficient-info` 的期望值是「资料未提供」，`expectedFacts` 不参与自动评分；检索级拒绝不能用它替代回答级拒绝。
8. **未测场景**：权限越界、真实超时/限流、索引发布失败与回滚由 03/04/06/07 的任务负责，本目录的故障处理只在离线夹具里覆盖（`UNAVAILABLE` 不计入拒绝）。
9. **判据按「章节整段」设计，对细切块不利**：第 3 节要求单个 hit 完整包含 gold 行范围，而 gold 单元的 `startLine` 常是章节标题行。03 的正文切块把标题行排除在 chunk 之外（标题进 `headingPath`），因此这类单元在 body-v1 下结构性不可命中；第 7.1 节的 boundary-only 统计给出了量化。**判据未修改**，对外报 body-v1 数字时必须同时说明这一点。口径 v2（第 3.1 节）是按这条限制另行冻结的并列口径。
10. **`runs/body-v1/sections.json` 不是候选的切块表**：它仍是冻结语料的章节表（供 legacy 建索引用）；body-v1 的真实切块看 `runs/body-v1/chunks.csv` 与 `index-snapshot.json`。
11. **口径 v2 是事后口径**：它在看到 `frozen-v1` 的结果之后才定，不是预先登记的；它只放宽「标题行必须在片段行范围内」一条，对两侧使用同一判据，冻结后不再调整。v2 的数字不能单独引用，必须和 `frozen-v1` 的数字一起给出。
12. **Hit@3 = 1.000 说明的是题集到顶，不是检索没有问题**：语料只有 4 份文档、23 个片段，每题取前 3 个片段。这套题还能区分的只有排序和拒答；规模变大以后的召回效果，它测不出来。

## 9. 给其它任务的接口

- **03（正文索引与结构化检索）**：用 `datasets/questions-v1.jsonl` 的 dev 集（30 题）调参，test 集（20 题）只在最终比较时用一次；用 `freeze.json` 保证同一题集；用 `runs/legacy-title-v1/summary.json` 的 `distanceSeparation` 校准阈值；命中判据与来源字段语义见第 3 节与 `contracts.md` 第 2、3 节。`body-v1` 适配器（`scripts/exo_runtime.py`）已按真实产品实现校准：只读、按 `active_revision_id` 过滤、用 `documentName` 映射 `docKey`；**产品元数据需要 `indexVersion/documentName/sourceHash/startLine/endLine/headingPath`**，缺任何一个都只能降级为“不可评分”，不会伪装成命中。查询不到索引时返回 `UNAVAILABLE / INDEX_NOT_FOUND`，不会伪装成 `NO_MATCH`。
- **04（可核验引用）**：`payload` 是交给模型的正文，`headingPath/startLine/endLine/sourceHash` 是引用定位所需字段；`tests/test_scoring_known_rankings.py` 的 `hit_covers_unit` 夹具可用于检查「引用位置是否真的覆盖事实」。
- **08（CI 与工程文档）**：`validate.py`（离线、退出码 2/3）与 `pytest evaluation/tests` 可直接进 CI；真实运行需要密钥，CI 只跑离线部分。
- **后续的检索策略（重排、混合检索等）**：产出自己的 `runs/<策略>/results.jsonl` 后，用 `rescore.py --run` 与两条基线并列计分；`tests/test_criteria_v2.py` 固定了口径记录、两条基线的结果指纹和本文公开的数字，任何一项漂移都会在离线测试里失败。
