# 对话总结：TraeWork 上下文压缩调研

> 记录时间：2026-09-08
> 会话主题：查找 TraeWork 上下文使用率显示与压缩功能

## 结论（供新会话直接使用）

1. **TraeWork 上下文压缩功能现状**
   - 手动压缩按钮 + 上下文使用率显示：**仅 Code 模式提供**（官方论坛 TRAE宝确认）。
   - Work 模式：无压缩按钮，系统自动压缩（另一官方人员补充）。
   - 官方建议：进入新阶段时先总结核心内容再开新会话；精简输入、移除多余附件。
   - 官方文档：https://docs.trae.cn/ide/context-compaction（说明仅适用于内置 Agent，每轮对话结束后在最后一条消息正下方显示窗口大小+使用率+压缩按钮）。

2. **用户实际遇到的界面问题**
   - 用户当前使用 **Code 模式**，回复底部只显示 `Consumed ⭐0.25`（新积分计费体系的消耗显示），**看不到上下文使用率/压缩按钮**。
   - 可能原因：功能灰度未全量开放 / 客户端版本未到位 / 对话对象不是内置 Agent（如 Bot Assistant）。

3. **本地安装源码调查结论（D:\TRAE SOLO CN）**
   - 该目录是 VS Code 内核的宿主壳（TRAE SOLO 为 TraeWork 旧名），核心 bundle：`resources\app\out\vs\workbench\workbench.desktop.main.solo-lite.js`（15.6MB 压缩）。
   - 聊天界面（含使用率/压缩按钮/Consumed 显示）是**远程 web 前端**，经 `ICubeWebviewService` 的 webview（id: `icube-modules-desktop-webview`）加载，URL 由服务端 `setWebviewUrl` 动态下发。
   - 本地 nls 语言包与 bundle 中均无上下文压缩相关 UI 文案/标识符（contextWindow / usagePercent / compressContext 等均不存在）→ 该功能前端不在本地，是否显示由服务端灰度控制。

4. **本地对话记录存储位置**
   - 对话数据存于：`C:\Users\Administrator\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\database.db`（+ database.db-wal）。
   - 该库为 **SQLCipher 加密**，无法直接读取/修改；硬改有损坏风险。→ 不要尝试编辑此文件。

## 对用户的实用建议

- 别指望本地源码或改数据库看到使用率；等官方全量开放或切换 Code 模式内置 Agent 再观察。
- 保上下文最稳做法：每到一个阶段让 AI 输出总结存成文件（本文件即示例），然后开新会话贴入总结。
