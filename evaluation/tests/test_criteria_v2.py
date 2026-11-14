# -*- coding: utf-8 -*-
"""命中口径 v2（body-window-v2）的离线回归。

三组断言：
1. 判据本身：正文窗口、标题由 headingPath 校验、v1 覆盖的 hit 在 v2 下一定覆盖；
2. 冻结资产：口径记录与当前题集/语料一致，已提交的两次真实运行能复算出 frozen-v1 的
   summary.json，也能复算出已提交的 v2 汇总——README 里公开的数字由这里固定；
3. `rescore.py` 的拒绝路径：没有口径记录、记录被改、逐题结果被改、运行不属于冻结题集。
"""

import io
import os

import pytest

import rescore  # noqa: E402
import validate  # noqa: E402

from conftest import EVAL_DIR  # noqa: E402

from exo_common import load_json, load_jsonl, round_floats, sha256_file, write_json, write_jsonl  # noqa: E402
from exo_corpus import CorpusSnapshot  # noqa: E402
from exo_criteria import (  # noqa: E402
    CRITERIA_BODY_WINDOW_V2,
    CRITERIA_FROZEN_V1,
    DEFINITION_V2,
    BodyWindowCriteria,
    heading_key,
    make_covers,
)
from exo_dataset import dev_split_fingerprint, load_questions  # noqa: E402
# 别名导入：原名以 test_ 开头，直接导入会被 pytest 当成本模块的用例收集。
from exo_dataset import test_split_fingerprint as holdout_fingerprint  # noqa: E402
from exo_scoring import build_summary, hit_covers_unit, score_question  # noqa: E402

DOC_KEY = "alpha"
HASH = "a" * 64

LINES = [
    "# Alpha 文档",           # 1 标题
    "",                       # 2
    "Alpha 使用 Java 21",     # 3 正文
    "",                       # 4
    "向量维度是 1024 维",      # 5 正文
    "",                       # 6
    "## 检索 `参数`",          # 7 标题（含行内代码）
    "",                       # 8
    "最多返回 3 个片段",        # 9 正文
    "",                       # 10
    "```",                    # 11 围栏开始
    "# 不是标题",              # 12 围栏里的 # 行
    "```",                    # 13 围栏结束
]


class FakeSnapshot(object):
    def lines(self, doc_key):
        assert doc_key == DOC_KEY
        return LINES


def unit(start, end, facts):
    return {"docKey": DOC_KEY, "sourceHash": HASH, "startLine": start, "endLine": end,
            "role": "required", "facts": list(facts)}


def hit(start, end, payload, heading_path=None, rank=1, **overrides):
    row = {"rank": rank, "docKey": DOC_KEY, "sourceHash": HASH, "startLine": start, "endLine": end,
           "payload": payload, "headingPath": heading_path}
    row.update(overrides)
    return row


U_HEAD = unit(1, 5, ["Alpha 使用 Java 21"])
U_BODY = unit(9, 9, ["最多返回 3 个片段"])
U_SECTION = unit(7, 9, ["最多返回 3 个片段"])
U_ONLY_HEADING = unit(7, 8, ["检索"])
U_FENCE = unit(11, 13, ["不是标题"])

BODY_1 = "Alpha 使用 Java 21 向量维度是 1024 维"
BODY_2 = "最多返回 3 个片段"


@pytest.fixture
def v2():
    return BodyWindowCriteria(FakeSnapshot())


# --------------------------------------------------------------------------
# 1. 判据
# --------------------------------------------------------------------------

def test_unit_layout_separates_body_window_from_heading_lines(v2):
    assert v2.unit_layout(U_HEAD) == (3, 5, [(1, "Alpha 文档")])
    assert v2.unit_layout(U_SECTION) == (9, 9, [(7, "检索 `参数`")])
    assert v2.unit_layout(U_BODY) == (9, 9, [])


def test_hash_line_inside_a_code_fence_is_body_not_heading(v2):
    assert v2.unit_layout(U_FENCE) == (11, 13, [])


def test_body_window_hit_is_covered_only_under_v2(v2):
    candidate = hit(3, 5, BODY_1, ["Alpha 文档"])
    assert hit_covers_unit(candidate, U_HEAD) is False
    assert v2(candidate, U_HEAD) is True


