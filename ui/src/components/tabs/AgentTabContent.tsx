import React from "react";
import { Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import type { AgentVO } from "../../api/api.ts";
import { formatDateTime } from "../../utils";

interface AgentTabContentProps {
  agents: AgentVO[];
  onCreateAgentClick?: () => void;
  onSelectAgent: (agentId: string) => void;
  onEditAgent?: (agent: AgentVO) => void;
  onDeleteAgent?: (agentId: string) => void;
}

const AgentTabContent: React.FC<AgentTabContentProps> = ({
  agents,
  onCreateAgentClick,
  onSelectAgent,
  onEditAgent,
  onDeleteAgent,
}) => {
  const [modal, modalHolder] = Modal.useModal();

  const getContextMenuItems = (agent: AgentVO): MenuProps["items"] => {
    const items: MenuProps["items"] = [];
    if (agent.readOnly) return items;

    if (onEditAgent) {
      items.push({
        key: "edit",
        label: "编辑",
        icon: <EditOutlined />,
        onClick: (e) => {
          e.domEvent.stopPropagation();
          onEditAgent(agent);
        },
      });
    }

    if (onDeleteAgent) {
      items.push({
        key: "delete",
        label: "删除",
        icon: <DeleteOutlined />,
        danger: true,
        onClick: (e) => {
          e.domEvent.stopPropagation();
          modal.confirm({
            title: "确定要删除这个智能体吗？",
            content: "删除后将无法恢复",
            okText: "确定",
            cancelText: "取消",
            okType: "danger",
            onOk: () => {
              onDeleteAgent(agent.id);
            },
          });
        },
      });
    }

    return items;
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {modalHolder}
      {onCreateAgentClick && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onCreateAgentClick}
          className="w-full"
        >
          新建智能体助手
        </Button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {agents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-slate-500">
            <p className="text-xs font-medium">暂无智能体</p>
            {onCreateAgentClick && <p className="mt-1 text-xs text-slate-400">点击上方按钮添加</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map((agent) => {
              const menuItems = getContextMenuItems(agent);
              const hasMenu = menuItems && menuItems.length > 0;
              return (
                <div
                  key={agent.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectAgent(agent.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectAgent(agent.id);
                    }
                  }}
                  className="group relative w-full cursor-pointer rounded-xl border border-sketch bg-white px-3 py-2.5 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-accent/50 hover:shadow-card-hover"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sketch bg-paper text-sm text-ink-soft">
                      <AppstoreOutlined />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">
                          {agent.name}
                        </span>
                        {agent.readOnly && (
                          <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                            公开
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                          {agent.description}
                        </div>
                      )}
                      {agent.updatedAt && (
                        <div className="mt-1 text-[11px] text-slate-400">
                          {formatDateTime(agent.updatedAt)}
                        </div>
                      )}
                    </div>
                    {hasMenu && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                        className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
                      >
                        <Dropdown
                          menu={{ items: menuItems }}
                          trigger={["contextMenu", "click"]}
                          placement="bottomRight"
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<MoreOutlined />}
                            aria-label={`管理助手 ${agent.name}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-400 hover:text-ink"
                          />
                        </Dropdown>
                      </div>
                    )}
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

export default AgentTabContent;
