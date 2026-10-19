# 本地部署
安装 `C:\Users\LX\anaconda3\python.exe -m pip install -r requirements-console.txt` 与 `cd web; npm install`。无需云服务或 API Key。

首选手工启动：

```powershell
C:\Users\LX\anaconda3\python.exe -m uvicorn backend.app:app --app-dir E:\wy\intelligent_channel_scheduler --reload --port 8000
```

```powershell
cd E:\wy\intelligent_channel_scheduler\web
Copy-Item .env.example .env.local
npm run dev
```

`--app-dir` 使后端命令可从 `C:\Windows\system32` 等任意当前目录启动。可选帮助脚本为 `powershell -ExecutionPolicy Bypass -File E:\wy\intelligent_channel_scheduler\scripts\start_local.ps1`；它只验证依赖并启动两个本地进程，不安装依赖、不终止其他进程、不访问外部 API。
