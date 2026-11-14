"""按指定命中口径重算已有运行的指标：只读 results.jsonl，不调用 Embedding，不访问数据库。

用途：冻结口径（frozen-v1，README 第 3 节）要求片段行范围包含证据单元的标题行，正文切块的
片段从正文第一行开始，因此两者有结构性冲突。口径 v2（body-window-v2，见 exo_criteria.py）
对两侧使用同一判据重新计分。frozen-v1 的 summary.json 不改、不删。

用法（在仓库根目录执行）：
  # 首次冻结口径（只在口径记录不存在时写入；已存在且内容不同会拒绝）
  python evaluation/scripts/rescore.py --emit-criteria-freeze --frozen-at 2026-11-10 \
      --run evaluation/runs/legacy-title-v1 --run evaluation/runs/body-v1

  # 之后的重算（口径记录必须已存在，并与当前题集、语料、判据定义一致）
  python evaluation/scripts/rescore.py \
      --run evaluation/runs/legacy-title-v1 --run evaluation/runs/body-v1

每个运行目录写出 summary.<口径>.json；--out 前缀写出两种口径并列的报告（.md / .json）。

退出码：0 正常；2 校验失败（题集或语料与冻结记录不符、运行不属于当前冻结题集、
results.jsonl 复算不出已提交的 summary.json、口径记录不一致）；3 参数或文件错误。
"""

import argparse
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from exo_common import (  # noqa: E402
    EvalError,
    canonical_json,
    load_json,
    load_jsonl,
    relpath,
    round_floats,
    sha256_file,
    sha256_text,
    write_json,
)
from exo_corpus import CorpusSnapshot  # noqa: E402
from exo_criteria import (  # noqa: E402
    CRITERIA_BODY_WINDOW_V2,
    CRITERIA_FROZEN_V1,
    DEFINITION_V2,
    make_covers,
)
from exo_dataset import (  # noqa: E402
    dataset_stats,
    dev_split_fingerprint,
    load_questions,
    test_split_fingerprint,
    validate_questions,
)
from exo_scoring import build_summary, hit_covers_unit  # noqa: E402

DEFAULT_DATASET = os.path.join("evaluation", "datasets", "questions-v1.jsonl")
DEFAULT_MANIFEST = os.path.join("evaluation", "corpus", "v1-2026-10-14", "manifest.json")
DEFAULT_FREEZE = os.path.join("evaluation", "datasets", "freeze.json")
DEFAULT_CRITERIA_FREEZE = os.path.join("evaluation", "datasets", "criteria-v2.json")
DEFAULT_OUT = os.path.join("evaluation", "runs", "body-window-v2-report")

# 复算 frozen-v1 时逐项比对的 summary 字段：只含由题集与 results.jsonl 决定的部分。
FROZEN_REPRODUCIBLE_KEYS = (
    "metricsAll", "metricsDev", "metricsTest", "byCategory", "noAnswer", "noAnswerTest", "failures",
)

CRITERIA_NOTE = (
    "本口径在 body-v1 的冻结口径结果出来之后才提出（2026-10-18，docs/development/deliveries/02.md "
    "第 12.5 节），不是预先登记的口径。它只放宽「标题行必须在片段行范围内」这一条，改为"
    "「标题文本在片段的 headingPath 里」，对所有运行使用同一判据；frozen-v1 的数字原样保留。"
    "自冻结日起固定：此后新增的检索策略都按本记录计分，不再调整判据。"
)


