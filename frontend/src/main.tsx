import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#216653",
          borderRadius: 7,
          colorText: "#243c35",
          colorBgLayout: "#f6f7f4",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: 13,
        },
        components: {
          Table: {
            headerBg: "#f7f8f5",
            headerColor: "#718078",
            cellPaddingBlock: 15,
          },
          Button: { controlHeight: 36 },
          Menu: { itemBorderRadius: 6 },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
