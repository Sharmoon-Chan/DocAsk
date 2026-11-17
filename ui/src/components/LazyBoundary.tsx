import React from "react";

interface LazyBoundaryProps {
  children: React.ReactNode;
  title?: string;
}

interface LazyBoundaryState {
  failed: boolean;
}

class LazyBoundary extends React.Component<LazyBoundaryProps, LazyBoundaryState> {
  state: LazyBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("lazy chunk failed", error instanceof Error ? error.message : error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto w-full max-w-xl px-5 py-12" role="alert">
        <div className="arch-card p-6">
          <p className="text-base font-bold text-ink">{this.props.title ?? "页面资源没有加载成功"}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            可能是网络中断，或者站点刚发布了新版本。你已经输入的问题会保留，重新加载后继续；已提交的问题不会重复发送。
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              type="button"
              className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              onClick={() => window.location.reload()}
            >
              重新加载页面
            </button>
            <a
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-slate-300"
              href="/chat"
            >
              返回体验台
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default LazyBoundary;