def parse_args(argv):
    parser = argparse.ArgumentParser(description="按命中口径 v2 重算已有检索评测运行（只读）")
    parser.add_argument("--run", action="append", required=True, help="运行结果目录，可重复")
    parser.add_argument("--criteria", default=CRITERIA_BODY_WINDOW_V2, help="命中口径 id")
    parser.add_argument("--dataset", default=DEFAULT_DATASET, help="题集 JSONL")
    parser.add_argument("--corpus-manifest", default=DEFAULT_MANIFEST, help="语料 manifest")
    parser.add_argument("--freeze", default=DEFAULT_FREEZE, help="题集与语料的冻结记录")
    parser.add_argument("--criteria-freeze", default=DEFAULT_CRITERIA_FREEZE, help="口径冻结记录")
    parser.add_argument("--emit-criteria-freeze", action="store_true",
                        help="口径记录不存在时写入；已存在且内容不同则拒绝")
    parser.add_argument("--frozen-at", default=None, help="--emit-criteria-freeze 的冻结日期，例如 2026-11-10")
    parser.add_argument("--out", default=DEFAULT_OUT, help="并列报告的前缀（写出 .md / .json）")
    return parser.parse_args(argv)


def results_fingerprint(rows):
    """逐题结果的内容指纹：按题目 id 排序后稳定序列化，不受换行符与行顺序影响。"""
    ordered = sorted(rows, key=lambda row: row.get("id", ""))
    return sha256_text(canonical_json(ordered))


def load_run(directory):
    paths = dict((name, os.path.join(directory, name))
                 for name in ("manifest.json", "summary.json", "results.jsonl"))
    for path in paths.values():
        if not os.path.isfile(path):
            raise EvalError("运行目录缺少文件: %s" % path)
    return {
        "dir": directory,
        "manifest": load_json(paths["manifest.json"]),
        "summary": load_json(paths["summary.json"]),
        "results": load_jsonl(paths["results.jsonl"]),
    }


def k_values_of(run):
    return list((run["manifest"].get("execution") or {}).get("kValues") or [])


def run_problems(run, questions, freeze):
    """运行必须属于当前冻结题集，且 results.jsonl 能复算出已提交的 frozen-v1 summary。"""
    problems = []
    manifest = run["manifest"]
    label = manifest.get("variant") or run["dir"]
    for manifest_key, freeze_key, name in (
            ("datasetSha256", "datasetSha256", "题集 SHA-256"),
            ("datasetTestSplitSha256", "testSplitSha256", "测试集 SHA-256"),
            ("corpusManifestSha256", "corpusManifestSha256", "语料 manifest SHA-256")):
        if manifest.get(manifest_key) != freeze.get(freeze_key):
            problems.append("%s：运行的%s与冻结记录不一致（%s ≠ %s）" % (
                label, name, manifest.get(manifest_key), freeze.get(freeze_key)))
    k_values = k_values_of(run)
    if not k_values:
        problems.append("%s：manifest 缺少 execution.kValues" % label)
        return problems
    recomputed = round_floats(build_summary(questions, run["results"], k_values), 6)
    for key in FROZEN_REPRODUCIBLE_KEYS:
        if recomputed.get(key) != run["summary"].get(key):
            problems.append("%s：results.jsonl 按 frozen-v1 复算的 %s 与已提交的 summary.json 不一致" % (label, key))
    return problems


def rescore_run(run, questions, snapshot, criteria_id, dataset_path, criteria_freeze_path):
    covers = make_covers(criteria_id, snapshot)
    summary = build_summary(questions, run["results"], k_values_of(run), covers=covers)
    summary["counts"] = dataset_stats(questions)
    summary["variant"] = run["manifest"].get("variant")
    summary["criteria"] = {"id": criteria_id, "freeze": relpath(criteria_freeze_path)}
    summary["rescoredFrom"] = {
        "runId": run["manifest"].get("runId"),
        "results": relpath(os.path.join(run["dir"], "results.jsonl")),
        "resultsFingerprint": results_fingerprint(run["results"]),
        "note": "由该次真实运行的逐题检索结果原样重新计分；没有重新调用 Embedding 或数据库。",
    }
    summary["dataset"] = {
        "path": relpath(dataset_path),
        "sha256": sha256_file(dataset_path),
        "testSplitSha256": test_split_fingerprint(questions),
    }
    return round_floats(summary, 6)


