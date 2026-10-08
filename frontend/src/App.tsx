import { createContext, useContext, useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Space, Tag } from "antd";
import {
  AppstoreOutlined,
  AuditOutlined,
  CheckSquareOutlined,
  DatabaseOutlined,
  FileProtectOutlined,
  FolderOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  api,
  clearPendingRequests,
  type Context,
  type Me,
  roleNames,
} from "./api";
import { LoadState, useAction, useData } from "./shared";
import { Dashboard, Checklists, ChecklistDetail } from "./pages/Checklists";
import {
  EvidenceList,
  EvidenceDetail,
  Issues,
  IssueDetail,
} from "./pages/Records";
import { Reports, Settings, AuditPage } from "./pages/Management";
import { Accounts } from "./pages/Accounts";
import { ScopeEditor } from "./pages/ScopeEditor";

type WorkContext = { ctx: Context; me: Me; base: string; refresh: () => void };
const Work = createContext<WorkContext>(null!);
export const useWork = () => useContext(Work);

function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <FileProtectOutlined />
      </span>
      <div>
        <strong>财务准备工作台</strong>
        <small>IPO FINANCE WORKSPACE</small>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const { run, busy } = useAction();
  return (
    <div className="login-page">
      <div className="login-story">
        <Logo />
        <div>
          <span className="eyebrow">从准备，到有据可查</span>
          <h1>
            每一份资料，
            <br />
            每一步进展。
          </h1>
          <p>
            把分散的资料目录、独立复核与整改记录，
            <br />
            汇聚到同一个财务工作空间。
          </p>
          <div className="login-chain">
            清单 <span>→</span> 目录 <span>→</span> 复核 <span>→</span> 整改
          </div>
        </div>
        <small>内部协作 · 目录模式 · 全程留痕</small>
      </div>
      <div className="login-form">
        <div className="login-box">
          <Tag color="green">第一阶段 · 目录模式</Tag>
          <h2>登录工作台</h2>
          <p>使用分配给你的独立账号，继续财务准备工作。</p>
          <Form
            layout="vertical"
            onFinish={(values) =>
              run(async () => {
                const result = await api("/auth/login", values);
                sessionStorage.setItem("csrf", result.csrf_token);
                onLogin();
              }, "登录成功")
            }
          >
            <Form.Item
              name="username"
              label="账号"
              rules={[{ required: true }]}
            >
              <Input
                autoComplete="username"
                size="large"
                placeholder="请输入独立账号"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true }]}
            >
              <Input.Password
                autoComplete="current-password"
                size="large"
                placeholder="请输入密码"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={busy}
            >
              进入工作台
            </Button>
          </Form>
          <div className="login-note">
            <SafetyCertificateOutlined /> 原件上传与AI处理暂未开放。
            <br />
            本地演示环境仅使用虚构数据。
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordReset({ loggedOut }: { loggedOut: () => void }) {
  const { run, busy } = useAction();
  return (
    <div className="login-page">
      <div className="login-box">
        <h2>设置个人密码</h2>
        <p>首次登录需要更换初始密码。</p>
        <Form
          layout="vertical"
          onFinish={(values) =>
            run(async () => {
              await api("/auth/password", values);
              loggedOut();
            }, "密码已更新，请重新登录")
          }
        >
          <Form.Item
            name="current_password"
            label="初始密码"
            rules={[{ required: true }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, min: 12 }]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            保存并重新登录
          </Button>
        </Form>
      </div>
    </div>
  );
}

export default function App() {
  const [newProject, setNewProject] = useState(false);
  const [me, setMe] = useState<Me>();
  const [checking, setChecking] = useState(true);
  const load = () => {
    setChecking(true);
    api<Me>("/me")
      .then(setMe)
      .catch(() => setMe(undefined))
      .finally(() => setChecking(false));
  };
  const logout = () => {
    sessionStorage.clear();
    clearPendingRequests();
    setMe(undefined);
  };
  useEffect(() => {
    load();
    window.addEventListener("session-expired", logout);
    return () => window.removeEventListener("session-expired", logout);
  }, []);
  if (checking)
    return (
      <LoadState loading error="">
        {null}
      </LoadState>
    );
  if (!me) return <Login onLogin={load} />;
  if (me.user.must_change_password) return <PasswordReset loggedOut={logout} />;
  if (!me.projects.length)
    return (
      <div className="empty-project">
        <Logo />
        <h2>账号已登录</h2>
        {me.user.identity_admin && <Accounts currentUserId={me.user.id} />}
        <p>当前账号没有财务项目授权，请由财务负责人分配项目和主体范围。</p>
        <Space>
          {me.user.identity_admin && (
            <Button type="primary" onClick={() => setNewProject(true)}>
              创建财务项目
            </Button>
          )}
          <Button
            onClick={async () => {
              await api("/auth/logout", {});
              logout();
            }}
          >
            退出登录
          </Button>
        </Space>
        <Modal
          open={newProject}
          title="创建项目"
          onCancel={() => setNewProject(false)}
          footer={null}
          destroyOnHidden
          width={850}
        >
          <ScopeEditor
            onSaved={() => {
              setNewProject(false);
              load();
            }}
          />
        </Modal>
      </div>
    );
  return (
    <Routes>
      <Route
        path="/projects/:projectId/*"
        element={<Shell me={me} logout={logout} />}
      />
      <Route
        path="*"
        element={
          <Navigate replace to={`/projects/${me.projects[0].id}/dashboard`} />
        }
      />
    </Routes>
  );
}

