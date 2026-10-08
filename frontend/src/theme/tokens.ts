import type { ThemeConfig } from "antd";

// Refero / Steep: paper, ink, quiet surfaces, one restrained peach accent.
// System fonts keep the intranet build independent of external font services.
export const theme: ThemeConfig = {
  token: {
    colorPrimary: "#17191c",
    colorInfo: "#555b66",
    colorInfoBg: "#f2f2f3",
    colorInfoBorder: "#e1e2e5",
    colorSuccess: "#357153",
    colorWarning: "#94602c",
    colorError: "#b33b36",
    colorText: "#17191c",
    colorTextSecondary: "#666b75",
    colorTextPlaceholder: "#787c85",
    colorBorder: "#dfe0e3",
    colorBorderSecondary: "#ebebed",
    colorBgLayout: "#fafafb",
    colorBgContainer: "#ffffff",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 14,
    borderRadius: 12,
    controlHeight: 38,
    controlHeightLG: 46,
    boxShadow: "0 4px 24px rgba(23,25,28,.08)",
    boxShadowSecondary: "0 8px 40px rgba(23,25,28,.10)",
  },
  components: {
    Button: {
      borderRadius: 999,
      borderRadiusLG: 999,
      borderRadiusSM: 999,
      primaryShadow: "none",
      defaultShadow: "none",
      fontWeight: 500,
    },
    Card: {
      borderRadiusLG: 24,
      headerFontSize: 16,
      headerHeight: 64,
      bodyPadding: 24,
    },
    Table: {
      headerBg: "#fafafb",
      headerColor: "#666b75",
      cellPaddingBlock: 18,
      cellPaddingInline: 16,
      rowHoverBg: "#fafafb",
      headerSplitColor: "transparent",
    },
    Modal: { borderRadiusLG: 24 },
    Tag: { borderRadiusSM: 6 },
    Tabs: {
      inkBarColor: "#17191c",
      itemSelectedColor: "#17191c",
      itemHoverColor: "#555b66",
    },
    Progress: { defaultColor: "#555b66", remainingColor: "#efeff1" },
    Alert: { borderRadiusLG: 16 },
  },
};
