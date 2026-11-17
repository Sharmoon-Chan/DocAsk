import React from "react";

/**
 * 首屏骨架：只用原生元素，不引入 antd，保证"页面开始画"不被懒加载 chunk 拖住。
 */
const RouteFallback: React.FC<{ label?: string }> = ({ label = "正在准备页面…" }) => (
  <div className="mx-auto w-full max-w-4xl animate-pulse px-6 py-10" aria-busy="true" aria-live="polite">
    <span className="sr-only">{label}</span>
    <div className="mb-3 h-7 w-44 rounded-lg bg-slate-200/80" />
    <div className="mb-6 h-4 w-2/3 rounded bg-slate-200/60" />
    <div className="grid gap-4 md:grid-cols-2">
      <div className="h-36 rounded-xl border border-slate-200 bg-white/80" />
      <div className="h-36 rounded-xl border border-slate-200 bg-white/80" />
    </div>
  </div>
);

export default RouteFallback;
