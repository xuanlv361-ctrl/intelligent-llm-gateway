# 限制与安全
平台只读，不改状态、优先级、权重或生产路由，不做高容量真实测试。上传限 5 MB，仅 CSV/JSON/JSONL；防路径遍历，脱敏 Authorization/API Key/Bearer，处理公式风险，不渲染不可信 HTML，不执行任意 Python，不浏览任意文件。Demo 不代表 UAT，观测数据不支持因果渠道比较。

截至 2026-07-27，`npm audit --omit=dev` 对 React Router 7.18.1 报告两项同源高危 RSC/Action CSRF 告警。当前前端是纯客户端 BrowserRouter，不启用 RSC、Server Actions 或服务端路由动作，因而相关攻击面未启用；仍需在上游发布无冲突修复版本后升级并重新审计。完整依赖树中的开发工具告警也应在持续维护中处理。
