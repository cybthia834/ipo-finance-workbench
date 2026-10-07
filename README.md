# 财务资料与整改工作台

第一阶段本地开发版，采用 React / TypeScript / Ant Design、FastAPI 和真实 PostgreSQL。当前可运行**目录登记 → 独立复核 → 缺口整改 → 快照与受控导出**流程。

本次开发前已全文阅读[技术适配声明](技术适配声明.md)和[第一阶段技术开发文档](第一阶段技术开发文档.md)。原始需求、部署手册及两份设计文档保留；实现差异、测试结果和后续工作见[开发交付记录](docs/第一阶段开发交付记录.md)。这是虚构数据开发环境，尚未开放真实资料试点。

## 当前本机入口

- 页面：[http://127.0.0.1:5173](http://127.0.0.1:5173)
- API：`http://127.0.0.1:18080/api/v1`；交互式接口文档：`http://127.0.0.1:18080/docs`
- PostgreSQL：`127.0.0.1:55432`，仅监听本机。
- 演示用户名：`cfo`、`pmo`、`owner`、`reviewer`、`it`。随机密码保存在本地 [.runtime/demo-credentials.json](.runtime/demo-credentials.json)，未写入源码或页面。建议先使用 `pmo` 浏览，再使用经办、复核和 CFO 账号分别操作。

`it` 默认没有现有财务项目权限。兼任角色不解除独立复核要求。当前没有 Git 仓库，本次没有初始化仓库或推送任何代码。

## 安装与启动

已验证环境：macOS 15.6 / Apple Silicon、Node 24.18.0、Python 3.14.7、PostgreSQL 18.4。其他平台尚未实测。依赖安装需要网络；业务页面运行不依赖公网 CDN、模型或外部遥测。开发期 `/docs` 使用 FastAPI 默认 Swagger 静态资源，离线时可直接查看 `docs/openapi.json`；生产关闭该页面。

在项目根目录执行一次：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
npm ci
npm run db:prepare
```

终端一启动开发数据库：

```sh
npm run db
```

该命令生成本地随机数据库凭据与 `.runtime/app.env`，创建彼此分开的 `finance_dev`、`finance_test` 和 `finance_restore` 数据库。重启会保留原数据库及凭据。`db:prepare` 仅恢复本机 PostgreSQL 依赖包所需的库文件符号链接，用于 npm 阻止依赖安装脚本的情况。

终端二执行迁移、显式初始化虚构样本并启动应用：

```sh
.venv/bin/alembic -c backend/alembic.ini upgrade head
PYTHONPATH=backend .venv/bin/python -m app.seed
npm run dev
```

种子完成后再次运行会保留既有演示数据；服务器启动本身不会初始化或覆盖数据。`npm run dev` 同时启动 API、worker 和前端，Ctrl+C 停止这组进程。数据库在终端一单独停止。不要删除 `.runtime` 来“重置页面”。

端口冲突时应统一修改 Vite 代理、启动脚本和 `APP_ORIGIN`，再重启；不要停止不属于本项目的服务。本次 API 使用 18080，是因为本机 8000 已被其他服务占用。

## 体验路径

1. PMO 查看工作首页、财务清单与清单生成预检；重复生成不会重复新增。
2. 经办登记获准的虚构目录，关联自己负责的清单，提交复核。
3. 独立复核人逐项勾选验收点，接受、退回或记录受限资料的离线核查结果。
4. 经办提交目录新版后，相关已接受清单重新进入待复核，历史决定继续保留。
5. 从清单缺口创建整改，Owner 记录行动、申请延期和验证，独立验证人决定关闭或退回。
6. PMO 冻结快照并申请导出，CFO 独立批准；后台任务生成目录 CSV 与 manifest，下载仍检查当前权限。

演示首页初始为 66 项候选、10 项已分派适用、7 份目录、4 项已接受、3 项待复核、3 项整改。浏览器回归会追加标明“验收专用”的虚构快照。十类全部复核与三类全部整改闭环在独立测试库验证，不将演示首页预填成全部完成。

## 验证命令

```sh
npm run build
.venv/bin/pytest backend/tests -q
npm run test:e2e
```

后端测试只清理固定命名的 `finance_test` 数据库，使用真实 PostgreSQL。浏览器测试需要本机 Chrome、运行中的开发服务及上述演示数据；它使用真实页面和 API，并检查请求没有离开本机。

本机冷备恢复演练：

```sh
.venv/bin/python scripts/restore-check.py
```

此命令**短暂停止并自动重启本项目开发数据库**，将干净关闭的集群复制到 `.runtime/recovery/`，以 55433 端口启动隔离恢复副本，检查记录数量、版本引用、快照摘要及旧会话撤销，随后关闭副本。只适用于本机虚构环境；同盘副本不构成异地备份。该目录含演示账号和会话数据，应按本地敏感运行目录保管。

## 代码与交付资料

| 路径 | 内容 |
| --- | --- |
| `frontend/src/pages/` | 看板、清单、目录、复核、整改、快照、模板及范围设置 |
| `backend/app/api/` | 身份会话、项目治理及业务命令 |
| `backend/app/security.py` | 项目、主体、对象权限与同人分离校验 |
| `backend/app/models.py`、`backend/migrations/` | 关系模型、冻结迁移及数据库保护 |
| `backend/app/worker.py` | 持久生成与导出任务 |
| `backend/tests/`、`tests/e2e/` | 真实数据库集成、容量及浏览器测试 |
| `docs/openapi.json` | 当前实现的接口契约 |
| `deploy/` | 待 IT 审查与实际构建验证的内网容器交付定义 |
| `.runtime/` | 本地数据库、凭据、运行记录和测试产物；已排除出版本控制 |

Docker 镜像未在当前机器构建或发布。进入内网试点前，按[内网运维交接说明](docs/内网运维交接说明.md)完成环境、身份、目录准入、备份告警和业务验收。原件上传、OCR、AI、用友直连及导入仍关闭。
