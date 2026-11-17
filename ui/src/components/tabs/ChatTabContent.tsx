import React, { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button, Popconfirm } from "antd";
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useChatSessions } from "../../hooks/useChatSessions.ts";
import { useAgents } from "../../hooks/useAgents.ts";
import { IS_PUBLIC_DEMO } from "../../config.ts";
import { showRequestError } from "../../api/http.ts";
import SessionAgentLabel from "../SessionAgentLabel.tsx";

const ChatTabContent: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { chatSessions, loading, deleteChatSession } = useChatSessions();
  const agentCatalog = useAgents();
  const { agents } = agentCatalog;

  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((agent) => {
      map.set(agent.id, agent.name);
    });
    return map;
  }, [agents]);

  const handleCreateNewChat = () => {
    navigate("/chat");
    onNavigate?.();
  };

  const handleSelectChatSession = (chatSessionId: string) => {
    navigate(`/chat/${chatSessionId}`);
    onNavigate?.();
  };

  const handleDeleteChatSession = async (chatSessionId: string) => {
    try {
      await deleteChatSession(chatSessionId);
      if (pathname === `/chat/${chatSessionId}`) navigate("/chat");
    } catch (error) {
      showRequestError(error, "删除会话失败，请重试");
    }
  };

  const getDisplayTitle = (session: { title?: string; agentId: string | null }) => {
    if (session.title) {
      return session.title;
    }
    const agentName = session.agentId ? agentMap.get(session.agentId) : undefined;
    return agentName ? `与 ${agentName} 的对话` : "新对话";
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={handleCreateNewChat}
        className="w-full"
      >
        发起新提问
      </Button>
      {IS_PUBLIC_DEMO && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11.5px] leading-5 text-slate-500">
          仅展示当前浏览器的个人体验记录（Cookie 隔离）。清除站点数据后不可找回。
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            加载中…
          </div>
        ) : chatSessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-4 text-xs leading-6 text-slate-500">
            还没有个人记录。在右侧点击推荐问题或直接提问后，你的会话会保存在这里。
          </div>
        ) : (
          <div className="space-y-1.5">
            {chatSessions.map((session) => {
              const active = pathname === `/chat/${session.id}`;
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectChatSession(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectChatSession(session.id);
                    }
                  }}
                  className={`group relative w-full cursor-pointer rounded-xl border px-3 py-2.5 transition-all duration-150 ${
                    active
                      ? "border-accent bg-accent-soft/70 shadow-card"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs ${
                        active
                          ? "border-accent-border bg-white text-accent"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      <MessageOutlined />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold leading-5 text-ink">
                        {getDisplayTitle(session)}
                      </div>
                      <SessionAgentLabel agentId={session.agentId} catalog={agentCatalog} compact className="mt-0.5 text-[11px]" />
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Popconfirm
                        title="确定要删除这条聊天记录吗？"
                        description="删除后将无法恢复"
                        onConfirm={() => handleDeleteChatSession(session.id)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          aria-label="删除聊天记录"
                          className="shrink-0 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                          danger
                        />
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatTabContent;