def test_heading_must_be_in_heading_path_when_outside_the_hit_range(v2):
    assert v2(hit(3, 5, BODY_1, ["别的标题"]), U_HEAD) is False
    assert v2(hit(3, 5, BODY_1, []), U_HEAD) is False
    assert v2(hit(3, 5, BODY_1, None), U_HEAD) is False


def test_heading_inside_the_hit_range_needs_no_heading_path(v2):
    candidate = hit(1, 5, "# Alpha 文档 " + BODY_1, None)
    assert hit_covers_unit(candidate, U_HEAD) is True
    assert v2(candidate, U_HEAD) is True


def test_heading_comparison_ignores_whitespace(v2):
    assert heading_key(" 检索  ` 参数 ` ") == "检索`参数`"
    assert v2(hit(9, 9, BODY_2, ["Alpha 文档", "检索`参数`"]), U_SECTION) is True
    assert v2(hit(9, 9, BODY_2, ["Alpha 文档", "检索参数"]), U_SECTION) is False


def test_partial_body_window_is_not_covered(v2):
    assert v2(hit(3, 3, "Alpha 使用 Java 21", ["Alpha 文档"]), U_HEAD) is False
    assert v2(hit(5, 5, BODY_1, ["Alpha 文档"]), U_HEAD) is False


def test_facts_must_appear_in_the_payload(v2):
    assert v2(hit(3, 5, "Alpha 使用 Java 17 向量维度是 1024 维", ["Alpha 文档"]), U_HEAD) is False
    assert v2(hit(3, 5, "Alpha  使用\nJava 21", ["Alpha 文档"]), U_HEAD) is True


def test_other_document_or_changed_source_is_not_covered(v2):
    assert v2(hit(3, 5, BODY_1, ["Alpha 文档"], docKey="beta"), U_HEAD) is False
    assert v2(hit(3, 5, BODY_1, ["Alpha 文档"], sourceHash="b" * 64), U_HEAD) is False
    # 任一侧缺少 sourceHash 时跳过哈希比对（与 v1 相同）
    assert v2(hit(3, 5, BODY_1, ["Alpha 文档"], sourceHash=None), U_HEAD) is True


def test_unverifiable_hits_are_not_covered(v2):
    assert v2(hit(None, 5, BODY_1, ["Alpha 文档"]), U_HEAD) is False
    assert v2(hit(3, None, BODY_1, ["Alpha 文档"]), U_HEAD) is False
    assert v2(hit(3, 5, None, ["Alpha 文档"]), U_HEAD) is False
    assert v2(None, U_HEAD) is False
    assert v2(hit(3, 5, BODY_1, ["Alpha 文档"]), None) is False


def test_unit_without_body_lines_falls_back_to_full_containment(v2):
    assert v2.unit_layout(U_ONLY_HEADING) == (None, None, [(7, "检索 `参数`")])
    assert v2(hit(7, 9, "## 检索 `参数` " + BODY_2, None), U_ONLY_HEADING) is True
    assert v2(hit(9, 9, "检索 " + BODY_2, ["检索 `参数`"]), U_ONLY_HEADING) is False


def test_everything_covered_under_v1_is_covered_under_v2(v2):
    hits = [
        hit(1, 5, "# Alpha 文档 " + BODY_1, None),
        hit(1, 13, "# Alpha 文档 " + BODY_1 + " ## 检索 `参数` " + BODY_2 + " 不是标题", ["无关"]),
        hit(3, 5, BODY_1, ["Alpha 文档"]),
        hit(7, 9, "## 检索 `参数` " + BODY_2, []),
        hit(9, 9, BODY_2, ["Alpha 文档", "检索 `参数`"]),
        hit(11, 13, "不是标题", None),
    ]
    covered_under_v1 = 0
    for candidate in hits:
        for target in (U_HEAD, U_BODY, U_SECTION, U_ONLY_HEADING, U_FENCE):
            if hit_covers_unit(candidate, target):
                covered_under_v1 += 1
                assert v2(candidate, target) is True
    assert covered_under_v1 >= 5