def criteria_freeze_payload(criteria_id, frozen_at, dataset_path, questions, snapshot, runs):
    return {
        "schemaVersion": 1,
        "criteriaId": criteria_id,
        "frozenAt": frozen_at,
        "coexistsWith": CRITERIA_FROZEN_V1,
        "note": CRITERIA_NOTE,
        "definition": list(DEFINITION_V2),
        "implementation": "evaluation/scripts/exo_criteria.py",
        "appliesTo": {
            "datasetPath": relpath(dataset_path),
            "datasetSha256": sha256_file(dataset_path),
            "testSplitSha256": test_split_fingerprint(questions),
            "devSplitSha256": dev_split_fingerprint(questions),
            "corpusVersion": snapshot.version,
            "corpusManifestSha256": snapshot.manifest_sha256,
        },
        "baselineRuns": [
            {
                "variant": run["manifest"].get("variant"),
                "runId": run["manifest"].get("runId"),
                "kValues": k_values_of(run),
                "resultsFingerprint": results_fingerprint(run["results"]),
            }
            for run in runs
        ],
    }


def criteria_freeze_problems(record, criteria_id, dataset_path, questions, snapshot, runs):
    """口径记录必须与当前的判据定义、题集、语料一致；已登记的基线运行不能被替换。"""
    problems = []
    if record.get("criteriaId") != criteria_id:
        problems.append("口径记录的 criteriaId 是 %r，本次请求的是 %r" % (record.get("criteriaId"), criteria_id))
    if record.get("definition") != list(DEFINITION_V2):
        problems.append("口径记录的判据定义与 exo_criteria.DEFINITION_V2 不一致；改判据需要新的口径 id 与新的记录")
    applies = record.get("appliesTo") or {}
    current = {
        "datasetSha256": sha256_file(dataset_path),
        "testSplitSha256": test_split_fingerprint(questions),
        "devSplitSha256": dev_split_fingerprint(questions),
        "corpusManifestSha256": snapshot.manifest_sha256,
    }
    for key in sorted(current.keys()):
        if applies.get(key) != current[key]:
            problems.append("口径记录的 %s 与当前文件不一致（%s ≠ %s）" % (key, applies.get(key), current[key]))
    registered = dict((entry.get("variant"), entry) for entry in record.get("baselineRuns") or [])
    for run in runs:
        entry = registered.get(run["manifest"].get("variant"))
        if entry is None:
            continue
        if entry.get("runId") != run["manifest"].get("runId"):
            problems.append("%s：runId 与口径记录登记的基线运行不一致" % entry.get("variant"))
        if entry.get("resultsFingerprint") != results_fingerprint(run["results"]):
            problems.append("%s：results.jsonl 的内容指纹与口径记录登记的不一致" % entry.get("variant"))
    return problems


def unit_differences(run, questions, covers, k):
    """两种口径判定不同的证据单元（required 与 distractor），用于逐条复核。"""
    results_by_id = dict((row.get("id"), row) for row in run["results"])
    rows = []
    for question in questions:
        hits = [hit for hit in ((results_by_id.get(question.get("id")) or {}).get("hits") or [])
                if hit.get("rank") is not None and hit.get("rank") <= k]
        for unit in question.get("relevantEvidence") or []:
            role = unit.get("role", "required")
            if role not in ("required", "distractor"):
                continue
            frozen_ranks = [hit.get("rank") for hit in hits if hit_covers_unit(hit, unit)]
            criteria_ranks = [hit.get("rank") for hit in hits if covers(hit, unit)]
            if bool(frozen_ranks) == bool(criteria_ranks):
                continue
            rows.append({
                "id": question.get("id"),
                "split": question.get("split"),
                "role": role,
                "docKey": unit.get("docKey"),
                "unit": [unit.get("startLine"), unit.get("endLine")],
                "frozenRank": min(frozen_ranks) if frozen_ranks else None,
                "criteriaRank": min(criteria_ranks) if criteria_ranks else None,
            })
    return rows


