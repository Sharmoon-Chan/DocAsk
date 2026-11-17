import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App.tsx";
import FeedbackProvider from "./components/FeedbackProvider.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: "#0f766e",
        colorInfo: "#0f766e",
        colorLink: "#0f766e",
        colorSuccess: "#059669",
        colorWarning: "#b45309",
        colorError: "#be123c",
        colorText: "#0f172a",
        colorTextSecondary: "#475569",
        colorBorder: "#e2e8f0",
        colorBgLayout: "#f8fafc",
        borderRadius: 10,
        fontWeightStrong: 700,
      },
      components: {
        Button: { borderRadius: 10, controlHeight: 36, fontWeight: 600 },
        Input: { borderRadius: 10 },
        Select: { borderRadius: 10 },
        Card: { borderRadius: 14 },
        Modal: { borderRadiusLG: 14 },
      },
    }}
  >
    <FeedbackProvider><App /></FeedbackProvider>
  </ConfigProvider>
);
