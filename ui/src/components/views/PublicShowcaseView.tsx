import { useCallback, useEffect, useState } from "react";
import { Button, Empty, Spin, Typography } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import { getDemoShowcase, getDemoShowcases, type DemoShowcase } from "../../api/demo.ts";
import { createChatSession, type ChatSessionVO } from "../../api/api.ts";
import { showRequestError } from "../../api/http.ts";
import AgentChatHistory from "./agentChatView/AgentChatHistory.tsx";
import { useAgents } from "../../hooks/useAgents.ts";
import { useChatSessions } from "../../hooks/useChatSessions.ts";
import SessionAgentLabel, { type SessionAgentCatalog } from "../SessionAgentLabel.tsx";

const { Title, Paragraph } = Typography;

function ShowcaseList({ agentCatalog }: { agentCatalog: SessionAgentCatalog }) {
  const navigate = useNavigate();
  const [showcases, setShowcases] = useState<ChatSessionVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getDemoShowcases().then((response) => {
      if (active) setShowcases(response.showcases);
    }).catch((error) => {
      if (active) {
        setFailed(true);
        showRequestError(error, "示例对话加载失败");
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-paper p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-slate-200 pb-5">
          <Title level={2} className="mb-2! tracking-tight text-ink!">
            精选问答示例
          </Title>
          <Paragraph className="mb-1! max-w-2xl text-sm leading-6 text-ink-soft">
            以下问答均基于公开资料真实执行，未经手动改写，已核对原文引用。点击条目可直接查看完整回答、工具调用与原文行号。
          </Paragraph>
          <p className="text-xs text-ink-muted">
            这里展示全局公开精选；你自己在体验台发起的提问保存在「我的记录」中。
          </p>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Spin tip="正在加载示例对话…"><div className="h-12" /></Spin>
          </div>
        ) : showcases.length === 0 ? (
          <div className="py-16">
            <Empty description={failed ? "示例对话暂时无法加载" : "暂无示例对话"}>
              <Button type="primary" onClick={() => navigate("/chat")}>开始自己的体验</Button>
            </Empty>
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {showcases.map((showcase) => (
              <button
                key={showcase.id}
                type="button"
                className="group arch-card arch-card-interactive flex cursor-pointer flex-col justify-between gap-3 p-4 text-left"
                onClick={() => navigate(`/showcase/${showcase.id}`)}
              >
                <span className="block min-w-0">
                  <span className="block line-clamp-2 text-[14.5px] font-semibold leading-5 text-ink transition-colors group-hover:text-accent">
                    {showcase.title || "示例对话"}
                  </span>
                  <span className="mt-2 block">
                    <SessionAgentLabel agentId={showcase.agentId} catalog={agentCatalog} compact className="text-xs" />
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                  查看原文依据与执行记录
                  <ArrowRightOutlined className="text-[11px] transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ShowcaseDetail({ id, agentCatalog }: { id: string; agentCatalog: SessionAgentCatalog }) {
  const navigate = useNavigate();
  const { refreshChatSessions } = useChatSessions();
  const [showcase, setShowcase] = useState<DemoShowcase | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let active = true;
    void getDemoShowcase(id).then((response) => {
      if (active) setShowcase(response);
    }).catch((error) => {
      if (active) showRequestError(error, "示例对话加载失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const firstQuestion = showcase?.chatMessages.find((message) => message.role === "user")?.content;

  const startOwnRun = useCallback(async () => {
    const agentId = showcase?.agentId ?? agentCatalog.agents[0]?.id;
    if (!agentId || !firstQuestion || starting) return;
    setStarting(true);
    try {
      const created = await createChatSession({ agentId, title: firstQuestion.slice(0, 40) });
      navigate(`/chat/${created.chatSessionId}`, {
        state: { initialMessage: { content: firstQuestion, agentId } },
      });
      void refreshChatSessions().catch((error) => showRequestError(error, "聊天记录刷新失败"));
    } catch (error) {
      showRequestError(error, "创建聊天会话失败，请重试");
    } finally {
      setStarting(false);
    }
  }, [agentCatalog.agents, firstQuestion, navigate, refreshChatSessions, showcase?.agentId, starting]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-paper">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate("/showcase")}>
              全部示例对话
            </Button>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
              只读实录
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-base font-bold text-ink">
              {showcase?.title || "示例对话"}
            </span>
          </div>
          {showcase && <SessionAgentLabel agentId={showcase.agentId} catalog={agentCatalog} className="mt-1 text-xs" />}
          <p className="mt-1 text-xs text-ink-muted">
            这是只读示例：可展开查看来源依据并打开原文高亮；点击底部按钮可使用同一问题开启你自己的实时运行。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center"><Spin /></div>
      ) : showcase ? (
        <AgentChatHistory messages={showcase.chatMessages} autoScroll={false} />
      ) : (
        <div className="flex flex-1 items-center justify-center"><Empty description="示例对话不存在或尚未公开" /></div>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-slate-200 bg-white px-4 py-3.5">
        <span className="text-xs text-ink-soft">用同一个问题发起你自己的实时对话，会新建一条个人可追踪运行：</span>
        <Button
          type="primary"
          icon={<MessageOutlined />}
          loading={starting}
          disabled={!firstQuestion}
          onClick={() => void startOwnRun()}
        >
          亲自试一试
        </Button>
      </div>
    </div>
  );
}

export default function PublicShowcaseView() {
  const { showcaseId } = useParams<{ showcaseId: string }>();
  const agentCatalog = useAgents();
  return showcaseId
    ? <ShowcaseDetail key={showcaseId} id={showcaseId} agentCatalog={agentCatalog} />
    : <ShowcaseList agentCatalog={agentCatalog} />;
}
