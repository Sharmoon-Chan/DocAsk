import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import XMarkdown from "@ant-design/x-markdown";
import {
  CheckCircleOutlined,
  DownOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  RobotOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import type {
  AnswerCitation,
  ChatMessageVO,
  SseMessageType,
  ToolCall,
  ToolResponse,
} from "../../../types";
import DocumentPreviewDrawer from "../../modals/DocumentPreviewDrawer.tsx";
import { buildTurns, isReadableAnswer } from "./chatTurns.ts";
import { getRun, listSessionRuns } from "../../../api/execution.ts";
import type {
  RunEventType,
  RunEventView,
  RunStatus,
  RunSummaryView,
  ChatMessageMetadataWithRun,
} from "../../../types/execution.ts";

interface AgentChatHistoryProps {
  messages: ChatMessageVO[];
  /** 会话标识：用于按需读取服务端运行记录；缺省（例如公开精选）时不显示执行详情。 */
  sessionId?: string;
  refreshVersion?: number;
  waitStartedAt?: number | null;
  autoScroll?: boolean;
  displayAgentStatus?: boolean;
  agentStatusText?: string;
  agentStatusType?: SseMessageType;
  /** 相关追问：只有点击才发起新的运行，不随答案自动提交。 */
  onAskFollowUp?: (content: string) => void | Promise<boolean>;
  followUpPrompts?: readonly string[];
  /** 当前是否已有一轮在等待答复；等待期间追问不可点。 */
  busy?: boolean;
  /** 取消请求已登记但终态未确认时的活动状态文字。 */
  cancelling?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  KnowledgeTool: "知识库检索",
  getDate: "日期查询",
  sourceAnswer: "原文交付",
  directAnswer: "生成回答",
  terminate: "结束任务",
};

/** 超过这个字符数的回答默认折叠，保留完整 Markdown，只是把容器高度收起来。 */
const LONG_ANSWER_THRESHOLD = 1200;
/** 判定「用户还在跟随本轮」的底部容差。 */
const FOLLOW_THRESHOLD = 24;

function formatToolData(value: string | null | undefined): string {
  if (!value) return "无内容";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function messageRunId(message: ChatMessageVO | undefined): string | undefined {
  const metadata = message?.metadata as ChatMessageMetadataWithRun | undefined;
  return metadata?.runId ?? undefined;
}

function citationKey(citation: AnswerCitation, index: number): string {
  return `${citation.label}:${citation.citationId ?? citation.source.documentId}:${index}`;
}

function citationHeading(citation: AnswerCitation): string {
  const headingPath = citation.source.headingPath ?? [];
  return headingPath.filter(Boolean).join(" › ");
}

function citationPosition(citation: AnswerCitation): string {
  const { startLine, endLine } = citation.source;
  return startLine != null && endLine != null ? `第 ${startLine}–${endLine} 行` : "整份文档（无精确位置）";
}

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "未完成",
  CANCELLED: "已取消",
  INTERRUPTED: "已中断",
};

const RUN_STATUS_CLASSES: Record<RunStatus, string> = {
  QUEUED: "text-slate-500",
  RUNNING: "text-accent",
  SUCCEEDED: "text-verified",
  FAILED: "text-amber-700",
  CANCELLED: "text-amber-700",
  INTERRUPTED: "text-amber-700",
};

const RUN_EVENT_LABELS: Record<RunEventType, string> = {
  MODEL_CALL: "模型调用",
  MODEL_RETRY: "模型重试",
  DELIVERY_REPAIR: "答复校验与修正",
  ANSWER_FALLBACK: "原文参考回退",
  TOOL_CALL: "工具调用",
  RETRIEVAL: "知识库检索",
  PERSIST_MESSAGE: "消息落库",
  STEP_LIMIT: "达到步数上限",
  ERROR: "执行错误",
};

const RUN_ERROR_LABELS: Record<string, string> = {
  AUTHORIZATION_REVOKED: "登录状态失效",
  MODEL_UNAVAILABLE: "模型服务未响应（已自动重试）",
  MODEL_CALL_FAILED: "模型服务连接失败",
  UPSTREAM_BUSY: "模型服务繁忙",
  TOOL_FAILED: "工具执行失败",
  RETRIEVAL_UNAVAILABLE: "知识库检索不可用",
  RETRIEVAL_DENIED: "知识库检索被拒绝",
  MESSAGE_PERSISTENCE_FAILED: "答复保存失败",
  NO_ANSWER_PRODUCED: "未产出答复",
  INVALID_ANSWER_FORMAT: "答复未通过内容核对",
  EXECUTION_FAILED: "执行中断",
};

interface FailureText {
  title: string;
  hint: string;
  retryable: boolean;
}

function failureText(errorCode: string | null | undefined, status: RunStatus): FailureText {
  switch (errorCode) {
    case "INVALID_ANSWER_FORMAT":
      return {
        title: "这次的回答没能通过自动核对，所以没有展示",
        hint: "回答里的引用编号和检索到的来源对不上时，系统会拦下整轮内容，避免给你看未经核实的出处。重新提问一次通常就正常。",
        retryable: true,
      };
    case "MODEL_UNAVAILABLE":
    case "MODEL_CALL_FAILED":
    case "UPSTREAM_BUSY":
      return {
        title: "模型服务这次没有返回结果",
        hint: "通常是服务商临时繁忙；系统已自动重试仍未成功。稍等几秒再问一次即可。",
        retryable: true,
      };
    case "RETRIEVAL_UNAVAILABLE":
    case "RETRIEVAL_DENIED":
      return {
        title: "这次没能检索到知识库内容",
        hint: "可以换个说法再问，或稍后再试一次。",
        retryable: true,
      };
    case "AUTHORIZATION_REVOKED":
      return {
        title: "登录状态已失效，这次没有继续执行",
        hint: "重新登录后再提问即可；知识库与历史记录都不受影响。",
        retryable: false,
      };
    case "MESSAGE_PERSISTENCE_FAILED":
      return {
        title: "回答已经生成，但没能保存下来",
        hint: "重新提问即可；如果反复出现，可以在「查看过程」里展开错误详情反馈。",
        retryable: true,
      };
    case "NO_ANSWER_PRODUCED":
      return {
        title: "这次没有产出可展示的回答",
        hint: "重新提问一次即可。",
        retryable: true,
      };
    default:
      if (status === "CANCELLED") {
        return { title: "这次运行在给出回答前被取消了", hint: "需要的话点下面的按钮重新提问。", retryable: true };
      }
      if (status === "INTERRUPTED") {
        return {
          title: "服务重启打断了这次运行，所以没有回答",
          hint: "系统不会自动重放已中断的请求，重新提问即可。",
          retryable: true,
        };
      }
      return {
        title: "这次没能在限定时间内给出回答",
        hint: "可能是网络或服务临时波动。重新提问即可；连续出现可在「查看过程」里展开错误详情反馈。",
        retryable: true,
      };
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "未记录";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatUsage(run: RunSummaryView): string | null {
  if (run.inputTokens == null && run.outputTokens == null && run.totalTokens == null) return null;
  const input = run.inputTokens == null ? "未提供" : String(run.inputTokens);
  const output = run.outputTokens == null ? "未提供" : String(run.outputTokens);
  const total = run.totalTokens == null ? null : String(run.totalTokens);
  return `用量 ${input} / ${output}${total ? `（共 ${total}）` : ""} tokens`;
}

function runEventDetail(event: RunEventView): string {
  if (event.type === "TOOL_CALL") {
    const name = event.toolName ? ` · ${event.toolName}` : "";
    const id = event.toolCallId ? ` · ${event.toolCallId}` : "";
    return `工具调用${name}${id}`;
  }
  if (event.type === "RETRIEVAL") {
    const state = event.detail ? ` · ${event.detail}` : "";
    const id = event.retrievalId ? ` · ${event.retrievalId}` : "";
    return `知识库检索${state}${id}`;
  }
  if (event.type === "MODEL_CALL" || event.type === "MODEL_RETRY") {
    return event.retryAttempt && event.retryAttempt > 1
      ? `${RUN_EVENT_LABELS[event.type]} · 第 ${event.retryAttempt} 次尝试`
      : RUN_EVENT_LABELS[event.type];
  }
  if (event.errorCode) return `${RUN_EVENT_LABELS[event.type]} · ${RUN_ERROR_LABELS[event.errorCode] ?? event.errorCode}`;
  return RUN_EVENT_LABELS[event.type];
}

function runInProgressDetail(run: RunSummaryView): string | null {
  const status: RunStatus = run.interrupted ? "INTERRUPTED" : run.status;
  if (status === "QUEUED") return "任务已受理，正在等待执行。";
  if (status === "RUNNING") return "正在执行；刷新页面不会中断它。";
  return null;
}

interface CitationGroup {
  key: string;
  documentId: string;
  documentName: string;
  sourceHash: string;
  citations: AnswerCitation[];
}

function groupCitations(citations: AnswerCitation[]): CitationGroup[] {
  const groups = new Map<string, CitationGroup>();
  for (const citation of citations) {
    const sourceHash = citation.source.sourceHash ?? "";
    const key = `${citation.source.documentId}|${sourceHash}`;
    const existing = groups.get(key);
    if (existing) {
      existing.citations.push(citation);
      continue;
    }
    groups.set(key, {
      key,
      documentId: citation.source.documentId,
      documentName: citation.source.documentName,
      sourceHash,
      citations: [citation],
    });
  }
  return [...groups.values()];
}

const CitationEntry: React.FC<{
  citations: AnswerCitation[];
  onOpen: (citation: AnswerCitation) => void;
}> = ({ citations, onOpen }) => {
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupCitations(citations), [citations]);
  const documentNames = useMemo(() => {
    const names: string[] = [];
    for (const group of groups) {
      if (!names.includes(group.documentName)) names.push(group.documentName);
    }
    return names;
  }, [groups]);
  const label = documentNames.slice(0, 3).join(" · ") + (documentNames.length > 3 ? ` 等 ${documentNames.length} 篇` : "");
  const panelId = `citations-${useId()}`;

  return (
    <section
      className="mt-3.5 min-w-0 max-w-full rounded-xl border border-verified-border bg-verified-soft/65 text-xs"
      aria-label="回答来源"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-10 w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl px-3.5 py-2 text-left transition-colors hover:bg-verified-soft"
      >
        <FileSearchOutlined className="shrink-0 text-verified" />
        <span className="min-w-0 flex-1 break-words font-semibold text-emerald-900">
          已核验来源：{label}
        </span>
        <span className="shrink-0 font-mono text-verified">共 {citations.length} 处引用</span>
        <span className="flex shrink-0 items-center gap-1 font-semibold text-emerald-900">
          {expanded ? "收起来源" : "查看全部依据"}
          <DownOutlined className={expanded ? "rotate-180 transition-transform duration-200" : "transition-transform duration-200"} />
        </span>
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-verified-border px-3.5 py-3">
          <ul className="flex flex-col gap-3">
            {groups.map((group) => (
              <li key={group.key} className="min-w-0">
                <p className="mb-1.5 break-all text-xs font-bold text-ink">
                  {group.documentName}
                  <span className="ml-2 font-normal text-slate-400">本条文档 {group.citations.length} 处片段</span>
                </p>
                <ul className="flex flex-col gap-2">
                  {group.citations.map((citation, index) => (
                    <li
                      key={citationKey(citation, index)}
                      className="min-w-0 rounded-lg border border-slate-200 bg-white p-2.5 shadow-card"
                    >
                      <button
                        type="button"
                        onClick={() => onOpen(citation)}
                        aria-label={`打开来源 ${citation.label}：${citation.source.documentName}`}
                        className="flex w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-left"
                      >
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-bold text-accent">
                          [{citation.label}]
                        </span>
                        <span className="font-semibold text-ink">{citationPosition(citation)}</span>
                        {citationHeading(citation) && (
                          <span className="min-w-0 break-words text-slate-500">{citationHeading(citation)}</span>
                        )}
                        <span className="ml-auto shrink-0 rounded-md border border-accent-border bg-accent-soft px-2 py-0.5 font-semibold text-accent transition-colors hover:bg-accent hover:text-white">
                          查看原文 →
                        </span>
                      </button>
                      <p className="mt-1.5 break-words leading-5 text-slate-600">{citation.excerpt}</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
                        SHA-256 {citation.source.sourceHash ? citation.source.sourceHash.slice(0, 16) : "无（旧版索引）"}
                        {citation.chunkId ? ` · 片段 ${citation.chunkId}` : ""}
                        {citation.indexVersion || citation.indexRevision
                          ? ` · 索引 ${[citation.indexVersion, citation.indexRevision].filter(Boolean).join(" / ")}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

const AnswerBody: React.FC<{ messageId: string; content: string }> = ({ messageId, content }) => {
  const [expanded, setExpanded] = useState(false);
  const collapsible = content.length > LONG_ANSWER_THRESHOLD;
  const panelId = `answer-body-${messageId}`;
  return (
    <div className="min-w-0">
      <div
        id={panelId}
        className={collapsible && !expanded
          ? "relative max-h-[60vh] min-w-0 overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-16 after:bg-gradient-to-t after:from-white after:to-transparent"
          : "min-w-0"}
      >
        <div className="answer-markdown min-w-0 max-w-full">
          <XMarkdown streaming={{ enableAnimation: false, hasNextChunk: false }}>{content}</XMarkdown>
        </div>
      </div>
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-accent hover:underline"
        >
          <DownOutlined className={expanded ? "rotate-180 transition-transform duration-200" : "transition-transform duration-200"} />
          {expanded ? "收起回答" : `展开完整回答（共 ${content.length} 字）`}
        </button>
      )}
    </div>
  );
};

const RunTimeline: React.FC<{ runId: string }> = ({ runId }) => {
  const [attempt, setAttempt] = useState(0);
  const [events, setEvents] = useState<RunEventView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getRun(runId).then((detail) => {
      if (!active) return;
      if (!detail || !Array.isArray(detail.events)) {
        setFailed(true);
        return;
      }
      setEvents(detail.events);
      setFailed(false);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [runId, attempt]);

  if (failed && events == null) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-slate-500">
        执行过程暂时无法读取。
        <Button size="small" type="link" icon={<ReloadOutlined />} onClick={() => setAttempt((value) => value + 1)}>
          重试
        </Button>
      </p>
    );
  }
  if (events == null) return <p className="text-slate-400">正在读取执行过程…</p>;
  if (events.length === 0) return <p className="text-slate-400">这次执行没有记录到步骤。</p>;
  return (
    <ol className="flex flex-col gap-1.5 font-mono text-[11.5px]">
      {events.map((event) => (
        <li key={`${event.sequence}-${event.type}`} className="flex flex-wrap items-baseline gap-x-2.5 rounded-md bg-white px-2.5 py-1.5 border border-slate-200/80">
          <span className="font-bold text-slate-400">#{event.sequence}</span>
          <span className="min-w-0 flex-1 font-sans text-slate-700">{runEventDetail(event)}</span>
          <span className="text-slate-400">{formatDuration(event.durationMs)}</span>
          <span className={event.status === "SUCCEEDED" ? "font-sans font-semibold text-verified" : "font-sans font-semibold text-rose-700"}>
            {event.status === "SUCCEEDED" ? "成功" : event.status === "FAILED" ? "失败" : "已取消"}
          </span>
        </li>
      ))}
    </ol>
  );
};

const ProcessDisclosure: React.FC<{
  run?: RunSummaryView;
  sessionId?: string;
  toolCalls: ToolCall[];
  toolResponses: ToolResponse[];
}> = ({ run, sessionId, toolCalls, toolResponses }) => {
  const [opened, setOpened] = useState(false);
  const status: RunStatus | undefined = run ? (run.interrupted ? "INTERRUPTED" : run.status) : undefined;
  const toolCount = toolCalls.length + toolResponses.length;
  const canLoadTimeline = !!run && !!sessionId;

  return (
    <details
      className="mt-2.5 min-w-0 rounded-xl border border-slate-200 bg-slate-50/90 text-xs"
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="flex min-h-10 cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-0.5 px-3.5 py-2 leading-6">
        <RobotOutlined className="shrink-0 text-accent" />
        <span className="font-semibold text-ink">{run ? "执行过程" : "工具记录"}</span>
        {status && <span className={`font-semibold ${RUN_STATUS_CLASSES[status]}`}>{RUN_STATUS_LABELS[status]}</span>}
        {run && <span className="font-mono text-slate-500">耗时 {formatDuration(run.durationMs)}</span>}
        {run?.queueDurationMs != null && run.queueDurationMs >= 1000 && (
          <span className="font-mono text-slate-400">排队 {formatDuration(run.queueDurationMs)}</span>
        )}
        {toolCount > 0 && <span className="text-slate-500">{toolCalls.length} 次工具调用</span>}
        {run?.modelName && <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-500 border border-slate-200">{run.modelName}</span>}
        {run?.traceIncomplete && <span className="text-amber-600">执行详情不完整</span>}
        <span className="ml-auto shrink-0 font-semibold text-accent">查看过程</span>
      </summary>
      <div className="flex flex-col gap-2.5 border-t border-slate-200 px-3.5 py-3">
        {opened && run && canLoadTimeline && <RunTimeline runId={run.runId} />}
        {opened && run && !canLoadTimeline && <p className="text-slate-400">当前页面没有读取执行过程所需的信息。</p>}
        {opened && run && formatUsage(run) && <p className="font-mono text-[11px] text-slate-500">{formatUsage(run)}</p>}
        {opened && run?.errorCode && (
          <p className="break-all font-mono text-[11px] text-slate-500">
            错误分类 {run.errorCode} · {RUN_ERROR_LABELS[run.errorCode] ?? "未分类"}
          </p>
        )}
        {toolCalls.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold text-slate-600">工具调用</p>
            {toolCalls.map((toolCall) => (
              <details key={toolCall.id} className="min-w-0 rounded-lg border border-slate-200 bg-white">
                <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 px-2.5 py-1 leading-6 text-slate-700">
                  <ToolOutlined className="shrink-0 text-accent" />
                  <span className="font-semibold">{TOOL_LABELS[toolCall.name] || toolCall.name}</span>
                  <span className="font-mono text-[11px] text-slate-400">{toolCall.name}</span>
                </summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11.5px] leading-6 text-slate-700">
                  {formatToolData(toolCall.arguments)}
                </pre>
              </details>
            ))}
          </div>
        )}
        {toolResponses.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold text-slate-600">工具结果</p>
            {toolResponses.map((toolResponse) => (
              <details key={toolResponse.id} className="min-w-0 rounded-lg border border-slate-200 bg-white">
                <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 px-2.5 py-1 leading-6 text-slate-700">
                  <FileSearchOutlined className="shrink-0 text-accent" />
                  <span className="font-semibold">{TOOL_LABELS[toolResponse.name] || toolResponse.name}</span>
                  <span className="font-mono text-[11px] text-slate-400">{toolResponse.name}</span>
                </summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11.5px] leading-6 text-slate-700">
                  {formatToolData(toolResponse.responseData)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
};

const RunOutcomeNotice: React.FC<{ run: RunSummaryView; onRetry?: () => void }> = ({ run, onRetry }) => {
  const status: RunStatus = run.interrupted ? "INTERRUPTED" : run.status;
  const busy = status === "QUEUED" || status === "RUNNING";
  const failure = failureText(run.errorCode, status);
  return (
    <div
      role={busy ? "status" : "note"}
      className="mt-1.5 min-w-0 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{busy ? "本次回答" : "这次没有拿到回答"}</span>
        <span className={`font-semibold ${RUN_STATUS_CLASSES[status] ?? "text-slate-600"}`}>{RUN_STATUS_LABELS[status] ?? status}</span>
        {typeof run.durationMs === "number" && run.durationMs > 0 && (
          <span className="font-mono text-slate-500">耗时 {(run.durationMs / 1000).toFixed(1)} s</span>
        )}
      </div>
      <p className={(busy ? "mt-1" : "mt-1.5") + " leading-5 text-slate-600"}>
        {busy ? runInProgressDetail(run) : failure.hint}
      </p>
      {!busy && failure.retryable && onRetry && (
        <Button size="small" className="mt-2" icon={<ReloadOutlined />} onClick={onRetry}>
          重新提问
        </Button>
      )}
    </div>
  );
};

const RunLoadNotice: React.FC<{
  message: string;
  onRetry: () => void;
  stale?: boolean;
}> = ({ message, onRetry, stale }) => (
  <div
    role={stale ? "status" : "alert"}
    className={stale
      ? "mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2 text-xs text-slate-700"
      : "mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-xs text-slate-700"}
  >
    <span className="min-w-0 flex-1">
      {stale ? `执行记录尚未更新：${message}` : `执行记录暂时无法读取：${message}`}
    </span>
    <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
      重试
    </Button>
  </div>
);

const ElapsedWait: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="font-mono text-xs text-slate-500" data-wait-seconds={seconds} aria-live="off">
      已等待 {seconds} 秒{seconds >= 10 ? " · 仍在处理中，可停止或稍后回来查看" : ""}
    </span>
  );
};

const AgentChatHistory: React.FC<AgentChatHistoryProps> = ({
  messages,
  sessionId,
  refreshVersion = 0,
  waitStartedAt = null,
  autoScroll = true,
  displayAgentStatus = false,
  agentStatusText = "",
  agentStatusType,
  onAskFollowUp,
  followUpPrompts = [],
  busy = false,
  cancelling = false,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const suppressScrollRef = useRef(0);
  const seenAnswerIdsRef = useRef<Set<string>>(new Set());
  const seenQuestionIdsRef = useRef<Set<string>>(new Set());
  const didInitialPositionRef = useRef(false);
  const requestSeqRef = useRef(0);
  const hadSuccessfulReadRef = useRef(false);

  const [newAnswerId, setNewAnswerId] = useState<string | null>(null);
  const [citedSource, setCitedSource] = useState<AnswerCitation | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const focusRestoreTimerRef = useRef<number | null>(null);

  const openCitation = useCallback((citation: AnswerCitation) => {
    if (focusRestoreTimerRef.current !== null) window.clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = null;
    previewTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCitedSource(citation);
  }, []);

  const closeCitation = useCallback(() => {
    setCitedSource(null);
    const trigger = previewTriggerRef.current;
    previewTriggerRef.current = null;
    if (focusRestoreTimerRef.current !== null) window.clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = window.setTimeout(() => {
      focusRestoreTimerRef.current = null;
      if (trigger?.isConnected) trigger.focus();
    }, 60);
  }, []);

  useEffect(() => () => {
    if (focusRestoreTimerRef.current !== null) window.clearTimeout(focusRestoreTimerRef.current);
  }, []);

  const [runs, setRuns] = useState<RunSummaryView[]>([]);
  const [runLoad, setRunLoad] = useState<"idle" | "loading" | "ready" | "error">(sessionId ? "loading" : "idle");
  const [runError, setRunError] = useState("");
  const [runStale, setRunStale] = useState(false);

  const loadRuns = useCallback(async () => {
    if (!sessionId) return;
    const seq = ++requestSeqRef.current;
    const targetSession = sessionId;
    try {
      const response = await listSessionRuns(targetSession);
      if (seq !== requestSeqRef.current || targetSession !== sessionId) return;
      const nextRuns = Array.isArray(response?.runs) ? response.runs : [];
      hadSuccessfulReadRef.current = true;
      setRuns(nextRuns);
      setRunLoad("ready");
      setRunError("");
      setRunStale(false);
    } catch (error) {
      if (seq !== requestSeqRef.current || targetSession !== sessionId) return;
      const message = error instanceof Error && error.message ? error.message : "暂时无法读取执行记录";
      setRunError(message);
      if (hadSuccessfulReadRef.current) {
        setRunLoad("ready");
        setRunStale(true);
      } else {
        setRunLoad("error");
      }
    }
  }, [sessionId]);

  const retryRuns = useCallback(() => {
    setRunLoad((previous) => (previous === "ready" ? previous : "loading"));
    setRunError("");
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setTimeout(() => { void loadRuns(); }, 0);
    return () => {
      window.clearTimeout(timer);
      requestSeqRef.current += 1;
    };
  }, [loadRuns, messages.length, sessionId, refreshVersion]);

  const hasActiveRun = runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING");
  useEffect(() => {
    if (!sessionId || !hasActiveRun) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadRuns();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [sessionId, hasActiveRun, loadRuns]);

  const turns = useMemo(() => buildTurns(messages, runs), [messages, runs]);

  const markProgrammaticScroll = useCallback(() => {
    suppressScrollRef.current = performance.now() + 400;
  }, []);

  const scrollToElementTop = useCallback((element: HTMLElement | null) => {
    const container = scrollContainerRef.current;
    if (!container || !element) return;
    markProgrammaticScroll();
    const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop = Math.max(0, container.scrollTop + delta - 12);
  }, [markProgrammaticScroll]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    markProgrammaticScroll();
    container.scrollTop = container.scrollHeight;
  }, [markProgrammaticScroll]);

  const answerElement = useCallback((messageId: string): HTMLElement | null => {
    const container = scrollContainerRef.current;
    if (!container) return null;
    return container.querySelector<HTMLElement>(`[data-answer-id="${messageId}"]`);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearBottom = distance <= FOLLOW_THRESHOLD;
      if (performance.now() >= suppressScrollRef.current) {
        followRef.current = nearBottom;
      }
      if (nearBottom) setNewAnswerId((previous) => (previous ? null : previous));
    };
    const onSelection = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && container.contains(selection.anchorNode)) followRef.current = false;
    };
    const onInteraction = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("button, summary, a")) followRef.current = false;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        suppressScrollRef.current = 0;
        followRef.current = false;
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("pointerdown", onInteraction, { passive: true });
    document.addEventListener("selectionchange", onSelection);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onInteraction);
      document.removeEventListener("selectionchange", onSelection);
    };
  }, []);

  useEffect(() => {
    if (!autoScroll || messages.length === 0) return;
    const timer = requestAnimationFrame(() => {
      const answers = messages.filter(isReadableAnswer);
      const questions = messages.filter((message) => message.role === "user");
      const newAnswers = answers.filter((message) => !seenAnswerIdsRef.current.has(message.id));
      const newQuestions = questions.filter((message) => !seenQuestionIdsRef.current.has(message.id));
      answers.forEach((message) => seenAnswerIdsRef.current.add(message.id));
      questions.forEach((message) => seenQuestionIdsRef.current.add(message.id));
      if (!didInitialPositionRef.current) {
        didInitialPositionRef.current = true;
        const last = answers.at(-1);
        if (last) scrollToElementTop(answerElement(last.id));
        else scrollToBottom();
        return;
      }
      if (newQuestions.length) {
        followRef.current = true;
        setNewAnswerId(null);
        scrollToBottom();
      }
      const last = newAnswers.at(-1);
      if (!last) return;
      if (followRef.current) scrollToElementTop(answerElement(last.id));
      else setNewAnswerId(last.id);
    });
    return () => cancelAnimationFrame(timer);
  }, [answerElement, autoScroll, messages, scrollToBottom, scrollToElementTop]);

  useEffect(() => {
    if (!autoScroll || !displayAgentStatus || !followRef.current) return;
    const timer = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(timer);
  }, [autoScroll, displayAgentStatus, scrollToBottom]);

  const jumpToNewAnswer = useCallback(() => {
    if (!newAnswerId) return;
    followRef.current = true;
    scrollToElementTop(answerElement(newAnswerId));
    setNewAnswerId(null);
  }, [answerElement, newAnswerId, scrollToElementTop]);

  const statusLabel = (() => {
    if (cancelling) return "正在取消";
    switch (agentStatusType) {
      case "AI_PLANNING":
        return "正在进行";
      case "AI_THINKING":
        return "正在分析问题";
      case "AI_EXECUTING":
        return "正在执行操作";
      default:
        return "正在处理";
    }
  })();

  const lastTurn = turns[turns.length - 1];
  const showFollowUps = !!onAskFollowUp && !!lastTurn && lastTurn.answers.length > 0 &&
    !displayAgentStatus && followUpPrompts.length > 0;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-paper">
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-8 sm:py-6"
      >
        <div className="mx-auto w-full max-w-4xl">
          {sessionId && runLoad === "error" && (
            <RunLoadNotice message={runError || "暂时无法读取执行记录"} onRetry={retryRuns} />
          )}
          {sessionId && runLoad === "ready" && runStale && (
            <RunLoadNotice message={runError || "网络或服务暂时不可用"} onRetry={retryRuns} stale />
          )}

          {turns.map((turn, turnIndex) => {
            const run = turn.run;
            const declaredRunId = messageRunId(turn.answers[0]) ?? messageRunId(turn.question);
            const answerlessRun = run && !run.answerMessageId && turn.answers.length === 0 ? run : undefined;
            const toolCalls = turn.traceMessages.flatMap((answer) => answer.metadata?.toolCalls ?? []);
            const toolResponses = turn.tools
              .map((message) => message.metadata?.toolResponse)
              .filter((response): response is ToolResponse => !!response);
            const busyRunStatus: RunStatus | null =
              run && (run.status === "QUEUED" || run.status === "RUNNING") ? run.status : null;
            const showProcess = !!run || toolCalls.length > 0 || toolResponses.length > 0;
            const runConfirmedMissing = !!sessionId && runLoad === "ready" && !runStale && !run;
            const missingAssociatedRun = !!sessionId && runLoad === "ready" && !runStale && !run && !!declaredRunId;

            return (
              <div key={turn.key} className="mb-6 min-w-0">
                {turn.systems.map((message) => (
                  <div key={message.id} className="mb-3 flex justify-center">
                    <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-card">
                      <RobotOutlined className="text-accent" />
                      <span className="break-words">{message.content}</span>
                    </div>
                  </div>
                ))}

                {turn.question && (
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-sm leading-6 text-white shadow-card sm:max-w-[75%]">
                      <span className="block min-w-0 break-words">{turn.question.content}</span>
                    </div>
                    {answerlessRun && (
                      <div className="w-full">
                        <RunOutcomeNotice
                          run={answerlessRun}
                          onRetry={onAskFollowUp && turn.question ? () => void onAskFollowUp(turn.question!.content) : undefined}
                        />
                      </div>
                    )}
                    {missingAssociatedRun && (
                      <p className="text-xs text-amber-700">未能读取这条问题对应的执行记录。</p>
                    )}
                  </div>
                )}

                {turn.answers.map((answer) => {
                  const citations = answer.metadata?.citations ?? [];
                  const answerRun = run;
                  const failedRun = answerRun && ["FAILED", "CANCELLED", "INTERRUPTED"].includes(
                    answerRun.interrupted ? "INTERRUPTED" : answerRun.status,
                  ) ? answerRun : undefined;
                  return (
                    <div key={answer.id} data-answer-id={answer.id} className="mt-3 min-w-0">
                      <article className="arch-card p-4 sm:p-5">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            {citations.length > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-verified-border bg-verified-soft px-2.5 py-0.5 font-semibold text-verified">
                                <CheckCircleOutlined />
                                来源已核验 · {citations.length} 处依据
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-semibold text-slate-600">
                                <RobotOutlined className="text-accent" />
                                问档答复
                              </span>
                            )}
                          </div>
                          {answerRun && (
                            <span className="font-mono text-[11px] text-slate-400">
                              耗时 {formatDuration(answerRun.durationMs)}
                            </span>
                          )}
                        </div>

                        <div className="w-full min-w-0 break-words [&_a]:break-all">
                          {answer.content && <AnswerBody messageId={answer.id} content={answer.content} />}
                          {citations.length > 0 && <CitationEntry citations={citations} onOpen={openCitation} />}
                          {failedRun && (() => {
                            const status = failedRun.interrupted ? "INTERRUPTED" : failedRun.status;
                            const failure = failureText(failedRun.errorCode, status);
                            return (
                              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/75 px-3 py-2.5 text-xs">
                                <p className="font-semibold leading-5 text-ink">{failure.title}</p>
                                <p className="mt-0.5 leading-5 text-slate-600">{failure.hint}</p>
                                {failure.retryable && onAskFollowUp && turn.question && (
                                  <Button
                                    size="small"
                                    className="mt-2"
                                    icon={<ReloadOutlined />}
                                    onClick={() => void onAskFollowUp(turn.question!.content)}
                                  >
                                    重新提问
                                  </Button>
                                )}
                              </div>
                            );
                          })()}
                          {runConfirmedMissing && !showProcess && (
                            <p className="mt-2 text-xs text-slate-400">这条历史消息没有执行记录</p>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}

                {showProcess && (
                  <div className="w-full min-w-0">
                    <ProcessDisclosure run={run} sessionId={sessionId} toolCalls={toolCalls} toolResponses={toolResponses} />
                  </div>
                )}

                {answerlessRun && busyRunStatus && !displayAgentStatus && (
                  <p className="mt-1.5 text-xs font-medium text-accent" role="status">
                    本轮仍在{RUN_STATUS_LABELS[busyRunStatus]}，刷新页面不会中断它。
                  </p>
                )}

                {turnIndex === turns.length - 1 && showFollowUps && (
                  <div className="mt-3 flex flex-wrap gap-2" aria-label="相关追问">
                    {followUpPrompts.slice(0, 2).map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={busy}
                        onClick={() => void onAskFollowUp?.(prompt)}
                        className="min-h-10 max-w-full cursor-pointer rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-2 text-left text-xs font-semibold text-slate-700 shadow-card transition-all duration-150 hover:-translate-y-px hover:border-accent hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        ↳ {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {displayAgentStatus && (
            <div className="mb-4" role="status" aria-live="polite">
              <div className="arch-card inline-flex max-w-full flex-wrap items-center gap-2.5 px-4 py-3 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  {statusLabel}
                </span>
                {agentStatusText && <span className="break-words text-xs text-slate-600">{agentStatusText}</span>}
                {waitStartedAt != null && <ElapsedWait key={waitStartedAt} startedAt={waitStartedAt} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {newAnswerId && (
        <button
          type="button"
          onClick={jumpToNewAnswer}
          className="absolute bottom-3 left-1/2 z-10 flex min-h-10 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-accent-border bg-white px-4 py-2 text-xs font-semibold text-accent shadow-card-hover transition-transform hover:-translate-y-0.5"
        >
          有新回答到达
          <DownOutlined />
        </button>
      )}

      {citedSource && (
        <DocumentPreviewDrawer
          document={{ id: citedSource.source.documentId, filename: citedSource.source.documentName }}
          citation={citedSource.source}
          onClose={closeCitation}
        />
      )}
    </div>
  );
};

export default AgentChatHistory;
