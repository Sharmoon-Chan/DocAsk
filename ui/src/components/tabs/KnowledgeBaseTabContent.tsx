import React from "react";
import { useLocation } from "react-router-dom";
import { Button } from "antd";
import { PlusOutlined, BookOutlined, LockOutlined, GlobalOutlined } from "@ant-design/icons";
import type { KnowledgeBase } from "../../types";
import { IS_PUBLIC_DEMO } from "../../config.ts";

interface KnowledgeBaseTabContentProps {
  knowledgeBases: KnowledgeBase[];
  onCreateKnowledgeBaseClick?: () => void;
  onSelectKnowledgeBase?: (knowledgeBaseId: string) => void;
}

const KnowledgeBaseTabContent: React.FC<KnowledgeBaseTabContentProps> = ({
  knowledgeBases,
  onCreateKnowledgeBaseClick,
  onSelectKnowledgeBase,
}) => {
  const { pathname } = useLocation();

  const groups = IS_PUBLIC_DEMO
    ? [{ title: "公开演示库", publicResource: true, items: knowledgeBases }]
    : [
      { title: "我的知识库", publicResource: false, items: knowledgeBases.filter((kb) => !kb.publicResource) },
      { title: "公开演示库", publicResource: true, items: knowledgeBases.filter((kb) => kb.publicResource) },
    ];

  return (
    <div className="flex h-full flex-col gap-3">
      {onCreateKnowledgeBaseClick && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onCreateKnowledgeBaseClick}
          className="w-full"
        >
          新建知识库
        </Button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {knowledgeBases.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-slate-400">
            <BookOutlined className="mb-2 text-2xl" />
            <p className="text-xs font-medium text-slate-500">暂无知识库</p>
            <p className="mt-1 text-xs">
              {IS_PUBLIC_DEMO ? "公开演示暂未提供知识库" : "点击上方按钮创建"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold tracking-wide text-slate-500">
                  {group.publicResource ? <GlobalOutlined className="text-accent" /> : <LockOutlined />}
                  <span>{group.title}</span>
                  <span className="font-mono text-slate-400">({group.items.length})</span>
                </div>
                {group.items.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-400">
                    {group.publicResource ? "暂无公开演示资料" : "还没有私有知识库。新建后仅当前账号可见。"}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {group.items.map((kb) => {
                      const active = pathname === `/knowledge-base/${kb.knowledgeBaseId}`;
                      return (
                        <button
                          type="button"
                          aria-label={`打开知识库 ${kb.name}`}
                          key={kb.knowledgeBaseId}
                          onClick={() => onSelectKnowledgeBase?.(kb.knowledgeBaseId)}
                          className={`group w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color] duration-150 ${
                            active
                              ? "border-accent bg-accent-soft/70 shadow-card"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600">
                              <BookOutlined />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-semibold leading-5 text-ink">
                                {kb.name}
                              </div>
                              <div className="mt-0.5 text-[11px] font-medium text-accent">
                                {group.publicResource ? (kb.readOnly ? "公开资料 · 只读" : "公开资料 · 可管理") : "私有 · 仅当前账号"}
                              </div>
                              {kb.description && (
                                <div className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-slate-500">
                                  {kb.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeBaseTabContent;