function Shell({ me, logout }: { me: Me; logout: () => void }) {
  const { projectId } = useParams();
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const navigate = useNavigate();
  const {
    data: ctx,
    loading,
    error,
  } = useData<Context>(`/projects/${projectId}/context`, revision);
  const base = `/projects/${projectId}`;
  const manager = ctx?.roles.some((r) => ["cfo", "pmo"].includes(r));
  const links = [
    ["dashboard", "工作首页", <AppstoreOutlined />],
    ["checklists", "财务清单", <CheckSquareOutlined />],
    ["evidence", "资料目录", <FolderOutlined />],
    ["issues", "整改台账", <AuditOutlined />],
  ] as const;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-label">项目工作空间</div>
        <Select
          className="project-select"
          value={projectId}
          options={me.projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => navigate(`/projects/${id}/dashboard`)}
        />
        <nav>
          <div className="nav-heading">工作台</div>
          {links.map(([path, name, icon]) => (
            <NavLink key={path} to={`${base}/${path}`}>
              {icon}
              <span>{name}</span>
            </NavLink>
          ))}
          {manager && (
            <>
              <div className="nav-heading">项目管理</div>
              <NavLink to={`${base}/reports`}>
                <DatabaseOutlined />
                <span>报表与快照</span>
              </NavLink>
              <NavLink to={`${base}/settings`}>
                <SettingOutlined />
                <span>项目设置</span>
              </NavLink>
              <NavLink to={`${base}/audit`}>
                <FileProtectOutlined />
                <span>审计记录</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="mode-note">
            <SafetyCertificateOutlined />
            <div>
              目录模式<small>资料原件保持在线下</small>
            </div>
            <span className="status-dot" />
          </div>
          <div className="user">
            <span className="avatar">{me.user.display_name[0]}</span>
            <div>
              <strong>{me.user.display_name.split(" · ")[0]}</strong>
              <small>{ctx?.roles.map((r) => roleNames[r]).join(" / ")}</small>
            </div>
            <Button
              type="text"
              aria-label="退出登录"
              icon={<LogoutOutlined />}
              onClick={async () => {
                await api("/auth/logout", {});
                logout();
              }}
            />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            财务工作空间 <span>/</span> {ctx?.project.name || "项目"}
          </div>
          <Space>
            <span className="internal-badge">
              <span className="status-dot" /> 内部协作
            </span>
            {me.demo_mode && <Tag>虚构数据演示</Tag>}
            {me.user.identity_admin && (
              <Button onClick={() => setAccountsOpen(true)}>账号管理</Button>
            )}
          </Space>
        </header>
        <div className="page-content" key={`${projectId}-${me.user.id}`}>
          <LoadState loading={loading} error={error}>
            {ctx && (
              <Work.Provider
                value={{
                  ctx,
                  me,
                  base,
                  refresh: () => setRevision((x) => x + 1),
                }}
              >
                <Routes>
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="checklists" element={<Checklists />} />
                  <Route path="checklists/:id" element={<ChecklistDetail />} />
                  <Route path="evidence" element={<EvidenceList />} />
                  <Route path="evidence/:id" element={<EvidenceDetail />} />
                  <Route path="issues" element={<Issues />} />
                  <Route path="issues/:id" element={<IssueDetail />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="audit" element={<AuditPage />} />
                  <Route
                    path="*"
                    element={<Navigate to={`${base}/dashboard`} replace />}
                  />
                </Routes>
              </Work.Provider>
            )}
          </LoadState>
        </div>
        <Modal
          open={accountsOpen}
          onCancel={() => setAccountsOpen(false)}
          footer={null}
          width={1000}
          destroyOnHidden
        >
          {accountsOpen && <Accounts currentUserId={me.user.id} />}
        </Modal>
        <footer>
          财务资料与整改工作台{" "}
          <span>数据以当前权限范围展示 · 所有复核结论均需人工确认</span>
        </footer>
      </main>
    </div>
  );
}
