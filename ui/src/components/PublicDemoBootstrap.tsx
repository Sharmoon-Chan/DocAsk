import { useEffect, useState, type ReactNode } from "react";
import { Button, Spin } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { initializeDemoVisitor } from "../api/demo.ts";
import ExoBrainLogo from "./ExoBrainLogo.tsx";

export default function PublicDemoBootstrap({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void initializeDemoVisitor().then(() => {
      if (active) setStatus("ready");
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => { active = false; };
  }, [attempt]);

  if (status === "ready") return children;

  return (
    <div className="flex h-dvh items-center justify-center bg-paper p-6">
      <div className="arch-card w-full max-w-sm p-7 text-center">
        <ExoBrainLogo className="mx-auto mb-4 h-12 w-12" />
        <h1 className="mb-1 text-xl font-bold tracking-tight text-ink">问档 DocAsk</h1>
        <p className="mb-5 text-xs font-medium text-ink-muted">可核验原文出处与执行轨迹的文档 Agent</p>
        {status === "loading" ? (
          <div role="status" className="space-y-3 text-sm text-ink-soft">
            <Spin />
            <p>正在连接公开体验环境…</p>
          </div>
        ) : (
          <div role="alert">
            <p className="mb-5 text-sm leading-6 text-ink-soft">公开体验暂时无法连接，请检查网络后重试。</p>
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => {
              setStatus("loading");
              setAttempt((value) => value + 1);
            }}>重新连接</Button>
          </div>
        )}
      </div>
    </div>
  );
}