def metric_rows(k_values):
    """报告里的指标行：(k 键, 字段, 标签)。"""
    top = max(k_values)
    rows = [("k=%d" % k, "hitAt", "Hit@%d" % k) for k in k_values]
    rows.append(("k=%d" % top, "recallAt", "Recall@%d" % top))
    rows.append(("k=%d" % top, "mrrAt", "MRR@%d" % top))
    rows.append(("k=%d" % top, "units", "证据单元覆盖@%d" % top))
    rows.extend(("k=%d" % k, "distractorTopkRate", "干扰片段命中率@%d" % k) for k in k_values)
    return rows


def metric_value(summary, scope_key, k_key, field):
    bucket = (summary.get(scope_key) or {}).get(k_key) or {}
    if field == "units":
        return "%s/%s" % (bucket.get("goldUnitsCovered"), bucket.get("goldUnits"))
    value = bucket.get(field)
    if value is None:
        return "n/a"
    return "%.3f" % value


SCOPES = (("全部", "metricsAll"), ("dev", "metricsDev"), ("test", "metricsTest"))


def build_report(criteria_id, criteria_freeze_path, record, runs, rescored, questions, snapshot):
    covers = make_covers(criteria_id, snapshot)
    k_values = k_values_of(runs[0])
    entries = []
    for run, summary in zip(runs, rescored):
        entries.append({
            "variant": run["manifest"].get("variant"),
            "runId": run["manifest"].get("runId"),
            "resultsFingerprint": results_fingerprint(run["results"]),
            "summaries": {
                CRITERIA_FROZEN_V1: dict((key, run["summary"].get(key)) for _label, key in SCOPES),
                criteria_id: dict((key, summary.get(key)) for _label, key in SCOPES),
            },
            "unitDifferences": unit_differences(run, questions, covers, max(k_values)),
        })
    return {
        "schemaVersion": 1,
        "criteria": criteria_id,
        "criteriaFreeze": relpath(criteria_freeze_path),
        "frozenAt": record.get("frozenAt"),
        "definition": record.get("definition"),
        "appliesTo": record.get("appliesTo"),
        "kValues": k_values,
        "runs": entries,
        "notes": [
            "两种口径用的是同一批逐题检索结果（results.jsonl 原样），没有重新调用 Embedding 或数据库；差别只在命中判据。",
            "frozen-v1 的数字来自各运行已提交的 summary.json，未改动。",
            "样本量小（40 道有答案题、7 道带干扰单元的题），差一两题不构成显著差异。",
            "只测检索，不测回答：回答级拒绝率、引用有效性与事实支持度不在本报告范围内。",
        ],
    }


def render_markdown(report):
    criteria_id = report["criteria"]
    runs = report["runs"]
    lines = []
    lines.append("# 命中口径 %s：与 frozen-v1 并列的重算结果" % criteria_id)
    lines.append("")
    lines.append("- 口径冻结记录：`%s`（冻结日期 %s）" % (report["criteriaFreeze"], report.get("frozenAt")))
    applies = report.get("appliesTo") or {}
    lines.append("- 题集 SHA-256：`%s`；语料 `%s`，manifest SHA-256：`%s`" % (
        applies.get("datasetSha256"), applies.get("corpusVersion"), applies.get("corpusManifestSha256")))
    for entry in runs:
        lines.append("- 运行 `%s`：runId `%s`，逐题结果指纹 `%s`" % (
            entry["variant"], entry["runId"], entry["resultsFingerprint"]))
    lines.append("")
    lines.append("## 判据")
    lines.append("")
    lines.append("一条 hit 覆盖证据单元 E，当且仅当：")
    lines.append("")
    for index, item in enumerate(report.get("definition") or [], start=1):
        lines.append("%d. %s" % (index, item))
    lines.append("")
    lines.append("## 指标")
    lines.append("")
    header = ["范围", "指标"]
    for entry in runs:
        header.append("%s / %s" % (entry["variant"], CRITERIA_FROZEN_V1))
        header.append("%s / %s" % (entry["variant"], criteria_id))
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")
    for scope_label, scope_key in SCOPES:
        for k_key, field, label in metric_rows(report["kValues"]):
            cells = [scope_label, label]
            for entry in runs:
                for name in (CRITERIA_FROZEN_V1, criteria_id):
                    cells.append(metric_value(entry["summaries"][name], scope_key, k_key, field))
            lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    lines.append("## 两种口径判定不同的证据单元")
    lines.append("")
    for entry in runs:
        differences = entry["unitDifferences"]
        required = [row for row in differences if row["role"] == "required"]
        distractor = [row for row in differences if row["role"] == "distractor"]
        lines.append("### %s：必需单元 %d 个，干扰单元 %d 个" % (entry["variant"], len(required), len(distractor)))
        lines.append("")
        if not differences:
            lines.append("没有差异。")
            lines.append("")
            continue
        lines.append("| 题目 | split | 角色 | 文档 | 单元行号 | frozen-v1 名次 | %s 名次 |" % criteria_id)
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for row in differences:
            lines.append("| %s | %s | %s | %s | %s–%s | %s | %s |" % (
                row["id"], row["split"], row["role"], row["docKey"], row["unit"][0], row["unit"][1],
                row["frozenRank"] if row["frozenRank"] is not None else "未命中",
                row["criteriaRank"] if row["criteriaRank"] is not None else "未命中"))
        lines.append("")
    lines.append("## 说明")
    lines.append("")
    for note in report["notes"]:
        lines.append("- %s" % note)
    lines.append("")
    return "\n".join(lines)


