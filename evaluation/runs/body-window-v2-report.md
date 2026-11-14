# 命中口径 body-window-v2：与 frozen-v1 并列的重算结果

- 口径冻结记录：`evaluation/datasets/criteria-v2.json`（冻结日期 2026-11-10）
- 题集 SHA-256：`c795c7f69d33fa56c8cafe8535300490057f3ec69bbdeb587958c535ae5df08f`；语料 `v1-2026-10-14`，manifest SHA-256：`7999340d125f8d2c133a24cffb4965086b63608ad74c68c6663176a3b7bca821`
- 运行 `legacy-title-v1`：runId `legacy-title-v1-v1-2026-10-14-20261017T102252Z`，逐题结果指纹 `b95473e64aac88d3da51877da83587992a3721227c39e41bcb57b35ece68ab14`
- 运行 `body-v1`：runId `body-v1-v1-2026-10-14-20261018T111843Z`，逐题结果指纹 `6ef26a6a84bbd332bc7959f19824d23d2f0a424ed1098f618043bfe44abdbef8`

## 判据

一条 hit 覆盖证据单元 E，当且仅当：

1. hit.docKey == E.docKey，且两侧 sourceHash 都存在时相等
2. hit 的行范围完全包含 E 的正文窗口（E 内第一行到最后一行的非空、非标题行）；E 内没有正文行时要求整段包含
3. E.facts 的每条事实字符串（空白折叠后）都出现在 hit 的 payload 里
4. E 行范围内的每个标题行，要么落在 hit 的行范围内，要么标题文本（去掉全部空白后）出现在 hit.headingPath 里
5. hit 缺少 startLine/endLine 或 payload 时不计命中

## 指标

| 范围 | 指标 | legacy-title-v1 / frozen-v1 | legacy-title-v1 / body-window-v2 | body-v1 / frozen-v1 | body-v1 / body-window-v2 |
| --- | --- | --- | --- | --- | --- |
| 全部 | Hit@1 | 0.650 | 0.650 | 0.525 | 0.875 |
| 全部 | Hit@3 | 0.850 | 0.850 | 0.600 | 1.000 |
| 全部 | Recall@3 | 0.812 | 0.812 | 0.588 | 0.988 |
| 全部 | MRR@3 | 0.738 | 0.738 | 0.562 | 0.933 |
| 全部 | 证据单元覆盖@3 | 34/44 | 34/44 | 26/44 | 43/44 |
| 全部 | 干扰片段命中率@1 | 0.286 | 0.286 | 0.000 | 0.286 |
| 全部 | 干扰片段命中率@3 | 0.857 | 0.857 | 0.286 | 1.000 |
| dev | Hit@1 | 0.565 | 0.565 | 0.652 | 0.826 |
| dev | Hit@3 | 0.826 | 0.826 | 0.783 | 1.000 |
| dev | Recall@3 | 0.783 | 0.783 | 0.761 | 0.978 |
| dev | MRR@3 | 0.674 | 0.674 | 0.717 | 0.906 |
| dev | 证据单元覆盖@3 | 19/25 | 19/25 | 19/25 | 24/25 |
| dev | 干扰片段命中率@1 | 0.333 | 0.333 | 0.000 | 0.167 |
| dev | 干扰片段命中率@3 | 0.833 | 0.833 | 0.333 | 1.000 |
| test | Hit@1 | 0.765 | 0.765 | 0.353 | 0.941 |
| test | Hit@3 | 0.882 | 0.882 | 0.353 | 1.000 |
| test | Recall@3 | 0.853 | 0.853 | 0.353 | 1.000 |
| test | MRR@3 | 0.824 | 0.824 | 0.353 | 0.971 |
| test | 证据单元覆盖@3 | 15/19 | 15/19 | 7/19 | 19/19 |
| test | 干扰片段命中率@1 | 0.000 | 0.000 | 0.000 | 1.000 |
| test | 干扰片段命中率@3 | 1.000 | 1.000 | 0.000 | 1.000 |

## 两种口径判定不同的证据单元

### legacy-title-v1：必需单元 0 个，干扰单元 0 个

没有差异。

### body-v1：必需单元 17 个，干扰单元 5 个

| 题目 | split | 角色 | 文档 | 单元行号 | frozen-v1 名次 | body-window-v2 名次 |
| --- | --- | --- | --- | --- | --- | --- |
| q003 | dev | required | exobrain-overview | 5–9 | 未命中 | 1 |
| q003 | dev | distractor | eval-synthetic-java-notes | 9–11 | 未命中 | 2 |
| q004 | dev | required | exobrain-overview | 5–9 | 未命中 | 1 |
| q004 | dev | distractor | eval-synthetic-java-notes | 9–11 | 未命中 | 2 |
| q008 | dev | required | exobrain-overview | 17–21 | 未命中 | 1 |
| q010 | dev | distractor | eval-synthetic-java-notes | 13–15 | 未命中 | 2 |
| q013 | dev | required | rag-principles | 5–9 | 未命中 | 3 |
| q016 | dev | distractor | eval-synthetic-java-notes | 13–15 | 未命中 | 1 |
| q021 | dev | required | rag-principles | 29–31 | 未命中 | 1 |
| q031 | test | required | java-backend-faq | 5–9 | 未命中 | 1 |
| q032 | test | required | java-backend-faq | 5–9 | 未命中 | 2 |
| q032 | test | distractor | eval-synthetic-java-notes | 5–7 | 未命中 | 1 |
| q033 | test | required | exobrain-overview | 23–27 | 未命中 | 1 |
| q035 | test | required | rag-principles | 11–15 | 未命中 | 1 |
| q036 | test | required | rag-principles | 17–21 | 未命中 | 1 |
| q037 | test | required | rag-principles | 17–21 | 未命中 | 1 |
| q038 | test | required | rag-principles | 17–19 | 未命中 | 1 |
| q039 | test | required | rag-principles | 23–27 | 未命中 | 1 |
| q040 | test | required | java-backend-faq | 11–15 | 未命中 | 1 |
| q044 | test | required | java-backend-faq | 23–29 | 未命中 | 1 |
| q047 | test | required | rag-principles | 29–31 | 未命中 | 1 |
| q047 | test | required | exobrain-overview | 23–27 | 未命中 | 3 |

## 说明

- 两种口径用的是同一批逐题检索结果（results.jsonl 原样），没有重新调用 Embedding 或数据库；差别只在命中判据。
- frozen-v1 的数字来自各运行已提交的 summary.json，未改动。
- 样本量小（40 道有答案题、7 道带干扰单元的题），差一两题不构成显著差异。
- 只测检索，不测回答：回答级拒绝率、引用有效性与事实支持度不在本报告范围内。
