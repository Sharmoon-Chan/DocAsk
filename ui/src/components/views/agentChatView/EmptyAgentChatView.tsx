import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Alert, Button } from "antd";
import {
  ArrowRightOutlined,
  BookOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import NativeComposer from "./NativeComposer.tsx";
import { useLocation, useNavigate } from "react-router-dom";
import { type AgentVO, createChatSession } from "../../../api/api.ts";
import { getAgentEmoji } from "../../../utils";
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
  step: string;
  label: string;
  sub: string;
  detail: string;
  tone: "default" | "accent" | "verified";
}

const PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    id: "enqueue",
    step: "01",
    label: "幂等入队",
    sub: "PG 同事务",
    detail: "RunSubmissionService 将用户消息、固定快照与任务同事务落库，同幂等键重试不重复创建运行。",
    tone: "default",
  },
  {
    id: "worker",
    step: "02",
    label: "SKIP LOCKED",
    sub: "租约心跳",
    detail: "RunWorker 领取队列任务并独立续租；普通消息与终态写入前后均核验取消标记与 fencing 租约。",
    tone: "default",
  },
  {
    id: "runtime",
    step: "03",
    label: "Think-Execute",
    sub: "手动接管",
    detail: "关闭 Spring AI 内部自动工具循环，显式控制最多 20 步状态机与公开四工具白名单边界。",
    tone: "accent",
  },
  {
    id: "source",
    step: "04",
    label: "sourceAnswer",
    sub: "原文与核验",
    detail: "模型仅提交本轮真实检索 citationId 与连续锚点，服务端摘录完整原文并支持浏览器 SHA-256 定位。",
    tone: "verified",
  },
];