def test_make_covers_selects_the_criteria():
    assert make_covers(CRITERIA_FROZEN_V1) is hit_covers_unit
    assert isinstance(make_covers(CRITERIA_BODY_WINDOW_V2, FakeSnapshot()), BodyWindowCriteria)
    with pytest.raises(ValueError):
        make_covers(CRITERIA_BODY_WINDOW_V2)
    with pytest.raises(ValueError):
        make_covers("body-window-v3", FakeSnapshot())


def test_scoring_uses_the_given_criteria_and_defaults_to_frozen_v1(v2):
    question = {"id": "fx-001", "split": "dev", "category": "body-fact", "answerable": True,
                "relevantEvidence": [U_HEAD]}
    result = {"status": "OK", "hits": [hit(3, 5, BODY_1, ["Alpha 文档"], rank=2)]}
    frozen = score_question(question, result, 3)
    assert frozen["hit"] is False and frozen["reciprocalRank"] == 0.0
    rescored = score_question(question, result, 3, v2)
    assert rescored["hit"] is True and rescored["reciprocalRank"] == 0.5
    assert score_question(question, result, 1, v2)["hit"] is False
    rows = [dict(result, id="fx-001")]
    assert build_summary([question], rows, [1, 3]) == build_summary([question], rows, [1, 3], covers=hit_covers_unit)
    assert build_summary([question], rows, [1, 3], covers=v2)["metricsAll"]["k=3"]["hitAt"] == 1.0


# --------------------------------------------------------------------------
# 2. 冻结资产：口径记录、两次真实运行、已提交的 v2 汇总
# --------------------------------------------------------------------------

MANIFEST_PATH = os.path.join(EVAL_DIR, "corpus", "v1-2026-10-14", "manifest.json")
DATASET_PATH = os.path.join(EVAL_DIR, "datasets", "questions-v1.jsonl")
FREEZE_PATH = os.path.join(EVAL_DIR, "datasets", "freeze.json")
CRITERIA_PATH = os.path.join(EVAL_DIR, "datasets", "criteria-v2.json")
RUN_DIRS = dict((name, os.path.join(EVAL_DIR, "runs", name)) for name in ("legacy-title-v1", "body-v1"))


@pytest.fixture(scope="module")
def frozen():
    snapshot = CorpusSnapshot(MANIFEST_PATH)
    questions = load_questions(DATASET_PATH)
    runs = dict((name, rescore.load_run(directory)) for name, directory in RUN_DIRS.items())
    return {
        "snapshot": snapshot,
        "questions": questions,
        "freeze": load_json(FREEZE_PATH),
        "record": load_json(CRITERIA_PATH),
        "runs": runs,
        "covers": make_covers(CRITERIA_BODY_WINDOW_V2, snapshot),
    }


def fresh_rescore(frozen, name):
    return rescore.rescore_run(frozen["runs"][name], frozen["questions"], frozen["snapshot"],
                               CRITERIA_BODY_WINDOW_V2, DATASET_PATH, CRITERIA_PATH)


def test_criteria_record_matches_definition_and_frozen_assets(frozen):
    record = frozen["record"]
    assert record["criteriaId"] == CRITERIA_BODY_WINDOW_V2
    assert record["coexistsWith"] == CRITERIA_FROZEN_V1
    assert record["definition"] == list(DEFINITION_V2)
    applies = record["appliesTo"]
    assert applies["datasetSha256"] == sha256_file(DATASET_PATH) == frozen["freeze"]["datasetSha256"]
    assert applies["testSplitSha256"] == holdout_fingerprint(frozen["questions"])
    assert applies["devSplitSha256"] == dev_split_fingerprint(frozen["questions"])
    assert applies["corpusManifestSha256"] == frozen["snapshot"].manifest_sha256
    assert applies["corpusVersion"] == frozen["snapshot"].version
    assert rescore.criteria_freeze_problems(
        record, CRITERIA_BODY_WINDOW_V2, DATASET_PATH, frozen["questions"], frozen["snapshot"],
        list(frozen["runs"].values())) == []


def test_criteria_record_is_lf_json_without_bom():
    with io.open(CRITERIA_PATH, "rb") as handle:
        raw = handle.read()
    assert not raw.startswith(b"\xef\xbb\xbf")
    assert b"\r\n" not in raw


