# A股主板 IPO 财务资料与整改工作台

本地开发版，采用 React、TypeScript、Ant Design、FastAPI 与 PostgreSQL 18。当前以获准目录元数据驱动人工复核，只使用虚构样本。原件、OCR、AI 与外部模型调用保持关闭。

开发以根目录《技术适配声明》V0.2 和《第一阶段技术开发文档》V0.2 为方案基线。实际进度、验证结果与尚未完成事项见 [开发实施记录](docs/开发实施记录.md)。当前不代表整个第一阶段已验收或已在公司内网上线。

## 本机启动

已验证环境为 macOS arm64、Python 3.14.7、Node.js 24.18.0、npm 11.16.0。以下命令从项目根目录执行。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
npm ci --ignore-scripts
npm run db:prepare
npm run db
```

数据库启动后保持该终端运行，在另一个终端执行迁移和显式演示初始化。

```sh
.venv/bin/alembic -c backend/alembic.ini upgrade head
cd backend
../.venv/bin/python -m app.seed
cd ..
npm run dev
```

页面为 `http://127.0.0.1:5173`，API 为 `http://127.0.0.1:18080`。开发期间接口说明在 API 的 `/docs`，正式环境关闭该入口。前端页面和 API 请求使用同源代理。

演示账号为 `cfo`、`pmo`、`owner`、`reviewer`、`it`。随机密码只保存在本机 `.runtime/phase1/demo-credentials.json`，不放入文档或版本库。显式初始化会生成 2 个虚构主体、33 项主题共 66 个候选实例、10 项分派、7 份初始目录和 3 项整改。已有完整样本时重复初始化会保留现有记录；浏览器测试可能追加虚构目录和快照。

新账号在“账号管理”创建，需要首次改密。新建项目必须明确指定财务负责人，IT 不会因创建项目自动获得业务权限。项目管理人员可在“项目设置 → 人员与分工”选择新账号并授权。

## 独立数据与进程

| 内容 | 本轮位置 |
| --- | --- |
| PostgreSQL 端口 | `127.0.0.1:55434` |
| 开发数据库 | `finance_phase1_dev` |
| 测试数据库 | `finance_phase1_test` |
| 数据文件及配置 | `.runtime/phase1/postgres`、`.runtime/phase1/app.env` |
| 导出副本 | `.runtime/phase1/exports` |
| 隔离恢复端口 | `55435` |

开发与集成测试使用独立数据库；测试夹具拒绝连接非 `finance_phase1_test` 库。应用使用受限 `finance_app` 角色，迁移使用 `finance_owner`。旧 55432 数据库没有纳入本轮启动、迁移或停止操作。

在开发服务终端按 Ctrl+C 停止本轮 API、worker、前端，再在数据库终端按 Ctrl+C 停止本轮数据库。不要按端口批量杀进程，也不要删除 `.runtime` 来排查问题。端口冲突应先核对进程归属。

## 检查命令

```sh
npm run lint
npm run typecheck
npm run build
.venv/bin/pytest backend/tests -q --junitxml=.runtime/phase1/backend-results.xml
npm run test:e2e
```

后端测试要求 55434 数据库正在运行。浏览器测试另需 `npm run dev`、显式初始化的虚构数据和本机 Chrome；使用独立无头浏览器，不复用个人浏览器资料。测试操作会追加演示业务记录，不应针对真实业务环境执行。

本机沙箱可能禁止 PostgreSQL 共享内存、回环连接或 Chrome 启动，需要相应运行权限。这类环境错误应与业务测试失败分开记录。

## 本轮新增能力

- 身份共享/排他锁与项目事务锁，账号停用、密码重置会撤销会话；首次改密、人员分离和最多 10 个活动账号由后端校验。
- 清单、目录、整改、审计在数据库按权限筛选和分页。清单的准入失效、受限和逾期状态在分页前计算。
- 复核固定提交版本；换版扣回有效完成数；新版模板可逐项采用或保留，决策与历史复核不可改写。
- 生成、导出任务持久化领取记录，60 秒租约、20 秒心跳、最多 3 次执行，失败延迟 5/15 秒重试。旧执行 token 失效后不能发布结果。
- 导出包包含 `directory.xlsx`、`manifest.json`、`checksums.json`。工作簿含快照说明、资料清单、整改事项、目录版本；文字单元格不作为公式执行。下载重新检查当前权限和有效期。
- 每分钟清理过期导出及不再属于有效任务的临时文件。导出审批目前按申请创建时间起 24 小时有效，配置项为 `EXPORT_TTL_HOURS`。

快照目前仍同步冻结，清单生成仍以整个批次为一次业务事务。逐行检查点、异步快照及完整运维告警等后续工作详见实施记录。

## 恢复与目标环境

停止 API、worker、页面并保持本轮数据库启动，可在本机执行隔离恢复演练。

```sh
.venv/bin/python scripts/restore-check.py
```

该脚本仅接受当前项目 `.runtime/phase1/postgres`，短暂停止并恢复源库，在 55435 启动独立副本；检查记录数量、固定引用和快照哈希，并撤销恢复库中的会话。演练结束停止副本。结果位于 `.runtime/phase1/recovery-results.json`。这是本机同盘冷备演练，不能证明独立故障域备份或正式 RPO/RTO 已达标。

`deploy/` 提供待 IT 审阅的容器、内部 TLS 和最小权限配置。此机器没有可用 Docker 命令，本轮未执行镜像构建或目标内网部署。正式发布还需批准目录字段、实名职责、证书、镜像摘要、秘密注入、备份留存及业务签收；不要使用演示数据库或演示密码上线。