const TECH_STACK = [
  "Java 21",
  "Spring Boot 3.5.8",
  "Spring AI 1.1.0",
  "PostgreSQL 17 + pgvector",
  "React 19 + TS",
] as const;

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
        <div className="flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white/85 px-4 py-2 backdrop-blur-sm sm:px-8">
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
            <div className="animate-pop-in">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">
                <RobotOutlined /> 账号工作区 · 私有隔离空间
              </span>
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                {selectedAgent ? `与「${selectedAgent.name}」开始对话` : "开始新的对话"}
              </h1>
              <p className="mt-2 text-sm leading-6 text-ink-soft sm:text-base">
                {selectedAgent?.description || "选择智能体助手，检索你授权的知识库并查看真实执行轨迹与原文依据。"}
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

            <div className="arch-card mt-6 grid gap-3 p-5 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold text-ink-muted">当前助手</div>
                <div className="mt-1 truncate text-sm font-bold text-ink">
                  {selectedAgent ? `${getAgentEmoji(selectedAgent.id)} ${selectedAgent.name}` : "未选择"}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-ink-muted">已关联知识库</div>
                <div className="mt-1 font-mono text-sm font-bold text-accent">
                  {selectedAgent?.allowedKbs?.length ?? 0} 个知识库
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-ink-muted">可选扩展工具</div>
                <div className="mt-1 font-mono text-sm font-bold text-ink">
                  {selectedAgent?.allowedTools?.length ?? 0} 项工具
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="shrink-0 border-t border-slate-200 bg-white/90 backdrop-blur-sm"
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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[44%_56%] lg:overflow-hidden">
      {/* 左栏：工程实证档案（桌面左侧 44%，移动端折叠于体验区下方） */}
      <section
        aria-label="工程实证档案"
        className="order-2 flex flex-col justify-between border-t border-slate-200 bg-paper px-5 py-6 sm:px-8 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-r lg:py-7"
      >
        <div className="mx-auto w-full max-w-xl lg:mx-0 lg:max-w-none">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-soft px-2.5 py-1 text-[11px] font-bold tracking-wider text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-verified" />
            <span>PORTFOLIO SHOWCASE · 工程实证档案</span>
          </div>

          <h1 className="mt-3.5 text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-[30px] sm:leading-[1.2]">
            不交未检索的猜测，
            <br />
            只交可定位行号的原文。
          </h1>

          <p className="mt-3 text-[13.5px] leading-6 text-ink-soft">
            问档 DocAsk 基于开源 JChatMind 持续演进。关闭框架内部自动工具循环，自研 PostgreSQL 持久化执行队列、租约 fencing 防写回守卫与{" "}
            <code className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-ink">
              sourceAnswer
            </code>{" "}
            服务端原文摘录通道——回答可下钻至源码行号与 SHA-256 指纹核对。
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {TECH_STACK.map((item) => (
              <span
                key={item}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-pencil shadow-card"
              >
                {item}
              </span>
            ))}
          </div>

          {/* 交互式运行时链路图 */}
          <div className="arch-card mt-5 p-4">
            <div className="mb-2.5 flex items-center justify-between gap-2 text-[11px] font-bold tracking-wide text-slate-500">
              <span>核心运行时链路（点击节点查看实现机制）</span>
              <span className="font-mono text-accent">MAX_STEPS = 20</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {PIPELINE_STAGES.map((stage) => {
                const active = stage.id === activeStage.id;
                const toneClasses = active
                  ? stage.tone === "verified"
                    ? "border-verified bg-verified-soft text-ink"
                    : "border-accent bg-accent-soft text-ink"
                  : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white";
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setActiveStageId(stage.id)}
                    aria-pressed={active}
                    className={`cursor-pointer rounded-lg border px-2.5 py-2 text-left transition-all ${toneClasses}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold text-slate-400">{stage.step}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                    </div>
                    <div className="mt-0.5 truncate text-xs font-bold text-ink">{stage.label}</div>
                    <div className="truncate font-mono text-[10.5px] text-slate-500">{stage.sub}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-ink-soft">
              <span className="font-mono font-bold text-accent">{activeStage.label}：</span>
              {activeStage.detail}
            </p>
          </div>

          {/* 50 题检索评测对比卡 */}
          <div className="arch-card mt-3.5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold tracking-wide text-slate-500">
                50 题冻结评测集检索对比
              </span>
              <span className="rounded-full border border-verified-border bg-verified-soft px-2 py-0.5 font-mono text-[11px] font-bold text-verified">
                Hit@3 = 1.000 · MRR@3 = 0.933
              </span>
            </div>

            <div className="mt-3 space-y-2.5">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>上游基线：仅章节标题向量 (Hit@1)</span>
                  <span className="font-mono font-semibold text-slate-500">0.650 (26/40)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-[65%] rounded-full bg-slate-400" />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-verified">
                  <span>本仓库：正文窗口分块 body-window-v2 (Hit@1)</span>
                  <span className="font-mono font-bold">0.875 (+22.5pp)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-verified-soft">
                  <div className="h-full w-[87.5%] rounded-full bg-verified" />
                </div>
              </div>
            </div>

            <p className="mt-2.5 text-[11px] leading-5 text-slate-400">
              语料 4 份 / BGE-M3 1024 维 · 单元测试 473 项（469 通过 + 4 既有跳过）与真实 PostgreSQL 70 项集成验证
            </p>
          </div>
        </div>

        <div className="mx-auto mt-5 flex w-full max-w-xl flex-wrap items-center justify-between gap-2 border-t border-dashed border-slate-300 pt-3 text-[11px] text-slate-400 lg:mx-0 lg:max-w-none">
          <span>保留上游 JChatMind MIT 许可，明确区分继承与本仓库新增能力</span>
          <span className="font-mono">Markdown · BGE-M3</span>
        </div>
      </section>

      {/* 右栏：实时验证工作台（桌面右侧 56%，移动端首屏优先呈现） */}
      <section
        aria-label="实时验证工作台"
        className="order-1 flex flex-col justify-between bg-white lg:order-2 lg:min-h-0"
      >
        <div className="px-5 py-5 sm:px-8 sm:py-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-extrabold tracking-tight text-ink sm:text-lg">
                    实时验证工作台 · 免登录直连后端
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full border border-verified-border bg-verified-soft px-2 py-0.5 text-[11px] font-semibold text-verified">
                    <span className="h-1.5 w-1.5 rounded-full bg-verified" />
                    {loadingAgents
                      ? "连接中…"
                      : selectedAgent?.name ?? "公开资料助手"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  已挂载：v10 项目资料（3 篇 / 40 片段）+ 高频八股整理（10 篇 / 100 题）
                </p>
              </div>

              {chatSessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => navigate(`/chat/${chatSessions[0].id}`)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-teal-100/70"
                >
                  <HistoryOutlined />
                  继续最近对话 ({chatSessions.length})
                </button>
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
              <div className="mb-2.5 flex items-center justify-between text-xs font-bold tracking-wide text-slate-500">
                <span>面试官一键体验（真实触发后端检索与 SSE 运行）</span>
                <span className="hidden font-mono text-[11px] text-slate-400 sm:inline">
                  真实提问 · 非静态假数据
                </span>
              </div>

              {/* 主推荐规格卡 SPEC-01 */}
              <button
                type="button"
                onClick={() => void startQuestion(primary.prompt)}
                disabled={!agentReady || busy}
                aria-label={`直接发送推荐问题：${primary.title}`}
                className="group arch-card-featured flex min-h-16 w-full cursor-pointer flex-col items-start gap-3 px-4 py-3.5 text-left sm:flex-row sm:items-center sm:gap-3.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex w-full min-w-0 flex-1 items-start gap-3 sm:items-center">
                  <span className="mt-0.5 shrink-0 rounded-md bg-accent px-2 py-1 font-mono text-[11px] font-bold text-white sm:mt-0">
                    SPEC-01
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ink sm:text-[15.5px]">
                      {primary.title}：产品导览、原文交付与核心闭环
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-ink-soft">
                      {pendingPrompt === primary.prompt
                        ? "正在创建会话并连接 SSE…"
                        : `${primary.description}，点击引用可定位至文档原始行号`}
                    </span>
                  </span>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 self-end rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition-colors group-hover:bg-accent sm:self-center">
                  <span>{pendingPrompt === primary.prompt ? "发送中" : "直接运行"}</span>
                  <ArrowRightOutlined className="text-[11px] transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
              </button>

              {/* 次要规格卡 SPEC-02 / SPEC-03 */}
              <div className="mt-2.5 grid gap-2.5">
                {secondary.map((item, index) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => void startQuestion(item.prompt)}
                    disabled={!agentReady || busy}
                    aria-label={`直接发送推荐问题：${item.title}`}
                    className="group arch-card arch-card-interactive flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-bold text-slate-600">
                      SPEC-0{index + 2}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-soft">
                        {pendingPrompt === item.prompt ? "正在打开会话并发送…" : item.description}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">
                      <span>{pendingPrompt === item.prompt ? "发送中" : "运行"}</span>
                      <ArrowRightOutlined className="text-[11px] transition-transform duration-150 group-hover:translate-x-0.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 精选问答 & 公开资料直达带 */}
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50/75 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-ink">
                  <CheckCircleOutlined className="text-verified" />
                  <span>不想等待模型推理？可直接核对已保存的真实运行实录与原文档</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => navigate("/showcase")}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-card transition-colors hover:border-accent hover:text-accent"
                >
                  <HistoryOutlined /> 查看精选真实问答
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/knowledge-base")}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-card transition-colors hover:border-accent hover:text-accent"
                >
                  <BookOutlined /> 浏览公开资料库原文
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 底部原生输入框 */}
        <div
          className="shrink-0 border-t border-slate-200 bg-slate-50/85 px-5 pt-3.5 sm:px-8"
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Enter 发送 · Shift + Enter 换行 · 工具调用与运行时耗时全程可展开核查</span>
              <span>公开演示仅限白名单资料 · 历史保存于浏览器 Cookie</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
