# -*- coding: utf-8 -*-
"""命中判据 v2（body-window-v2，2026-11-10 冻结）。

与冻结口径 frozen-v1（README 第 3 节，`exo_scoring.hit_covers_unit`）并存，不替换它。
来源是 docs/development/deliveries/02.md 第 12.5 节在 2026-10-18 写下的建议：
「正文窗口被覆盖 + 事实字符串在 payload 内 + 标题由 headingPath 单独校验」。

一条 hit 覆盖证据单元 E，当且仅当：

  1) hit.docKey == E.docKey，且两侧 sourceHash 都存在时相等（与 v1 相同）；
  2) hit 的行范围完全包含 E 的「正文窗口」：E 行范围内第一行到最后一行的非空、非标题行。
     E 内没有任何正文行时退回 v1 的整段包含；
  3) E.facts 的每条事实字符串（空白折叠后）都出现在 hit 的 payload 里（与 v1 相同）；
  4) E 行范围内的每个标题行，要么落在 hit 的行范围内，要么标题文本出现在 hit.headingPath 里
     （比对前去掉全部空白：产品从 Markdown 语法树取标题文本，行内标记之间的空白可能与原文不同）；
  5) hit 缺少 startLine/endLine 或 payload 时视为无法核验，不计命中（与 v1 相同）。

v1 判为覆盖的 hit 在 v2 下一定仍然覆盖：v1 的整段包含同时满足第 2、4 条。所以 v2 只放宽
「标题行必须在片段行范围内」这一条，其余不变。

标题行按 `exo_corpus.split_sections` 的规则识别：ATX 标题，围栏代码块里的 `#` 行不算。
"""

import re

from exo_common import norm_ws
from exo_corpus import split_sections
from exo_scoring import hit_covers_unit

CRITERIA_FROZEN_V1 = "frozen-v1"
CRITERIA_BODY_WINDOW_V2 = "body-window-v2"
CRITERIA_IDS = (CRITERIA_FROZEN_V1, CRITERIA_BODY_WINDOW_V2)

DEFINITION_V2 = (
    "hit.docKey == E.docKey，且两侧 sourceHash 都存在时相等",
    "hit 的行范围完全包含 E 的正文窗口（E 内第一行到最后一行的非空、非标题行）；E 内没有正文行时要求整段包含",
    "E.facts 的每条事实字符串（空白折叠后）都出现在 hit 的 payload 里",
    "E 行范围内的每个标题行，要么落在 hit 的行范围内，要么标题文本（去掉全部空白后）出现在 hit.headingPath 里",
    "hit 缺少 startLine/endLine 或 payload 时不计命中",
)


_ALL_WS_RE = re.compile(r"\s+")


def heading_key(text):
    """标题比对用的键：去掉全部空白。"""
    return _ALL_WS_RE.sub("", text or "")


class BodyWindowCriteria(object):
    """可调用对象 covers(hit, unit) -> bool；按文档缓存标题行。

    snapshot 只需要提供 `lines(doc_key)`，返回该文档按行切分的文本（行号从 1 开始对应下标 0）。
    """

    criteria_id = CRITERIA_BODY_WINDOW_V2

    def __init__(self, snapshot):
        self._snapshot = snapshot
        self._headings = {}

    def headings(self, doc_key):
        """{标题行号: 标题文本}。"""
        if doc_key not in self._headings:
            table = {}
            for section in split_sections(self._snapshot.lines(doc_key)):
                table[section["headingLine"]] = section["headingText"]
            self._headings[doc_key] = table
        return self._headings[doc_key]

    def unit_layout(self, unit):
        """返回 (正文窗口起始行, 正文窗口结束行, [(标题行号, 标题文本), ...])。

        单元内没有正文行时窗口为 (None, None)。
        """
        doc_key = unit["docKey"]
        lines = self._snapshot.lines(doc_key)
        headings = self.headings(doc_key)
        start, end = None, None
        unit_headings = []
        for line_no in range(unit["startLine"], unit["endLine"] + 1):
            if line_no in headings:
                unit_headings.append((line_no, headings[line_no]))
                continue
            if not lines[line_no - 1].strip():
                continue
            if start is None:
                start = line_no
            end = line_no
        return start, end, unit_headings

    def __call__(self, hit, unit):
        if hit is None or unit is None:
            return False
        if hit.get("docKey") != unit.get("docKey"):
            return False
        hit_hash = hit.get("sourceHash")
        unit_hash = unit.get("sourceHash")
        if hit_hash and unit_hash and hit_hash != unit_hash:
            return False
        start_line = hit.get("startLine")
        end_line = hit.get("endLine")
        if start_line is None or end_line is None:
            return False
        payload = hit.get("payload")
        if payload is None:
            return False

        window_start, window_end, unit_headings = self.unit_layout(unit)
        if window_start is None:
            # 单元只有标题/空行：没有正文窗口可言，沿用 v1 的整段包含。
            return hit_covers_unit(hit, unit)
        if start_line > window_start or end_line < window_end:
            return False

        normalized = norm_ws(payload)
        for fact in unit.get("facts") or []:
            if norm_ws(fact) not in normalized:
                return False

        heading_path = set(heading_key(item) for item in (hit.get("headingPath") or []))
        for line_no, heading_text in unit_headings:
            if start_line <= line_no <= end_line:
                continue
            if heading_key(heading_text) not in heading_path:
                return False
        return True


def make_covers(criteria_id, snapshot=None):
    """按口径名返回 covers(hit, unit)。frozen-v1 不需要语料快照。"""
    if criteria_id == CRITERIA_FROZEN_V1:
        return hit_covers_unit
    if criteria_id == CRITERIA_BODY_WINDOW_V2:
        if snapshot is None:
            raise ValueError("body-window-v2 需要语料快照来识别标题行与正文窗口")
        return BodyWindowCriteria(snapshot)
    raise ValueError("未知的命中口径: %r（可用: %s）" % (criteria_id, ", ".join(CRITERIA_IDS)))