@pytest.mark.parametrize("name", sorted(RUN_DIRS.keys()))
def test_committed_run_reproduces_its_frozen_summary_and_registered_fingerprint(frozen, name):
    run = frozen["runs"][name]
    assert rescore.run_problems(run, frozen["questions"], frozen["freeze"]) == []
    registered = dict((entry["variant"], entry) for entry in frozen["record"]["baselineRuns"])
    assert registered[name]["runId"] == run["manifest"]["runId"]
    assert registered[name]["resultsFingerprint"] == rescore.results_fingerprint(run["results"])


@pytest.mark.parametrize("name", sorted(RUN_DIRS.keys()))
def test_committed_v2_summary_matches_a_fresh_rescore(frozen, name):
    committed = load_json(os.path.join(RUN_DIRS[name], "summary.%s.json" % CRITERIA_BODY_WINDOW_V2))
    assert committed == fresh_rescore(frozen, name)


@pytest.mark.parametrize("name", sorted(RUN_DIRS.keys()))
def test_frozen_v1_verdicts_are_a_subset_of_v2_on_real_runs(frozen, name):
    results = dict((row["id"], row) for row in frozen["runs"][name]["results"])
    checked = 0
    for question in frozen["questions"]:
        for target in question.get("relevantEvidence") or []:
            for candidate in results[question["id"]].get("hits") or []:
                if hit_covers_unit(candidate, target):
                    checked += 1
                    assert frozen["covers"](candidate, target) is True
    assert checked > 0


def test_committed_report_matches_a_fresh_build(frozen):
    names = ("legacy-title-v1", "body-v1")  # 报告里的列顺序：先基线后候选
    runs = [frozen["runs"][name] for name in names]
    rescored = [fresh_rescore(frozen, name) for name in names]
    report = round_floats(rescore.build_report(
        CRITERIA_BODY_WINDOW_V2, CRITERIA_PATH, frozen["record"], runs, rescored,
        frozen["questions"], frozen["snapshot"]), 6)
    prefix = os.path.join(EVAL_DIR, "runs", "body-window-v2-report")
    assert load_json(prefix + ".json") == report
    with io.open(prefix + ".md", encoding="utf-8") as handle:  # 通用换行：不受检出时的 CRLF 影响
        assert handle.read() == rescore.render_markdown(report)
    required = [row for row in report["runs"][1]["unitDifferences"] if row["role"] == "required"]
    assert len(required) == 17 and all(row["frozenRank"] is None for row in required)
    assert report["runs"][0]["unitDifferences"] == []


def test_headline_numbers_under_both_criteria(frozen):
    """evaluation/README.md 第 7.2 节与仓库 README 公开的数字。"""
    legacy_v1 = frozen["runs"]["legacy-title-v1"]["summary"]["metricsAll"]
    body_v1 = frozen["runs"]["body-v1"]["summary"]["metricsAll"]
    legacy_v2 = fresh_rescore(frozen, "legacy-title-v1")
    body_v2 = fresh_rescore(frozen, "body-v1")

    assert (legacy_v1["k=1"]["hitAt"], legacy_v1["k=3"]["hitAt"], legacy_v1["k=3"]["mrrAt"]) == (0.65, 0.85, 0.7375)
    assert (body_v1["k=1"]["hitAt"], body_v1["k=3"]["hitAt"], body_v1["k=3"]["mrrAt"]) == (0.525, 0.6, 0.5625)
    # 标题策略的片段本来就含标题行，两种口径下逐项相同
    for scope in ("metricsAll", "metricsDev", "metricsTest", "byCategory"):
        assert legacy_v2[scope] == frozen["runs"]["legacy-title-v1"]["summary"][scope]

    top = body_v2["metricsAll"]["k=3"]
    assert body_v2["metricsAll"]["k=1"]["hitAt"] == 0.875
    assert (top["hitAt"], top["mrrAt"], top["recallAt"]) == (1.0, 0.933333, 0.9875)
    assert (top["goldUnitsCovered"], top["goldUnits"]) == (43, 44)
    assert body_v2["metricsDev"]["k=3"]["hitAt"] == 1.0 and body_v2["metricsDev"]["k=1"]["hitAt"] == 0.826087
    assert body_v2["metricsTest"]["k=3"]["hitAt"] == 1.0 and body_v2["metricsTest"]["k=1"]["hitAt"] == 0.941176
    assert body_v2["failures"]["answerableMisses"] == []

    # 干扰片段：同口径下正文切块并不更少返回干扰资料（7 题里 7 题，标题策略 6 题）
    assert (top["distractorQuestions"], top["distractorTopkRate"]) == (7, 1.0)
    assert legacy_v2["metricsAll"]["k=3"]["distractorTopkRate"] == 0.857143
    assert body_v1["k=3"]["distractorTopkRate"] == 0.285714
    # 无答案题：两种口径下检索级拒绝率都是 0（判据不影响是否返回片段）
    assert body_v2["noAnswer"]["retrievalRejectionRate"] == 0.0
    assert legacy_v2["noAnswer"]["retrievalRejectionRate"] == 0.0