def main(argv=None):
    args = parse_args(argv)
    try:
        snapshot = CorpusSnapshot(args.corpus_manifest)
        questions = load_questions(args.dataset)
        freeze = load_json(args.freeze)
        runs = [load_run(directory) for directory in args.run]
    except EvalError as exc:
        sys.stderr.write(str(exc) + "\n")
        return 3
    try:
        make_covers(args.criteria, snapshot)
    except ValueError as exc:
        sys.stderr.write(str(exc) + "\n")
        return 3

    problems = validate_questions(questions, snapshot, dataset_path=os.path.abspath(args.dataset), freeze=freeze)
    for run in runs:
        problems.extend(run_problems(run, questions, freeze))
    if len(set(tuple(k_values_of(run)) for run in runs)) > 1:
        problems.append("各运行的 kValues 不一致，不能并列比较")

    record = None
    if not problems:
        if os.path.isfile(args.criteria_freeze):
            record = load_json(args.criteria_freeze)
            problems.extend(criteria_freeze_problems(
                record, args.criteria, args.dataset, questions, snapshot, runs))
            if args.emit_criteria_freeze and not problems:
                sys.stderr.write("口径冻结记录已存在，保持不变: %s\n" % relpath(args.criteria_freeze))
        elif args.emit_criteria_freeze:
            if not args.frozen_at:
                sys.stderr.write("--emit-criteria-freeze 需要 --frozen-at <日期>\n")
                return 3
            record = criteria_freeze_payload(
                args.criteria, args.frozen_at, args.dataset, questions, snapshot, runs)
            write_json(args.criteria_freeze, record)
            sys.stderr.write("已写入口径冻结记录: %s\n" % relpath(args.criteria_freeze))
        else:
            sys.stderr.write("口径冻结记录不存在: %s（首次冻结用 --emit-criteria-freeze）\n"
                             % relpath(args.criteria_freeze))
            return 3
    if problems:
        sys.stderr.write("校验失败，拒绝重算:\n- " + "\n- ".join(problems) + "\n")
        return 2

    rescored = []
    for run in runs:
        summary = rescore_run(run, questions, snapshot, args.criteria, args.dataset, args.criteria_freeze)
        write_json(os.path.join(run["dir"], "summary.%s.json" % args.criteria), summary)
        rescored.append(summary)

    report = build_report(args.criteria, args.criteria_freeze, record, runs, rescored, questions, snapshot)
    write_json(args.out + ".json", round_floats(report, 6))
    markdown = render_markdown(report)
    with io.open(args.out + ".md", "w", encoding="utf-8", newline="\n") as handle:
        handle.write(markdown)
    sys.stdout.write(markdown)
    sys.stdout.write("\n报告已写入: %s.md / %s.json\n" % (relpath(args.out), relpath(args.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
