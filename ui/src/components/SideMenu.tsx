import React, { lazy, Suspense, useState } from "react";
import {
  HistoryOutlined,
  LoginOutlined,
  TeamOutlined,
  SlidersOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { Button, Tabs, type TabsProps } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import AgentTabContent from "./tabs/AgentTabContent.tsx";
import ChatTabContent from "./tabs/ChatTabContent.tsx";
import KnowledgeBaseTabContent from "./tabs/KnowledgeBaseTabContent.tsx";
import { useAgents } from "../hooks/useAgents.ts";
import { useKnowledgeBases } from "../hooks/useKnowledgeBases.ts";
import { IS_PUBLIC_DEMO } from "../config.ts";
import ExoBrainLogo from "./ExoBrainLogo.tsx";
import { useAccount } from "../contexts/accountState.ts";
import AccountMenu from "./AccountMenu.tsx";
import type { AgentVO } from "../api/api.ts";

const AddAgentModal = lazy(() => import("./modals/AddAgentModal.tsx"));
const AddKnowledgeBaseModal = lazy(() => import("./modals/AddKnowledgeBaseModal.tsx"));

export type SideMenuTab = "agent" | "chat" | "knowledgeBase";

interface SideMenuProps {
  onNavigate?: () => void;
  onClosePanel?: () => void;
  preferredTab?: SideMenuTab | null;
}

const SideMenu: React.FC<SideMenuProps> = ({ onNavigate, onClosePanel, preferredTab = null }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const account = useAccount();

  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentVO | null>(null);
  const toggleAddAgentModal = () => {
    setIsAddAgentModalOpen((prev) => !prev);
    setEditingAgent(null);
  };

  const [isAddKnowledgeBaseModalOpen, setIsAddKnowledgeBaseModalOpen] = useState(false);
  const toggleAddKnowledgeBaseModal = () => {
    setIsAddKnowledgeBaseModalOpen((prev) => !prev);
  };

  const { agents, createAgentHandle, deleteAgentHandle, updateAgentHandle } = useAgents();
  const { knowledgeBases, createKnowledgeBaseHandle } = useKnowledgeBases();

  const [selectedTab, setSelectedTab] = useState<{ path: string; key: string } | null>(null);
  const routeTab = (() => {
    if (location.pathname.startsWith("/agent")) return "agent";
    if (location.pathname.startsWith("/knowledge-base")) return "knowledgeBase";
    if (location.pathname.startsWith("/chat")) return "chat";
    return IS_PUBLIC_DEMO ? "chat" : "agent";
  })();
  const activeKey = selectedTab?.path === location.pathname
    ? selectedTab.key
    : preferredTab ?? routeTab;

  const goTo = (path: string, state?: Record<string, string>) => {
    navigate(path, { state });
    onNavigate?.();
  };

  const handleTabChange = (key: string) => {
    setSelectedTab({ path: location.pathname, key });
  };

  const items: TabsProps["items"] = [
    {
      key: "chat",
      label: <span className="select-none">{IS_PUBLIC_DEMO ? "我的记录" : "聊天记录"}</span>,
      children: <ChatTabContent onNavigate={onNavigate} />,
    },
    {
      key: "agent",
      label: <span className="select-none">{IS_PUBLIC_DEMO ? "助手" : "智能体助手"}</span>,
      children: (
        <AgentTabContent
          agents={agents}
          onSelectAgent={(agentId) => goTo("/chat", { selectedAgentId: agentId })}
          onCreateAgentClick={IS_PUBLIC_DEMO ? undefined : toggleAddAgentModal}
          onEditAgent={IS_PUBLIC_DEMO ? undefined : (agent) => {
            setEditingAgent(agent);
            setIsAddAgentModalOpen(true);
          }}
          onDeleteAgent={IS_PUBLIC_DEMO ? undefined : deleteAgentHandle}
        />
      ),
    },
    {
      key: "knowledgeBase",
      label: <span className="select-none">{IS_PUBLIC_DEMO ? "公开资料" : "知识库"}</span>,
      children: (
        <KnowledgeBaseTabContent
          knowledgeBases={knowledgeBases}
          onCreateKnowledgeBaseClick={IS_PUBLIC_DEMO ? undefined : toggleAddKnowledgeBaseModal}
          onSelectKnowledgeBase={(knowledgeBaseId) => {
            goTo(`/knowledge-base/${knowledgeBaseId}`);
          }}
        />
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col bg-white px-3.5">
      <div className="flex h-13 shrink-0 items-center justify-between border-b border-slate-200">
        <button
          type="button"
          onClick={() => goTo("/")}
          className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg text-left"
          aria-label="问档 DocAsk 首页"
        >
          <ExoBrainLogo className="h-7 w-7" />
          <span className="truncate text-sm font-bold tracking-tight text-ink">
            {IS_PUBLIC_DEMO ? "工作区记录与资料" : "问档 DocAsk"}
          </span>
        </button>
        {onClosePanel && (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label="收起侧栏"
            onClick={onClosePanel}
            className="text-slate-400 hover:text-ink"
          />
        )}
      </div>

      {IS_PUBLIC_DEMO && (
        <Button
          className="mt-3 shrink-0"
          icon={<HistoryOutlined />}
          onClick={() => goTo("/showcase")}
        >
          示例对话
        </Button>
      )}

      {!IS_PUBLIC_DEMO && account?.user?.role === "ADMIN" && (
        <div className="mt-3 grid shrink-0 grid-cols-2 gap-2">
          <Button
            type={location.pathname === "/users" ? "primary" : "default"}
            icon={<TeamOutlined />}
            onClick={() => goTo("/users")}
          >
            用户管理
          </Button>
          <Button
            type={location.pathname === "/models" ? "primary" : "default"}
            icon={<SlidersOutlined />}
            onClick={() => goTo("/models")}
          >
            系统模型
          </Button>
        </div>
      )}

      <div className="mt-1 flex min-h-0 flex-1 flex-col">
        <Tabs
          activeKey={activeKey}
          onChange={handleTabChange}
          items={items}
          size="small"
        />
      </div>

      {IS_PUBLIC_DEMO ? (
        <div className="shrink-0 border-t border-slate-200 py-3">
          <Button block href="/admin/" icon={<LoginOutlined />}>
            账号登录 (/admin/)
          </Button>
        </div>
      ) : (
        <AccountMenu />
      )}

      {!IS_PUBLIC_DEMO && isAddAgentModalOpen && (
        <Suspense fallback={null}>
          <AddAgentModal
            open={isAddAgentModalOpen}
            onClose={toggleAddAgentModal}
            createAgentHandle={createAgentHandle}
            updateAgentHandle={updateAgentHandle}
            editingAgent={editingAgent}
          />
        </Suspense>
      )}

      {!IS_PUBLIC_DEMO && isAddKnowledgeBaseModalOpen && (
        <Suspense fallback={null}>
          <AddKnowledgeBaseModal
            open={isAddKnowledgeBaseModalOpen}
            onClose={toggleAddKnowledgeBaseModal}
            createKnowledgeBaseHandle={createKnowledgeBaseHandle}
          />
        </Suspense>
      )}
    </div>
  );
};

export default SideMenu;