# --------------------------------------------------------------------------
# 3. rescore.py 的命令行行为（夹具语料 + 临时目录）
# --------------------------------------------------------------------------

class RescoreFixture(object):
    def __init__(self, workspace):
        self.workspace = workspace
        root = workspace.root
        answerable = workspace.question(relevantEvidence=[
            workspace.evidence("alpha", 5, 7, ["Alpha 使用 Java 21"]),  # 第 5 行是标题，正文在第 7 行
        ])
        self.questions = [answerable, workspace.unanswerable()]
        self.dataset = workspace.write_dataset(self.questions)
        self.freeze = os.path.join(root, "freeze.json")
        assert validate.main(["--dataset", self.dataset, "--corpus-manifest", workspace.manifest_path,
                              "--emit-freeze", "--freeze-out", self.freeze, "--json"]) == 0
        self.criteria = os.path.join(root, "criteria-v2.json")
        self.out = os.path.join(root, "report")
        self.run_dir = os.path.join(root, "runs", "body-v1")
        self.rows = [
            {"id": "fx-001", "status": "OK", "hits": [{
                "rank": 1, "docKey": "alpha", "sourceHash": workspace.snapshot.doc("alpha")["sha256"],
                "startLine": 7, "endLine": 7, "distance": 0.5,
                "headingPath": ["Alpha 文档", "Alpha 的部署版本"],
                "payload": "《Alpha 文档》：Alpha 使用 Java 21，向量维度是 1024 维。",
            }]},
            {"id": "fx-100", "status": "OK", "hits": []},
        ]
        self.manifest = {
            "schemaVersion": 1, "runId": "fixture-body-v1", "variant": "body-v1",
            "datasetSha256": sha256_file(self.dataset),
            "datasetTestSplitSha256": holdout_fingerprint(self.questions),
            "corpusManifestSha256": workspace.snapshot.manifest_sha256,
            "execution": {"kValues": [1, 3], "topK": 3},
        }
        self.write_run()

    def write_run(self):
        write_json(os.path.join(self.run_dir, "manifest.json"), self.manifest)
        write_jsonl(os.path.join(self.run_dir, "results.jsonl"), self.rows)
        write_json(os.path.join(self.run_dir, "summary.json"),
                   round_floats(build_summary(self.questions, self.rows, [1, 3]), 6))

    def main(self, *extra):
        return rescore.main([
            "--run", self.run_dir, "--dataset", self.dataset,
            "--corpus-manifest", self.workspace.manifest_path, "--freeze", self.freeze,
            "--criteria-freeze", self.criteria, "--out", self.out,
        ] + list(extra))

    def freeze_criteria(self):
        assert self.main("--emit-criteria-freeze", "--frozen-at", "2026-11-10") == 0

    def v2_summary(self):
        return load_json(os.path.join(self.run_dir, "summary.%s.json" % CRITERIA_BODY_WINDOW_V2))


@pytest.fixture
def fixture_run(workspace, capsys):
    built = RescoreFixture(workspace)
    capsys.readouterr()
    return built


def read_bytes(path):
    with io.open(path, "rb") as handle:
        return handle.read()


