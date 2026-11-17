import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Alert, Button } from "antd";
import {
  ArrowRightOutlined,
  BookOutlined,
  HistoryOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import NativeComposer from "./NativeComposer.tsx";
import { useLocation, useNavigate } from "react-router-dom";
import { type AgentVO, createChatSession } from "../../../api/api.ts";
import { useChatSessions } from "../../../hooks/useChatSessions.ts";
import { DEMO_PROMPTS, IS_PUBLIC_DEMO } from "../../../config.ts";
import { showRequestError } from "../../../api/http.ts";

const AgentPicker = lazy(() => import("./AgentPicker.tsx"));

interface EmptyAgentChatViewProps {
  agents: AgentVO[];
  loadingAgents?: boolean;
  agentsFailed?: boolean;
  onRetryAgents?: () => void;
}

interface PipelineStage {
  id: string;
  label: string;
  detail: string;
}

const PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    id: "enqueue",
    label: "事务入队",
    detail: "消息、参数快照与运行任务同事务落库；重复点击按幂等键返回既有运行。",
  },
  {
    id: "worker",
    label: "租约领取",
    detail: "Worker 通过 SKIP LOCKED 领取任务并独立续租，消息及终态写回前核验租约与取消状态。",
  },
  {
    id: "runtime",
    label: "显式调度",
    detail: "接管 Spring AI 工具调用循环，在单次上限 20 步与只读工具白名单内受控推进。",
  },
  {
    id: "source",
    label: "原文摘录",
    detail: "模型提交检索到的 citationId 与行号锚点，服务端摘录连续原文并计算 SHA-256 供前端核对。",
  },
];

