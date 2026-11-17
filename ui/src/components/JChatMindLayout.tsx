import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Button, Drawer, Result, Tooltip } from "antd";
import {
  BookOutlined,
  CompassOutlined,
  FileDoneOutlined,
  HistoryOutlined,
  LoginOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SlidersOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import Layout from "../layout/Layout.tsx";
import Sidebar from "../layout/Sidebar.tsx";
import SideMenu, { type SideMenuTab } from "./SideMenu.tsx";
import Content from "../layout/Content.tsx";
import AgentChatView from "./views/AgentChatView.tsx";
import { IS_PUBLIC_DEMO } from "../config.ts";
import ExoBrainLogo from "./ExoBrainLogo.tsx";
import { useAccount } from "../contexts/accountState.ts";
import { useChatSessions } from "../hooks/useChatSessions.ts";
import RouteFallback from "./RouteFallback.tsx";
import LazyBoundary from "./LazyBoundary.tsx";

const KnowledgeBaseView = lazy(() => import("./views/KnowledgeBaseView.tsx"));
const PublicShowcaseView = lazy(() => import("./views/PublicShowcaseView.tsx"));
const UsersManagementView = lazy(() => import("./views/UsersManagementView.tsx"));
const ModelsManagementView = lazy(() => import("./views/ModelsManagementView.tsx"));

function AdminOnly({ children }: { children: ReactNode }) {
  const account = useAccount();
  return account?.user?.role === "ADMIN" ? (
    children
  ) : (
    <Result
      status="403"
      title="需要管理员权限"
      subTitle="你的账号可使用助手、知识库与聊天记录。"
      extra={
        <Link to="/chat">
          <Button type="primary">返回工作区</Button>
        </Link>
      }
    />
  );
}

export default function JChatMindLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => !IS_PUBLIC_DEMO);
  const [preferredTab, setPreferredTab] = useState<SideMenuTab | null>(null);
  const [panelNonce, setPanelNonce] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const account = useAccount();
  const { chatSessions } = useChatSessions();

  const isHome =
    location.pathname === "/" ||
    location.pathname === "/agent" ||
    location.pathname === "/chat" ||
    location.pathname.startsWith("/chat/");
  const isShowcase = location.pathname.startsWith("/showcase");
  const isKb = location.pathname.startsWith("/knowledge-base");
  const isUsers = location.pathname.startsWith("/users");
  const isModels = location.pathname.startsWith("/models");

  const toggleHistoryPanel = (tab: SideMenuTab = "chat") => {
    if (panelOpen && preferredTab === tab) {
      setPanelOpen(false);
    } else {
      setPreferredTab(tab);
      setPanelNonce((value) => value + 1);
      setPanelOpen(true);
    }
  };

  return (
    <Layout>
      {/* 移动端顶栏 */}
      <header className="flex h-13 shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white px-3.5 md:hidden">
        <Button
          type="text"
          icon={<MenuOutlined />}
          aria-label="打开导航菜单"
          onClick={() => setMenuOpen(true)}
        />
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <ExoBrainLogo className="h-7 w-7" />
          <span className="truncate text-base font-bold tracking-tight text-ink">问档 DocAsk</span>
        </button>
        {IS_PUBLIC_DEMO ? (
          <div className="flex items-center gap-1.5">
            <Button size="small" onClick={() => navigate("/showcase")}>
              精选
            </Button>
            <Button type="link" href="/admin/" size="small" className="px-1.5!">
              登录
            </Button>
          </div>
        ) : (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {account?.user?.role === "ADMIN" ? "管理员" : "工作区"}
          </span>
        )}
      </header>

      {/* 移动端导航抽屉 */}
      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="left"
        title="工作区导航"
        size={310}
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        <SideMenu onNavigate={() => setMenuOpen(false)} />
      </Drawer>

      {/* 桌面端极窄 58px 垂直功能轨（Layout A 核心标识） */}
      <nav
        aria-label="主功能导航轨"
        className="hidden h-full w-[58px] shrink-0 flex-col items-center justify-between border-r border-slate-200 bg-white py-3.5 md:flex"
      >
        <div className="flex flex-col items-center gap-2.5">
          <Tooltip title="问档 DocAsk 首页" placement="right">
            <button
              type="button"
              onClick={() => navigate("/")}
              aria-label="问档 DocAsk 首页"
              className="mb-1 cursor-pointer rounded-xl transition-transform duration-150 hover:scale-105"
            >
              <ExoBrainLogo className="h-9 w-9" />
            </button>
          </Tooltip>

          <Tooltip title={IS_PUBLIC_DEMO ? "体验台" : "对话工作区"} placement="right">
            <button
              type="button"
              onClick={() => navigate("/chat")}
              aria-label={IS_PUBLIC_DEMO ? "体验台" : "对话工作区"}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors ${
                isHome
                  ? "border-ink bg-ink text-white"
                  : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-ink"
              }`}
            >
              <CompassOutlined />
            </button>
          </Tooltip>

          {IS_PUBLIC_DEMO && (
            <Tooltip title="精选真实问答" placement="right">
              <button
                type="button"
                onClick={() => navigate("/showcase")}
                aria-label="精选真实问答"
                className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors ${
                  isShowcase
                    ? "border-ink bg-ink text-white"
                    : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-ink"
                }`}
              >
                <FileDoneOutlined />
              </button>
            </Tooltip>
          )}

          <Tooltip title={IS_PUBLIC_DEMO ? "公开资料库" : "知识库"} placement="right">
            <button
              type="button"
              onClick={() => navigate("/knowledge-base")}
              aria-label={IS_PUBLIC_DEMO ? "公开资料库" : "知识库"}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors ${
                isKb
                  ? "border-ink bg-ink text-white"
                  : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-ink"
              }`}
            >
              <BookOutlined />
            </button>
          </Tooltip>

          <Tooltip title={panelOpen ? "收起记录与资源栏" : "展开记录与资源栏"} placement="right">
            <button
              type="button"
              onClick={() => toggleHistoryPanel("chat")}
              aria-label="切换记录与资源栏"
              aria-expanded={panelOpen}
              className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors ${
                panelOpen
                  ? "border-accent-border bg-accent-soft text-accent"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-ink"
              }`}
            >
              <HistoryOutlined />
              {chatSessions.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold text-white">
                  {chatSessions.length > 9 ? "9+" : chatSessions.length}
                </span>
              )}
            </button>
          </Tooltip>

          {!IS_PUBLIC_DEMO && account?.user?.role === "ADMIN" && (
            <>
              <div className="my-0.5 h-px w-6 bg-slate-200" />
              <Tooltip title="用户管理" placement="right">
                <button
                  type="button"
                  onClick={() => navigate("/users")}
                  aria-label="用户管理"
                  className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors ${
                    isUsers
                      ? "border-ink bg-ink text-white"
                      : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-ink"
                  }`}
                >
                  <TeamOutlined />
                </button>
              </Tooltip>
              <Tooltip title="系统模型" placement="right">
                <button
                  type="button"
                  onClick={() => navigate("/models")}
                  aria-label="系统模型"
                  className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors ${
                    isModels
                      ? "border-ink bg-ink text-white"
                      : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-ink"
                  }`}
                >
                  <SlidersOutlined />
                </button>
              </Tooltip>
            </>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          {IS_PUBLIC_DEMO ? (
            <Tooltip title="账号工作区登录 (/admin/)" placement="right">
              <a
                href="/admin/"
                aria-label="账号工作区登录"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600 transition-colors hover:border-accent hover:text-accent"
              >
                <LoginOutlined />
              </a>
            </Tooltip>
          ) : (
            <Tooltip title={panelOpen ? "收起工作区侧栏" : "展开工作区侧栏"} placement="right">
              <button
                type="button"
                onClick={() => setPanelOpen((prev) => !prev)}
                aria-label="展开或收起工作区侧栏"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600 hover:border-slate-300 hover:text-ink"
              >
                {panelOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              </button>
            </Tooltip>
          )}
        </div>
      </nav>

      {/* 可收起的 288px 记录/助手/资料抽屉 */}
      <Sidebar open={panelOpen}>
        <SideMenu
          key={panelNonce}
          preferredTab={preferredTab}
          onClosePanel={() => setPanelOpen(false)}
        />
      </Sidebar>

      {/* 右侧主舞台：顶部命令栏 + 页面内容 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="hidden h-13 shrink-0 items-center justify-between border-b border-sketch bg-white px-6 md:flex">
          <div className="flex min-w-0 items-center gap-6">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex shrink-0 cursor-pointer items-center gap-2.5 text-left"
            >
              <span className="text-sm font-bold tracking-tight text-ink">问档 DocAsk</span>
              <span className="hidden border-l border-slate-200 pl-2.5 text-xs text-slate-500 xl:inline">
                {IS_PUBLIC_DEMO ? "文档问答与引用溯源" : "账号工作区"}
              </span>
            </button>

            <nav aria-label="顶部快捷切换" className="flex items-center gap-6 text-[13px] font-medium">
              <button
                type="button"
                onClick={() => navigate("/chat")}
                className={`relative cursor-pointer py-3.5 transition-colors ${
                  isHome ? "font-semibold text-ink" : "text-slate-500 hover:text-ink"
                }`}
              >
                <span>{IS_PUBLIC_DEMO ? "体验台" : "对话"}</span>
                {isHome && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
              </button>

              {IS_PUBLIC_DEMO && (
                <button
                  type="button"
                  onClick={() => navigate("/showcase")}
                  className={`relative cursor-pointer py-3.5 transition-colors ${
                    isShowcase ? "font-semibold text-ink" : "text-slate-500 hover:text-ink"
                  }`}
                >
                  <span>精选实录</span>
                  {isShowcase && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
                </button>
              )}

              <button
                type="button"
                onClick={() => navigate("/knowledge-base")}
                className={`relative cursor-pointer py-3.5 transition-colors ${
                  isKb ? "font-semibold text-ink" : "text-slate-500 hover:text-ink"
                }`}
              >
                <span>{IS_PUBLIC_DEMO ? "公开资料库" : "知识库"}</span>
                {isKb && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
              </button>

              {!IS_PUBLIC_DEMO && account?.user?.role === "ADMIN" && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate("/users")}
                    className={`relative cursor-pointer py-3.5 transition-colors ${
                      isUsers ? "font-semibold text-ink" : "text-slate-500 hover:text-ink"
                    }`}
                  >
                    <span>用户管理</span>
                    {isUsers && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/models")}
                    className={`relative cursor-pointer py-3.5 transition-colors ${
                      isModels ? "font-semibold text-ink" : "text-slate-500 hover:text-ink"
                    }`}
                  >
                    <span>系统模型</span>
                    {isModels && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => toggleHistoryPanel("chat")}
                className={`relative flex cursor-pointer items-center gap-1.5 py-3.5 transition-colors ${
                  panelOpen ? "font-semibold text-accent" : "text-slate-500 hover:text-ink"
                }`}
              >
                <span>{IS_PUBLIC_DEMO ? "我的记录" : "记录与助手"}</span>
                {chatSessions.length > 0 && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                    {chatSessions.length}
                  </span>
                )}
              </button>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {IS_PUBLIC_DEMO ? (
              <>
                <span className="hidden text-xs text-slate-400 lg:inline">
                  公开只读演示
                </span>
                <Button size="small" href="/admin/" icon={<LoginOutlined />}>
                  账号登录
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {account?.user?.role === "ADMIN" ? "管理员" : "成员账号"}
                </span>
                <Button
                  size="small"
                  icon={panelOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                  onClick={() => setPanelOpen((prev) => !prev)}
                >
                  {panelOpen ? "收起侧栏" : "展开侧栏"}
                </Button>
              </div>
            )}
          </div>
        </header>

        <Content>
          <LazyBoundary>
            <Suspense fallback={<RouteFallback label="正在准备这个页面…" />}>
              <Routes>
                <Route path="/" element={<AgentChatView />} />
                <Route path="/agent" element={<AgentChatView />} />
                <Route path="/chat" element={<AgentChatView />} />
                <Route path="/chat/:chatSessionId" element={<AgentChatView />} />
                {IS_PUBLIC_DEMO && <Route path="/showcase" element={<PublicShowcaseView />} />}
                {IS_PUBLIC_DEMO && <Route path="/showcase/:showcaseId" element={<PublicShowcaseView />} />}
                <Route path="/knowledge-base" element={<KnowledgeBaseView />} />
                <Route path="/knowledge-base/:knowledgeBaseId" element={<KnowledgeBaseView />} />
                {!IS_PUBLIC_DEMO && (
                  <Route path="/users" element={<AdminOnly><UsersManagementView /></AdminOnly>} />
                )}
                {!IS_PUBLIC_DEMO && (
                  <Route path="/models" element={<AdminOnly><ModelsManagementView /></AdminOnly>} />
                )}
                <Route path="*" element={<AgentChatView />} />
              </Routes>
            </Suspense>
          </LazyBoundary>
        </Content>
      </div>
    </Layout>
  );
}