def test_rescore_refuses_without_a_criteria_record(fixture_run):
    assert fixture_run.main() == 3
    assert not os.path.exists(fixture_run.criteria)
    assert fixture_run.main("--emit-criteria-freeze") == 3  # 缺 --frozen-at
    assert not os.path.exists(fixture_run.criteria)


def test_rescore_freezes_once_and_writes_side_by_side_outputs(fixture_run, capsys):
    fixture_run.freeze_criteria()
    record = load_json(fixture_run.criteria)
    assert record["frozenAt"] == "2026-11-10"
    assert record["definition"] == list(DEFINITION_V2)
    assert record["baselineRuns"][0]["runId"] == "fixture-body-v1"

    frozen_summary = load_json(os.path.join(fixture_run.run_dir, "summary.json"))
    assert frozen_summary["metricsAll"]["k=3"]["hitAt"] == 0.0  # 标题行不在片段行范围内
    rescored = fixture_run.v2_summary()
    assert rescored["metricsAll"]["k=3"]["hitAt"] == 1.0
    assert rescored["criteria"]["id"] == CRITERIA_BODY_WINDOW_V2
    assert rescored["rescoredFrom"]["runId"] == "fixture-body-v1"

    report = load_json(fixture_run.out + ".json")
    differences = report["runs"][0]["unitDifferences"]
    assert [(row["id"], row["frozenRank"], row["criteriaRank"]) for row in differences] == [("fx-001", None, 1)]
    with io.open(fixture_run.out + ".md", encoding="utf-8") as handle:
        markdown = handle.read()
    assert "body-v1 / frozen-v1" in markdown and "body-v1 / body-window-v2" in markdown

    # 之后的重算不需要、也不会改写口径记录；输出逐字节相同
    before = dict((path, read_bytes(path)) for path in (
        fixture_run.criteria, fixture_run.out + ".md", fixture_run.out + ".json",
        os.path.join(fixture_run.run_dir, "summary.%s.json" % CRITERIA_BODY_WINDOW_V2)))
    capsys.readouterr()
    assert fixture_run.main() == 0
    assert fixture_run.main("--emit-criteria-freeze", "--frozen-at", "2099-01-01") == 0
    for path, data in before.items():
        assert read_bytes(path) == data, path


def test_rescore_rejects_a_changed_criteria_record_and_never_overwrites_it(fixture_run):
    fixture_run.freeze_criteria()
    record = load_json(fixture_run.criteria)
    record["definition"][1] = "hit 与 E 的正文窗口有任意一行相交"
    write_json(fixture_run.criteria, record)
    tampered = read_bytes(fixture_run.criteria)
    assert fixture_run.main() == 2
    assert fixture_run.main("--emit-criteria-freeze", "--frozen-at", "2026-11-10") == 2
    assert read_bytes(fixture_run.criteria) == tampered


def test_rescore_rejects_results_that_differ_from_the_registered_baseline(fixture_run):
    fixture_run.freeze_criteria()
    # 只改 payload：frozen-v1 的汇总不变（该 hit 本来就不覆盖），但内容指纹变了
    fixture_run.rows[0]["hits"][0]["payload"] = "《Alpha 文档》：Alpha 使用 Java 21。"
    fixture_run.write_run()
    assert fixture_run.main() == 2


def test_rescore_rejects_a_summary_the_results_cannot_reproduce(fixture_run):
    summary_path = os.path.join(fixture_run.run_dir, "summary.json")
    summary = load_json(summary_path)
    summary["metricsAll"]["k=3"]["hitAt"] = 1.0
    write_json(summary_path, summary)
    assert fixture_run.main("--emit-criteria-freeze", "--frozen-at", "2026-11-10") == 2
    assert not os.path.exists(fixture_run.criteria)


def test_rescore_rejects_a_run_from_another_dataset(fixture_run):
    fixture_run.manifest["datasetSha256"] = "0" * 64
    fixture_run.write_run()
    assert fixture_run.main("--emit-criteria-freeze", "--frozen-at", "2026-11-10") == 2
    assert not os.path.exists(fixture_run.criteria)


def test_rescore_reports_missing_run_files(fixture_run):
    os.remove(os.path.join(fixture_run.run_dir, "results.jsonl"))
    assert fixture_run.main() == 3
