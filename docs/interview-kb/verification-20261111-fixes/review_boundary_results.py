#!/usr/bin/env python3
"""Read-only review of saved sourceAnswer evidence; never contacts the service or a model."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import html
import json
from pathlib import Path
import re
from typing import Any

DEFAULT_CASES = Path(__file__).with_name("boundary-cases.json")
INSUFFICIENT = "本次可用资料不足以确认。"
SOURCE_PREFIX = "以下为本轮检索到的资料原文："
PARTIAL_PREFIX = "本次资料只能支持问题的一部分，未覆盖的内容无法确认。"
FALLBACK_PREFIX = "自动整理暂未完成，本次未能确认你的问题。"
LEGACY_FALLBACK_PREFIX = "自动回答未能可靠完成。"
DEGRADED_UNCONFIRMED = FALLBACK_PREFIX + "\n\n请稍后重试，当前没有经过可靠选择的资料答复。"
FALLBACK_PREAMBLES = {
    prefix + "以下仅为检索到的原文参考，请核对它是否覆盖你的问题。\n\n" + SOURCE_PREFIX
    for prefix in (FALLBACK_PREFIX, LEGACY_FALLBACK_PREFIX)
}
HEADINGS = re.compile(r"(?m)^\*\*资料原文 \[(\d+)\](?: · [^\n]*)?\*\*[ \t]*$")
DATE_CONTEXT = re.compile(r"^查询时日期：(\d{4}-\d{2}-\d{2})。\s*")
DATE_ONLY = re.compile(r"^当前日期：(\d{4}-\d{2}-\d{2})。$")
MARKDOWN_ESCAPE = re.compile(r"\\([!\"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])")


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "", flags=re.ASCII).strip()


def displayed_excerpt(value: str) -> str:
    value = whitespace(value)
    encoded = value.encode("utf-16-le")
    if len(encoded) <= 600:
        return value
    return encoded[:598].decode("utf-16-le", errors="ignore").rstrip() + "…"


def source_text(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    return "\n".join(MARKDOWN_ESCAPE.sub(r"\1", line).rstrip() for line in value.splitlines())


def decode_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return None


def identify(record: dict, single: dict, multi: dict) -> tuple[str | None, dict | None, str | None, int | None]:
    case_id = record.get("id")
    if case_id in single:
        return case_id, single[case_id], None, None
    scenario = record.get("scenarioId") or record.get("scenario")
    turn = record.get("turnIndex")
    match = re.fullmatch(r"(C\d+)[-_](?:[Tt])?(\d+)", str(case_id))
    if match and scenario is None:
        scenario, turn = match.group(1), int(match.group(2))
    if scenario in multi and isinstance(turn, int) and not isinstance(turn, bool):
        spec = multi[scenario]
        if 1 <= turn <= len(spec["turns"]):
            canonical = f"{scenario}-T{turn}"
            return canonical, dict(id=canonical, title=spec["title"], question=spec["turns"][turn - 1],
                                   scope="multi-turn", expectedFiles=[], category="multi-turn",
                                   semanticChecks=spec.get("semanticChecks", [])), scenario, turn
    return None, None, None, None


def audit(record: dict, spec: dict, evidence_path: Path) -> dict:
    findings: list[dict] = []

    def add(level: str, code: str, detail: str) -> None:
        findings.append(dict(level=level, code=code, detail=detail))

    summary = record.get("summary") or {}
    status = summary.get("status") or record.get("status")
    run_id = record.get("runId") or summary.get("runId")
    answer = record.get("answer") or ""
    citations = record.get("citations") or []
    checks = record.get("sourceChecks") or []
    messages = record.get("messages")
    linked_answer = None
    if record.get("question") != spec["question"]:
        add("ISSUE", "QUESTION_CHANGED", "实际问题与该case不一致；不能算作原题已验收。")
    if status != "SUCCEEDED":
        add("ISSUE", "RUN_NOT_SUCCEEDED", f"运行状态为{status}，保留实际错误，不用原文或旧答案掩盖失败。")
    if record.get("probeError") or record.get("collectionError"):
        add("REVIEW", "PROBE_REPORTED_ERROR", "采集记录报告了错误；真实运行status保持原样，需核对证据是否完整。")
    if record.get("probeDeadlineExceeded"):
        add("ISSUE", "PROBE_DEADLINE_EXCEEDED", "验收等待超过预算并请求取消，不能作为正常按时完成计入。")
    if not run_id:
        add("REVIEW", "MISSING_RUN_ID", "缺少runId，不能独立确认跨轮归属。")
    if summary.get("runId") and summary["runId"] != run_id:
        add("ISSUE", "SUMMARY_RUN_MISMATCH", "摘要runId与记录runId不同。")
    if not answer.strip():
        add("ISSUE", "EMPTY_ANSWER", "没有面向用户的有效答复；SUCCEEDED不能代替交付证据。")
    if messages is None:
        add("REVIEW", "MISSING_MESSAGES", "缺少messages，答案关联和真实检索命中需要补证据。")
        messages = []
    else:
        answer_id = summary.get("answerMessageId")
        linked = next((m for m in messages if m.get("id") == answer_id), None) if answer_id else None
        if answer.strip() and not answer_id:
            add("ISSUE", "MISSING_ANSWER_LINK", "记录有answer但本轮没有answerMessageId，可能误取上一轮答案。")
        elif answer_id and linked is None:
            add("ISSUE", "LINKED_ANSWER_MISSING", "answerMessageId指向的消息不在证据中。")
        elif linked is not None:
            linked_answer = linked
            if linked.get("role") != "assistant" or linked.get("content", "") != answer:
                add("ISSUE", "WRONG_ANSWER_SELECTED", "answer不是本轮answerMessageId关联的助手正文。")
            linked_run = (linked.get("metadata") or {}).get("runId")
            if linked_run and linked_run != run_id:
                add("ISSUE", "ANSWER_FROM_OTHER_RUN", "关联答复metadata.runId属于另一轮。")
            elif not linked_run:
                add("REVIEW", "ANSWER_RUN_NOT_RECORDED", "关联答复缺少metadata.runId。")
        delivered = [m for m in messages if m.get("role") == "assistant" and str(m.get("content") or "").strip()
                     and (m.get("metadata") or {}).get("runId") == run_id]
        if len(delivered) > 1:
            add("ISSUE", "MULTIPLE_ANSWERS", "同一run保存了多条非空助手答复，应核对是否重复交付。")

    # The linked persisted answer is authoritative; do not rely on the probe's convenience coverage field.
    delivered_source_calls = [call for call in ((linked_answer or {}).get("metadata") or {}).get("toolCalls") or []
                              if isinstance(call, dict) and call.get("name") == "sourceAnswer"]
    source_delivery = None
    coverage_declaration = None
    if len(delivered_source_calls) > 1:
        add("ISSUE", "MULTIPLE_SOURCE_DELIVERY_CALLS", "关联答复包含多个sourceAnswer调用，不符合单次交付批次契约。")
    elif delivered_source_calls:
        source_delivery = decode_json(delivered_source_calls[0].get("arguments"))
        if not isinstance(source_delivery, dict):
            add("ISSUE", "MALFORMED_SOURCE_DELIVERY", "本轮关联sourceAnswer参数不是有效JSON对象。")
            source_delivery = None
        else:
            if set(source_delivery) - {"sources", "insufficient", "coverage"}:
                add("ISSUE", "FREEFORM_SOURCE_DELIVERY_FIELD", "sourceAnswer交付中出现自由正文或未知字段。")
            declared_coverage = source_delivery.get("coverage", "full")
            if "coverage" in source_delivery and (not isinstance(declared_coverage, str)
                                                   or declared_coverage not in {"full", "partial"}):
                add("ISSUE", "INVALID_COVERAGE_DECLARATION", "coverage只允许小写full或partial。")
            if source_delivery.get("insufficient") is True:
                coverage_declaration = "insufficient"
                if source_delivery.get("sources") is not None or "coverage" in source_delivery:
                    add("ISSUE", "MIXED_INSUFFICIENT_DELIVERY", "不足交付与来源或coverage混用。")
            else:
                coverage_declaration = declared_coverage if isinstance(declared_coverage, str) else "INVALID"

    current_messages = [m for m in messages if (m.get("metadata") or {}).get("runId") == run_id]
    requested = {}
    for message in current_messages:
        if message.get("role") != "assistant":
            continue
        for call in (message.get("metadata") or {}).get("toolCalls") or []:
            if isinstance(call.get("id"), str) and call["id"]:
                requested[call["id"]] = call.get("name")
    hits: dict[str, dict] = {}
    readable_retrievals = 0
    dates = set()
    for message in current_messages:
        response = (message.get("metadata") or {}).get("toolResponse") or {}
        name = response.get("name")
        if not name or requested.get(response.get("id")) != name:
            continue
        payload = response.get("responseData", message.get("content"))
        if name == "getDate":
            decoded = decode_json(payload)
            value = decoded if isinstance(decoded, str) else payload
            if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                dates.add(value)
        if name != "KnowledgeTool":
            continue
        envelope = decode_json(payload)
        if not isinstance(envelope, dict) or envelope.get("schemaVersion") != 1:
            add("REVIEW", "MALFORMED_RETRIEVAL", "本轮KnowledgeTool返回的信封缺失或版本不符。")
            continue
        retrieval_id = envelope.get("retrievalId")
        retrieval_status = envelope.get("status")
        returned = envelope.get("hits")
        valid = isinstance(retrieval_id, str) and bool(retrieval_id) and isinstance(returned, list)
        valid = valid and ((retrieval_status == "OK" and bool(returned))
                           or (retrieval_status in {"NO_MATCH", "UNAVAILABLE"} and not returned))
        if not valid:
            add("REVIEW", "MALFORMED_RETRIEVAL", "本轮检索状态与hits不满足信封契约，不能仅凭status判已检索。")
            continue
        if retrieval_status in {"OK", "NO_MATCH"}:
            readable_retrievals += 1
        for hit in returned:
            citation_id = hit.get("citationId")
            if isinstance(citation_id, str) and citation_id.startswith(retrieval_id + ":"):
                if citation_id in hits and hits[citation_id] != hit:
                    add("ISSUE", "CONFLICTING_CITATION_ID", "同一本轮citationId对应不同检索结果。")
                hits[citation_id] = hit

    labels = [c.get("label") for c in citations]
    if any(not isinstance(label, int) or isinstance(label, bool) for label in labels):
        add("ISSUE", "INVALID_LABEL", "来源编号必须为整数。")
    elif len(set(labels)) != len(labels) or sorted(labels) != list(range(1, len(labels) + 1)):
        add("ISSUE", "INVALID_LABEL_SEQUENCE", "来源编号重复或不连续。")
    citation_by_label = {c.get("label"): c for c in citations}
    checks_by_label = {c.get("label"): c for c in checks}
    if len(checks_by_label) != len(checks):
        add("ISSUE", "DUPLICATE_SOURCE_CHECK", "sourceChecks出现重复编号。")
    if set(citation_by_label) != set(checks_by_label):
        add("ISSUE", "SOURCE_CHECK_SET_MISMATCH", "来源卡片与sourceChecks编号集合不一致。")
    for citation in citations:
        label = citation.get("label")
        check = checks_by_label.get(label, {})
        source = citation.get("source") or {}
        for field in ("hashMatches", "lineRangeValid"):
            if check.get(field) is False:
                add("ISSUE", field.upper(), f"来源[{label}]的已保存{field}校验失败。")
            elif check.get(field) is not True:
                add("REVIEW", "INCOMPLETE_SOURCE_CHECK", f"来源[{label}]缺少{field}证据。")
        span = check.get("sourceLines")
        excerpt = citation.get("excerpt") or ""
        if not isinstance(span, str):
            add("REVIEW", "MISSING_SOURCE_LINES", f"来源[{label}]没有完整sourceLines。")
        elif not whitespace(excerpt) or not (whitespace(excerpt) in whitespace(span) or excerpt == displayed_excerpt(span)):
            add("ISSUE", "EXCERPT_MISMATCH", f"来源[{label}]的节选既不属于原文，也不符合300 UTF-16单位节选规则。")
        for field in ("documentId", "startLine", "endLine", "sourceHash"):
            if field in check and check[field] != source.get(field):
                add("ISSUE", "SOURCE_IDENTITY_MISMATCH", f"来源[{label}]的{field}不一致。")
        for field in ("citationId", "retrievalId", "kbId"):
            if field in check and check[field] != citation.get(field):
                add("ISSUE", "SOURCE_IDENTITY_MISMATCH", f"来源[{label}]的{field}不一致。")
        hit = hits.get(citation.get("citationId"))
        if messages and hit is None:
            add("ISSUE", "CITATION_NOT_RETRIEVED_THIS_RUN", f"来源[{label}]不在本轮真实请求并完成的检索命中中。")
        elif hit:
            if hit.get("kbId") != citation.get("kbId"):
                add("ISSUE", "CITATION_KB_CHANGED", f"来源[{label}]知识库与实际命中不符。")
            hit_source = hit.get("source") or {}
            if any(hit_source.get(k) != source.get(k) for k in ("documentId", "sourceHash", "startLine", "endLine")):
                add("ISSUE", "CITATION_SOURCE_CHANGED", f"来源[{label}]的文档、哈希或行号与实际命中不符。")

    body = answer.strip()
    date_context = DATE_CONTEXT.match(body)
    if date_context:
        if date_context.group(1) not in dates:
            add("ISSUE", "UNVERIFIED_DATE_CONTEXT", "查询时日期不来自本轮实际getDate结果。")
        body = body[date_context.end():]
    headings = list(HEADINGS.finditer(body))
    preamble = answer[:answer.find(headings[0].group(0))].strip() if headings else ""
    rendering = []
    if body == DEGRADED_UNCONFIRMED:
        outcome = "DEGRADED_UNCONFIRMED"
        if citations or headings:
            add("ISSUE", "DEGRADED_WITH_SOURCES", "未确认的服务降级不应附不相关来源冒充答案。")
        if not readable_retrievals:
            add("ISSUE" if messages else "REVIEW", "DEGRADED_WITHOUT_READABLE_RETRIEVAL",
                "缺少本轮可读检索证据；检索服务不可用应作为实际失败保留。")
        add("REVIEW", "DEGRADED_DID_NOT_ANSWER", "明确未能确认问题的降级输出，不算正常答案或成功资料不足判断。")
    elif body in {INSUFFICIENT, FALLBACK_PREFIX + "\n\n" + INSUFFICIENT}:
        outcome = "INSUFFICIENT" if body == INSUFFICIENT else "SOURCE_REFERENCE_FALLBACK"
        if citations:
            add("ISSUE", "INSUFFICIENT_WITH_CITATIONS", "固定资料不足结果不应挂不相关引用。")
        if not readable_retrievals:
            add("ISSUE" if messages else "REVIEW", "INSUFFICIENT_WITHOUT_READABLE_RETRIEVAL",
                "没有可确认的本轮OK/NO_MATCH检索，不能将工具不可用当作已核验的资料不足。")
    elif DATE_ONLY.fullmatch(body):
        outcome = "DATE_ONLY"
        if DATE_ONLY.fullmatch(body).group(1) not in dates:
            add("ISSUE", "UNVERIFIED_DATE", "日期答复不来自本轮实际getDate结果。")
        add("REVIEW", "CHECK_DATE_ONLY_INTENT", "人工确认原始问题是否仅问日期，不能遗漏复合请求。")
    elif headings:
        outcome = "SOURCE_REFERENCE_FALLBACK" if body.startswith((FALLBACK_PREFIX, LEGACY_FALLBACK_PREFIX)) else (
            "PARTIAL_SOURCE_ANSWER" if body.startswith(PARTIAL_PREFIX) else "SOURCE_ANSWER")
        source_preamble = body[:headings[0].start()].strip()
        if source_preamble not in ({SOURCE_PREFIX, PARTIAL_PREFIX + "\n\n" + SOURCE_PREFIX} | FALLBACK_PREAMBLES):
            add("REVIEW", "UNEXPECTED_SOURCE_PREAMBLE", "原文段落前还有其他正文，请核对是否为无来源生成结论。")
        section_labels = [int(h.group(1)) for h in headings]
        if len(section_labels) != len(set(section_labels)) or set(section_labels) != set(citation_by_label):
            add("ISSUE", "SOURCE_SECTION_SET_MISMATCH", "原文段落与来源卡片编号不一一对应。")
        for index, heading in enumerate(headings):
            label = int(heading.group(1))
            stop = headings[index + 1].start() if index + 1 < len(headings) else len(body)
            block = body[heading.end():stop].strip()
            lines = block.splitlines()
            quoted = all(not line.strip() or line.startswith(">") for line in lines)
            unwrapped = "\n".join(re.sub(r"^> ?", "", line) for line in lines)
            original = checks_by_label.get(label, {}).get("sourceLines")
            # Formatting equality confirms no source sentence was dropped. It does not prove relevance.
            matched = quoted and isinstance(original, str) and source_text(html.unescape(unwrapped)) == source_text(original)
            rendering.append(dict(label=label, fullSourceTextPreserved=matched))
            if not matched:
                add("REVIEW", "SOURCE_RENDERING_VARIANCE",
                    f"来源[{label}]的整段渲染未能自动恢复为sourceLines；人工检查代码/转义、遗漏或额外正文。")
        if not readable_retrievals:
            add("ISSUE" if messages else "REVIEW", "SOURCE_WITHOUT_READABLE_RETRIEVAL", "原文交付缺少本轮可读检索证据。")
    else:
        outcome = "EMPTY" if not body else "UNEXPECTED_FREEFORM"
        if body:
            add("ISSUE", "UNEXPECTED_FREEFORM", "新公开协议应交付原文、固定不足或真实日期，不能回退为自由生成正文。")

    fallback_recorded = any(e.get("type") == "ANSWER_FALLBACK" for e in record.get("events") or [])
    if outcome in {"SOURCE_REFERENCE_FALLBACK", "DEGRADED_UNCONFIRMED"} and not fallback_recorded:
        add("ISSUE", "FALLBACK_EVENT_MISSING", "降级正文没有本轮ANSWER_FALLBACK事件，不能确认实际发生了降级。")
    if source_delivery is not None:
        expected_outcome = {"full": "SOURCE_ANSWER", "partial": "PARTIAL_SOURCE_ANSWER",
                            "insufficient": "INSUFFICIENT"}.get(coverage_declaration)
        if expected_outcome is None or outcome != expected_outcome:
            add("ISSUE", "COVERAGE_PREAMBLE_MISMATCH", "本轮交付参数的覆盖声明与服务端固定正文形式不一致。")
    elif outcome in {"SOURCE_ANSWER", "PARTIAL_SOURCE_ANSWER", "INSUFFICIENT"} and messages and not fallback_recorded:
        add("ISSUE", "SOURCE_DELIVERY_CALL_MISSING", "正常知识交付缺少本轮关联的sourceAnswer调用。")

    expected = spec.get("expectedFiles") or []
    found = sorted({s.get("filename") for s in checks if s.get("filename")})
    matched_files = sorted(set(expected) & set(found))
    if expected and not matched_files:
        add("REVIEW", "NO_EXPECTED_SOURCE_FILE", "未引用预期资料文件；需确认错误不足、错路由或其他文件是否确有充分证据。")
    if outcome == "INSUFFICIENT" and expected:
        add("REVIEW", "CHECK_FALSE_INSUFFICIENT", "该题包含有资料或有边界可解释的部分，需人工判断是否被错误地全部拒答。")
    if record.get("expectedKnowledgeBaseUsed") is False:
        add("REVIEW", "KB_ROUTE_MISMATCH", "预期知识库未被使用，需要结合问题范围与实际原文核对。")
    event_counts = Counter(f"{e.get('type')}:{e.get('status')}" for e in record.get("events") or [])
    model_events = [e for e in record.get("events") or [] if e.get("type") in {"MODEL_CALL", "MODEL_RETRY"}]
    model_statuses = Counter(str(e.get("status")) for e in model_events)
    not_dispatched_model_attempts = sum(bool(re.search(r"(?:^|;)dispatch=not-started(?:;|$)", e.get("detail") or ""))
                                       for e in model_events)
    model_failure_kinds = Counter()
    model_failure_http = Counter()
    for event in model_events:
        if event.get("status") != "FAILED":
            continue
        detail = event.get("detail") or ""
        kind = re.search(r"(?:^|;)kind=([^;]+)", detail)
        http_status = re.search(r"(?:^|;)http=(\d+)(?:;|$)", detail)
        model_failure_kinds[kind.group(1) if kind else "UNSPECIFIED"] += 1
        if http_status:
            model_failure_http[http_status.group(1)] += 1
    if fallback_recorded:
        outcome = "SOURCE_REFERENCE_FALLBACK" if outcome in {"SOURCE_ANSWER", "PARTIAL_SOURCE_ANSWER", "INSUFFICIENT"} else outcome
    auto = "ISSUE" if any(f["level"] == "ISSUE" for f in findings) else (
        "REVIEW" if any(f["level"] == "REVIEW" for f in findings) else "PASS")
    return dict(id=spec["id"], attempt=record.get("attempt"), runId=run_id, sessionId=record.get("sessionId"),
                title=spec.get("title"), question=record.get("question"), category=spec.get("category", "original-regression"),
                semanticChecks=spec.get("semanticChecks", []), evidenceFile=str(evidence_path.resolve()),
                evidenceSha256=hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
                status=status, errorCode=summary.get("errorCode"), outcome=outcome,
                coverageDeclaration=coverage_declaration,
                autoVerdict=auto, findings=findings, readableRetrievals=readable_retrievals,
                eventCounts=dict(event_counts), expectedFiles=expected, foundFiles=found,
                recordedModelRequestStatuses=dict(model_statuses), modelFailureKinds=dict(model_failure_kinds),
                modelFailureHttpStatuses=dict(model_failure_http),
                preDispatchModelAttempts=not_dispatched_model_attempts,
                matchedExpectedFiles=matched_files, renderingChecks=rendering,
                answer=answer, serverPreamble=preamble, sources=checks,
                finishedAt=record.get("finishedAt") or record.get("startedAt", ""),
                probeErrorReported=bool(record.get("probeError") or record.get("collectionError")),
                semanticVerdict="PENDING", semanticReason="", finalVerdict="ISSUE" if auto == "ISSUE" else "PENDING",
                showcaseSuitable=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--results", type=Path, action="append", required=True, help="Saved evidence directory or file; repeatable")
    parser.add_argument("--attempt", required=True, help="Only this exact attempt is reviewed; no best-success selection")
    parser.add_argument("--output", type=Path, required=True, help="New output directory; existing paths are never overwritten")
    parser.add_argument("--decisions", type=Path, action="append", default=[], help="Independent semantic decision JSON arrays")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output already exists; choose a new directory to preserve earlier review evidence")
    plan = load(args.cases)
    single = {case["id"]: case for case in plan["cases"]}
    multi = {case["id"]: case for case in plan.get("multiTurnScenarios", [])}
    if len(single) != len(plan["cases"]):
        parser.error("duplicate single-turn case ids")
    rows, skipped, unrecognized, malformed, pending = [], 0, [], [], []
    paths = sorted({p.resolve() for location in args.results for p in
                    (location.rglob("*.json") if location.is_dir() else [location])})
    for path in paths:
        try:
            record = load(path)
        except (OSError, ValueError) as error:
            malformed.append(dict(file=str(path), errorType=type(error).__name__))
            continue
        if not isinstance(record, dict) or record.get("attempt") != args.attempt:
            skipped += 1
            continue
        if not any(key in record for key in ("answer", "runId", "summary", "messages")):
            continue
        key, spec, scenario, turn = identify(record, single, multi)
        if key is None:
            unrecognized.append(dict(file=str(path), id=record.get("id")))
            continue
        actual_status = (record.get("summary") or {}).get("status") or record.get("status")
        if actual_status not in {"SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"}:
            pending.append(dict(file=str(path), id=key, status=actual_status,
                                probeErrorReported=bool(record.get("probeError") or record.get("collectionError"))))
            continue
        row = audit(record, spec, path)
        row.update(scenarioId=scenario, turnIndex=turn)
        rows.append(row)
    if not rows:
        parser.error("no matching saved run records; check results path and exact attempt")

    multi_groups = defaultdict(list)
    for row in rows:
        if row["scenarioId"]:
            multi_groups[row["scenarioId"]].append(row)
    for scenario, members in multi_groups.items():
        if len({r["sessionId"] for r in members}) != 1 or any(not r["sessionId"] for r in members):
            for row in members:
                row["findings"].append(dict(level="ISSUE", code="MULTITURN_SESSION_MISMATCH",
                                            detail="同一组多轮问题没有在同一会话中执行。"))
                row["autoVerdict"] = row["finalVerdict"] = "ISSUE"
        if len({r["runId"] for r in members}) != len(members):
            for row in members:
                row["findings"].append(dict(level="ISSUE", code="MULTITURN_RUN_REUSED",
                                            detail="不同会话轮次复用了同一runId，不能视作独立连续提问。"))
                row["autoVerdict"] = row["finalVerdict"] = "ISSUE"

    unused_decisions = []
    decided_rows = set()
    for file in args.decisions:
        decisions = load(file)
        if not isinstance(decisions, list):
            parser.error("semantic decisions must be a JSON array")
        for decision in decisions:
            matches = [r for r in rows if r["id"] == decision.get("id") and r["attempt"] == decision.get("attempt")
                       and (not decision.get("runId") or r["runId"] == decision["runId"])]
            if len(matches) != 1:
                unused_decisions.append(dict(file=str(file), id=decision.get("id"), reason="no unique matching run"))
                continue
            row = matches[0]
            identity = (row["id"], row["attempt"], row["runId"])
            if identity in decided_rows:
                unused_decisions.append(dict(file=str(file), id=decision.get("id"), reason="duplicate semantic decision"))
                if decision.get("verdict") == "ISSUE":
                    row["finalVerdict"] = "ISSUE"
                    row["showcaseSuitable"] = False
                continue
            decided_rows.add(identity)
            verdict = decision.get("verdict", "PENDING")
            row["semanticVerdict"] = verdict
            row["semanticReason"] = decision.get("reason", "")
            if row["autoVerdict"] == "ISSUE" or verdict == "ISSUE":
                row["finalVerdict"] = "ISSUE"
            elif verdict == "PASS" and row["semanticReason"].strip():
                row["finalVerdict"] = "PASS"
            else:
                row["finalVerdict"] = "PENDING"
            row["showcaseSuitable"] = (row["finalVerdict"] == "PASS" and decision.get("showcaseSuitable") is True
                                       and row["outcome"] not in {"SOURCE_REFERENCE_FALLBACK", "DEGRADED_UNCONFIRMED"})

    present = {row["id"] for row in rows}
    expected_multi = {f"{key}-T{index}" for key, spec in multi.items() for index in range(1, len(spec["turns"]) + 1)}
    duplicates = [dict(id=key, count=count) for key, count in Counter(r["id"] for r in rows).items() if count > 1]
    counts = dict(Counter(row["finalVerdict"] for row in rows))
    model_statuses = Counter()
    model_failure_kinds = Counter()
    model_failure_http = Counter()
    for row in rows:
        model_statuses.update(row["recordedModelRequestStatuses"])
        model_failure_kinds.update(row["modelFailureKinds"])
        model_failure_http.update(row["modelFailureHttpStatuses"])
    summary = dict(attempt=args.attempt, scope="Saved candidate evidence only; not a frozen retrieval benchmark",
                   plannedSingleTurnCases=len(single), plannedMultiTurnScenarios=len(multi),
                   recordedAttempts=len(rows), outcomes=dict(Counter(r["outcome"] for r in rows)),
                   autoVerdicts=dict(Counter(r["autoVerdict"] for r in rows)), finalVerdicts=counts,
                   coverageDeclarations=dict(Counter(str(r["coverageDeclaration"]) for r in rows)),
                   recordedModelRequests=sum(model_statuses.values()), modelRequestStatuses=dict(model_statuses),
                   modelFailureKinds=dict(model_failure_kinds), modelFailureHttpStatuses=dict(model_failure_http),
                   modelCallAccounting="Recorded caller attempts; a MODEL_CALL event alone is not a wire HTTP observation.",
                   preDispatchModelAttempts=sum(r["preDispatchModelAttempts"] for r in rows),
                   missingSingleTurnCases=sorted(set(single) - present), missingMultiTurnCases=sorted(expected_multi - present),
                   duplicateCaseRecords=duplicates, unrecognizedRecords=unrecognized, unreadableJsonFiles=malformed,
                   pendingNonterminalRecords=pending,
                   skippedDifferentAttemptOrNonRunFiles=skipped, unmatchedSemanticDecisions=unused_decisions,
                   executionScenarios=dict(planned=len(plan.get("executionScenarios", [])), assessed=False,
                                           note="隔离执行场景需要单元/PG故障注入证据，本脚本不把普通问答当作它们已通过。"),
                   overallReleaseVerdict="NOT_ASSESSED",
                   allContentCasesPassed=(not (set(single) - present or expected_multi - present or duplicates or malformed or unrecognized
                                  or unused_decisions) and all(r["finalVerdict"] == "PASS"
                                  and r["outcome"] != "DEGRADED_UNCONFIRMED" for r in rows)))
    rank = {"ISSUE": 0, "REVIEW": 1, "PASS": 2}
    rows.sort(key=lambda r: (rank[r["autoVerdict"]], r["id"], str(r["finishedAt"])))
    template = [dict(id=r["id"], attempt=r["attempt"], runId=r["runId"], verdict="PENDING", reason="",
                     showcaseSuitable=False) for r in rows]
    report = ["# 候选问答语义评审包", "", f"指定轮次：{args.attempt}。保留全部匹配记录，不自动选择成功样本。", "",
              "自动通过仅代表机械校验通过；必须逐题判断原文是否覆盖问题、条件是否完整、是否错误地判资料不足。", "",
              "降级原文参考单独统计，不计作自动恢复了生成答案；未附人工判断时总体结论始终待审。", ""]
    for row in rows:
        report += [f"## {row['id']} · {row['title']}", "", row["question"], "",
                   f"attempt={row['attempt']}；runId={row['runId']}；终态={row['status']}；交付={row['outcome']}；机械={row['autoVerdict']}。", ""]
        for finding in row["findings"]:
            report.append(f"- {finding['level']} / {finding['code']}：{finding['detail']}")
        if row["findings"]:
            report.append("")
        for criterion in row["semanticChecks"]:
            report.append("- 人工核对：" + criterion)
        if row["semanticChecks"]:
            report.append("")
        preserved = bool(row["renderingChecks"]) and all(c["fullSourceTextPreserved"] for c in row["renderingChecks"])
        if preserved:
            report += ["原文段落已自动恢复并与sourceLines一致，下面仅列来源一次；请判断它们与问题的关系。", "",
                       "实际前言：", "", row["serverPreamble"], ""]
        else:
            report += ["实际答复：", "", row["answer"] or "（无答复）", ""]
        for source in row["sources"]:
            report += [f"### 来源[{source.get('label')}]：{source.get('filename')} L{source.get('startLine')}–{source.get('endLine')}",
                       "", source.get("sourceLines") or "（缺少sourceLines）", ""]
        report += [f"人工结论：{row['semanticVerdict']}；{row['semanticReason']}", ""]
    args.output.mkdir(parents=True, exist_ok=False)
    for filename, data in (("summary.json", summary), ("mechanical-review.json", rows), ("semantic-decisions-template.json", template)):
        (args.output / filename).write_text(json_text(data), encoding="utf-8")
    (args.output / "review-packet.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(json.dumps(dict(output=str(args.output.resolve()), recorded=len(rows), auto=summary["autoVerdicts"],
                          final=counts, missingSingle=len(summary["missingSingleTurnCases"]),
                          missingMulti=len(summary["missingMultiTurnCases"]), contentPassed=summary["allContentCasesPassed"]), ensure_ascii=True))


if __name__ == "__main__":
    main()