export default function EmptyAgentChatView({
  agents,
  loadingAgents,
  agentsFailed,
  onRetryAgents,
}: EmptyAgentChatViewProps) {
  const { state } = useLocation();
  const [message, setMessage] = useState(() =>
    typeof state?.suggestedPrompt === "string" ? state.suggestedPrompt : "",
  );
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    typeof state?.selectedAgentId === "string" ? state.selectedAgentId : null,
  );
  const [activeStageId, setActiveStageId] = useState<string>("source");
  const navigate = useNavigate();
  const { chatSessions, refreshChatSessions } = useChatSessions();

  const effectiveAgentId = useMemo(() => {
    return agents.find((agent) => agent.id === selectedAgentId)?.id ?? agents[0]?.id ?? null;
  }, [selectedAgentId, agents]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === effectiveAgentId) ?? null,
    [agents, effectiveAgentId],
  );

  const agentReady = !!effectiveAgentId;
  const busy = pendingPrompt !== null;
  const startingRef = useRef(false);

  /**
   * 首页唯一的发送入口：创建会话 → 把问题作为首条发送意图交给聊天页。
   */
  const startQuestion = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !effectiveAgentId || startingRef.current) return;
    startingRef.current = true;
    setPendingPrompt(trimmed);
    try {
      const response = await createChatSession({
        agentId: effectiveAgentId,
        title: trimmed.slice(0, 40),
      });
      navigate(`/chat/${response.chatSessionId}`, {
        state: { initialMessage: { content: trimmed, agentId: effectiveAgentId } },
      });
      void refreshChatSessions().catch((error) => showRequestError(error, "聊天记录刷新失败"));
    } catch (error) {
      showRequestError(error, "创建聊天会话失败，请重试");
    } finally {
      startingRef.current = false;
      setPendingPrompt(null);
    }
  }, [effectiveAgentId, navigate, refreshChatSessions]);

  const activeStage = PIPELINE_STAGES.find((stage) => stage.id === activeStageId) ?? PIPELINE_STAGES[3];
  const publicBlockedReason = loadingAgents
    ? "正在连接公开资料助手…"
    : agentsFailed || !agentReady
      ? "暂时无法连接公开资料助手，请重试后再提问。"
      : "";
  const accountBlockedReason = loadingAgents
    ? "正在加载智能体助手…"
    : agentsFailed
      ? "智能体助手列表加载失败，请重试。"
      : !agentReady
        ? "当前暂无可用智能体助手，请先在左侧侧栏新建智能体。"
        : "";

  if (!IS_PUBLIC_DEMO) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper">
        <div className="flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b border-sketch bg-white px-4 py-2 sm:px-8">
          <Suspense fallback={<span className="text-sm text-slate-500">正在准备助手选择…</span>}>
            <AgentPicker agents={agents} value={effectiveAgentId ?? ""} loading={!!loadingAgents} onChange={setSelectedAgentId} />
          </Suspense>
          <span className="flex-1" />
          <Button size="small" icon={<BookOutlined />} onClick={() => navigate("/knowledge-base")}>
            管理知识库
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
          <div className="mx-auto w-full max-w-2xl">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[26px]">
                {selectedAgent ? selectedAgent.name : "开始新对话"}
              </h1>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                {selectedAgent?.description || "选择助手，检索已授权知识库并核对执行过程与原文依据。"}
              </p>
            </div>

            {accountBlockedReason && (
              <Alert
                className="mt-5"
                type={loadingAgents ? "info" : "warning"}
                showIcon
                title={accountBlockedReason}
                action={!loadingAgents && agentsFailed && onRetryAgents ? (
                  <Button size="small" icon={<ReloadOutlined />} onClick={onRetryAgents}>重试</Button>
                ) : undefined}
              />
            )}

            <div className="arch-card mt-6 grid gap-4 p-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-ink-muted">当前助手</div>
                <div className="mt-1 truncate text-sm font-semibold text-ink">
                  {selectedAgent ? selectedAgent.name : "未选择"}
                </div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">已关联知识库</div>
                <div className="mt-1 font-mono text-sm font-semibold text-ink">
                  {selectedAgent?.allowedKbs?.length ?? 0} 个
                </div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">可用扩展工具</div>
                <div className="mt-1 font-mono text-sm font-semibold text-ink">
                  {selectedAgent?.allowedTools?.length ?? 0} 项
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="shrink-0 border-t border-sketch bg-white"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto w-full max-w-2xl px-4 pt-3 sm:px-8">
            <NativeComposer
              value={message}
              onChange={setMessage}
              onSubmit={(value) => { void startQuestion(value); }}
              loading={busy}
              disabled={!agentReady}
              sendLabel="发送问题"
              placeholder={loadingAgents ? "正在连接助手…" : agentReady ? "输入你的问题…" : "助手暂时不可用"}
            />
            <p className="mt-1.5 text-center text-xs text-slate-400">
              Enter 发送，Shift + Enter 换行。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const [primary, ...secondary] = DEMO_PROMPTS;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[41%_59%] lg:overflow-hidden">
      {/* 左栏：工程概览（桌面左侧 41%，移动端位于提问区下方） */}
      <section
        aria-label="工程机制与实证"
        className="order-2 flex flex-col justify-between border-t border-slate-200 bg-paper px-5 py-6 sm:px-8 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-r lg:py-7"
      >
        <div className="mx-auto w-full max-w-xl lg:mx-0 lg:max-w-none">
          <h1 className="text-2xl font-bold leading-snug tracking-tight text-ink sm:text-[26px]">
            可核验出处的文档问答
          </h1>

          <p className="mt-2.5 text-[13.5px] leading-6 text-ink-soft">
            基于开源 JChatMind 持续演进。通过 PostgreSQL 持久化任务队列、租约控制与{" "}
            <code className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-xs font-medium text-ink">
              sourceAnswer
            </code>{" "}
            服务端原文摘录，回答中的引用可直接定位至文档原始行号与 SHA-256 指纹。
          </p>

          <p className="mt-3 text-xs text-ink-muted">
            Java 21, Spring Boot 3.5.8, Spring AI 1.1.0, PostgreSQL 17 (pgvector)
          </p>

          {/* 执行链路切换 */}
          <div className="arch-card mt-5 overflow-hidden">
            <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50/80 sm:grid-cols-4">
              {PIPELINE_STAGES.map((stage) => {
                const active = stage.id === activeStage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setActiveStageId(stage.id)}
                    aria-pressed={active}
                    className={`cursor-pointer border-b-2 px-2.5 py-2.5 text-center text-xs transition-colors ${
                      active
                        ? "border-accent bg-white font-semibold text-ink"
                        : "border-transparent font-medium text-slate-500 hover:bg-white/60 hover:text-ink"
                    }`}
                  >
                    {stage.label}
                  </button>
                );
              })}
            </div>
            <p className="px-3.5 py-3 text-xs leading-5 text-ink-soft">
              {activeStage.detail}
            </p>
          </div>

          {/* 50 题检索对比表 */}
          <div className="arch-card mt-3.5 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-ink">
                检索评测对照
              </span>
              <span className="text-xs text-ink-muted">
                50 题冻结集（40 题含答案）
              </span>
            </div>

            <div className="mt-2.5 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-sketch text-xs font-medium text-ink-muted">
                    <th className="py-1.5 pr-2 font-medium">索引策略</th>
                    <th className="py-1.5 px-2 text-right font-medium">Hit@1</th>
                    <th className="py-1.5 px-2 text-right font-medium">Hit@3</th>
                    <th className="py-1.5 pl-2 text-right font-medium">MRR@3</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sketch">
                  <tr className="text-ink-soft">
                    <td className="py-2 pr-2">仅标题向量（基线）</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums">0.650</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums">0.850</td>
                    <td className="py-2 pl-2 text-right font-mono tabular-nums">0.738</td>
                  </tr>
                  <tr className="font-semibold text-ink">
                    <td className="py-2 pr-2 text-accent">正文窗口分块（当前）</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-verified">0.875</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums">1.000</td>
                    <td className="py-2 pl-2 text-right font-mono tabular-nums">0.933</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-xs leading-5 text-ink-muted">
              基于 4 份公开冻结文档与 BGE-M3（1024 维）按 body-window-v2 口径重算
            </p>
          </div>
        </div>

        <div className="mx-auto mt-5 flex w-full max-w-xl flex-wrap items-center justify-between gap-2 border-t border-sketch pt-3 text-xs text-ink-muted lg:mx-0 lg:max-w-none">
          <span>保留上游 JChatMind MIT 许可，区分继承与本仓库新增能力</span>
          <span>Markdown, BGE-M3</span>
        </div>
      </section>

      {/* 右栏：文档检索问答工作区 */}
      <section
        aria-label="文档检索问答"
        className="order-1 flex flex-col justify-between bg-white lg:order-2 lg:min-h-0"
      >
        <div className="px-5 py-5 sm:px-8 sm:py-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="text-base font-bold tracking-tight text-ink sm:text-[17px]">
                    文档检索问答
                  </h2>
                  <span className="text-xs text-slate-500">
                    助手：{loadingAgents ? "连接中…" : selectedAgent?.name ?? "公开资料助手"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  已挂载：v10 项目资料（3 篇 / 40 片段）、高频技术整理（10 篇 / 100 题）
                </p>
              </div>

              {chatSessions.length > 0 && (
                <Button
                  size="small"
                  icon={<HistoryOutlined />}
                  onClick={() => navigate(`/chat/${chatSessions[0].id}`)}
                >
                  继续最近对话 ({chatSessions.length})
                </Button>
              )}
            </div>

            {publicBlockedReason && (
              <Alert
                className="mt-4"
                type={loadingAgents ? "info" : "warning"}
                showIcon
                title={publicBlockedReason}
                action={!loadingAgents && onRetryAgents ? (
                  <Button size="small" icon={<ReloadOutlined />} onClick={onRetryAgents}>
                    重试
                  </Button>
                ) : undefined}
              />
            )}

            <div className="mt-5">
              <p className="mb-2.5 text-xs font-semibold text-slate-500">
                从示例问题开始
              </p>

              {/* 主推荐问题 */}
              <button
                type="button"
                onClick={() => void startQuestion(primary.prompt)}
                disabled={!agentReady || busy}
                aria-label={`直接发送推荐问题：${primary.title}`}
                className="group arch-card-featured flex min-h-15 w-full cursor-pointer flex-col items-start gap-2.5 px-4 py-3.5 text-left sm:flex-row sm:items-center sm:gap-4 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink sm:text-[15px]">
                    {primary.title}：产品导览与原文交付机制
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-soft">
                    {pendingPrompt === primary.prompt
                      ? "正在创建会话并连接运行…"
                      : `${primary.description}，引用条目支持定位至文档行号`}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 self-end text-xs font-semibold text-accent sm:self-center">
                  <span>{pendingPrompt === primary.prompt ? "发送中" : "提问"}</span>
                  <ArrowRightOutlined className="text-[11px] transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
              </button>

              {/* 次要示例问题 */}
              <div className="mt-2.5 grid gap-2.5">
                {secondary.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => void startQuestion(item.prompt)}
                    disabled={!agentReady || busy}
                    aria-label={`直接发送推荐问题：${item.title}`}
                    className="group arch-card arch-card-interactive flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-soft">
                        {pendingPrompt === item.prompt ? "正在打开会话并发送…" : item.description}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">
                      <span>{pendingPrompt === item.prompt ? "发送中" : "提问"}</span>
                      <ArrowRightOutlined className="text-[11px] transition-transform duration-150 group-hover:translate-x-0.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 实录与资料库快捷入口 */}
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-3.5 text-xs">
              <span className="text-slate-400">或先查看既有存档：</span>
              <button
                type="button"
                onClick={() => navigate("/showcase")}
                className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink transition-colors hover:text-accent"
              >
                <HistoryOutlined className="text-slate-400" />
                <span>精选问答实录</span>
                <ArrowRightOutlined className="text-[10px]" />
              </button>
              <button
                type="button"
                onClick={() => navigate("/knowledge-base")}
                className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink transition-colors hover:text-accent"
              >
                <BookOutlined className="text-slate-400" />
                <span>公开资料库原文</span>
                <ArrowRightOutlined className="text-[10px]" />
              </button>
            </div>
          </div>
        </div>

        {/* 底部原生输入框 */}
        <div
          className="shrink-0 border-t border-slate-200 bg-slate-50/75 px-5 pt-3.5 sm:px-8"
          style={{ paddingBottom: "max(0.9rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto w-full max-w-2xl">
            <NativeComposer
              value={message}
              onChange={setMessage}
              onSubmit={(value) => { void startQuestion(value); }}
              loading={busy}
              disabled={!agentReady}
              sendLabel="发送问题"
              placeholder={
                loadingAgents
                  ? "正在连接助手…"
                  : agentReady
                    ? "输入你想验证的问题…"
                    : "助手暂时不可用"
              }
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>Enter 发送，Shift + Enter 换行</span>
              <span>公开演示仅限只读资料，会话保存在当前浏览器</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
