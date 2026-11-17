import { useState } from "react";
import { Alert, Button, Form, Input, Typography } from "antd";
import { ArrowLeftOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { useAccount } from "../../contexts/accountState.ts";
import ExoBrainLogo from "../ExoBrainLogo.tsx";

export default function LoginView() {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async ({ username, password }: { username: string; password: string }) => {
    if (!account || busy) return;
    setBusy(true);
    setError("");
    try {
      await account.login(username.trim(), password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "登录失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3 animate-pop-in">
          <ExoBrainLogo className="h-11 w-11 shadow-card" />
          <div>
            <span className="block text-xl font-extrabold tracking-tight text-ink">问档 DocAsk</span>
            <span className="block text-xs font-medium text-ink-muted">账号隔离与系统模型管理后台</span>
          </div>
        </div>

        <section
          className="arch-card p-6 sm:p-8 animate-pop-in"
          style={{ animationDelay: "50ms" }}
          aria-labelledby="account-login-title"
        >
          <Typography.Title level={2} id="account-login-title" className="mb-1.5! text-xl! font-bold! text-ink!">
            账号工作区登录
          </Typography.Title>
          <p className="mb-6 text-sm leading-6 text-ink-soft">
            登录后管理你的私有智能体、知识库、聊天记录与系统模型。
          </p>
          {error && <Alert type="error" showIcon title={error} className="mb-5!" />}
          <Form layout="vertical" onFinish={submit} requiredMark={false} autoComplete="on">
            <Form.Item name="username" label="账号" rules={[{ required: true, whitespace: true, message: "请输入账号" }]}>
              <Input
                prefix={<UserOutlined className="text-slate-400" />}
                autoComplete="username"
                placeholder="输入账号"
                maxLength={32}
                size="large"
                autoFocus
              />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password
                prefix={<LockOutlined className="text-slate-400" />}
                autoComplete="current-password"
                placeholder="输入密码"
                maxLength={128}
                size="large"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={busy} className="mt-2!">
              登录工作区
            </Button>
          </Form>
          <p className="mt-5 text-center text-xs leading-6 text-slate-400">
            账号由管理员创建，资源与会话按账号严格隔离。
          </p>
        </section>

        <div className="mt-6 text-center">
          <Button type="link" href="/" icon={<ArrowLeftOutlined />}>
            返回游客免登录体验台
          </Button>
        </div>
      </div>
    </main>
  );
}
