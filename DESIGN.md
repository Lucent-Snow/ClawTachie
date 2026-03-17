# ClawTachie 设计文档

## 定位

OpenClaw 的桌面伴侣客户端。Galgame 风格立绘 + 对话交互，面向所有 OpenClaw 用户。

## 双层 UI

### 小人模式（日常态）

- 立绘常驻桌面，透明背景，可拖拽，置顶
- 收到消息时在旁边冒对话气泡
- 输入框在小人附近，快进快出
- 表情跟随对话内容实时切换
- 快捷键控制显隐
- 后续接入语音输入/输出

### 主窗口（完整功能）

- 点击小人或快捷键打开
- 完整消息历史，Markdown 渲染
- 文件/图片附件收发
- Session 切换、设置面板
- 打开时小人仍在，但对话内容转到主窗口显示，小人只做表情反应
- 关闭主窗口回到小人模式

两层共享同一个 WebSocket 连接和 session，消息实时同步。

## 技术栈

- **框架**: Tauri (Rust + Web Frontend)
- **前端**: React + TypeScript
- **通信**: WebSocket → OpenClaw Gateway 协议 (v3)
- **本地存储**: 设置、设备身份、立绘缓存

## 通信协议

基于 OpenClaw Gateway WebSocket 协议，已验证可用的方法：

### 核心（已实现）
- `connect` — v3 设备认证握手（Ed25519 签名）
- `chat.send` — 发送消息（支持 attachments 参数）
- `chat.history` — 拉取历史记录
- `chat` / `agent` 事件 — 流式接收回复
- `tick` — 心跳保活

### 待实现
- `chat.abort` — 中断生成
- `sessions.list` / `sessions.reset` / `sessions.delete` / `sessions.patch` — Session 管理
- `sessions.compact` — 压缩历史
- `models.list` — 可用模型列表
- `agents.list` — Agent 列表
- `tts.convert` / `tts.providers` / `tts.setProvider` — 语音合成（Gateway 侧 fallback）
- `exec.approval.requested` 事件 — 工具执行审批
- `device.pair.*` — 设备配对管理

## 表情系统

### 立绘结构
参考 ZcChat，每个角色是一个文件夹，里面放 PNG：
```
characters/
  default/
    正常.png
    微笑.png
    生气.png
    悲伤.png
    惊讶.png
    思考.png
    ...
```

### 表情触发
当前方案：模型在回复中带文本标记 `[emotion:smile]`，客户端正则匹配后切换立绘。

未来优化方向：
- 注册为工具调用（`set_emotion` tool），通过 tool-events 传递，彻底脱离正文
- 结构化 metadata 字段

### 提示词注入
当前文本标记方案存在注入风险（用户可伪造表情指令）。
低优先级——当前无安全影响，公开发布前需解决。

## 设置面板

### 本地设置
- Gateway 连接（地址、token、连接状态指示）
- 立绘包路径 / 角色切换
- 语音输出（TTS 模型选择，本地优先，Gateway fallback）
- 语音输入（ASR 模型，纯本地：麦克风录音 → 本地 Whisper 或外部 API → 文字）
- 快捷键配置（小人显隐、快速输入、中断生成）
- 窗口行为（开机启动、置顶、透明度）

### OpenClaw 设置
- Session 管理（列表、切换、新建、重置、删除）
- 当前 Agent / Model 显示与切换
- 工具执行审批策略

### 角色设置
- 表情映射规则
- 对话气泡样式
- 小人默认位置与大小

## 语音方案

### TTS（语音输出）
- **默认：本地 TTS** — 低延迟，Tauri 调用本地模型或系统 TTS
- **Fallback：Gateway TTS** — 通过 `tts.convert` 接口，适合无 GPU 用户
- 设置中可选择 provider

### ASR（语音输入）
- 纯客户端实现，Gateway 无内置 ASR
- Tauri 调用本地麦克风 → 录音 → 本地 Whisper 或外部 ASR API → 文字 → chat.send
- 后续功能，非 MVP

## 开发计划

### Phase 1：Tauri 骨架（当前）
- [ ] Tauri 项目初始化（React + TypeScript）
- [ ] WebSocket 通信层从终端原型迁移到前端
- [ ] 基础聊天 UI（消息列表 + 输入框）
- [ ] 连接配置界面（Gateway 地址 + token）

### Phase 2：小人模式
- [ ] 透明无边框窗口
- [ ] 立绘显示与表情切换
- [ ] 对话气泡
- [ ] 拖拽、置顶
- [ ] 快捷键显隐

### Phase 3：主窗口
- [ ] 完整消息历史与 Markdown 渲染
- [ ] Session 管理
- [ ] 设置面板
- [ ] chat.abort 中断生成
- [ ] 附件收发

### Phase 4：语音与打磨
- [ ] 本地 TTS 集成
- [ ] ASR 语音输入
- [ ] 角色/立绘包管理
- [ ] 开机启动、系统托盘

## 本地开发环境

### 前置条件
- Node.js 20+
- Rust 工具链（rustup）
- Tauri CLI（`cargo install tauri-cli`）

### 连接 Gateway
开发时通过 SSH 隧道连接 VPS 上的 Gateway：
```bash
ssh -L 18789:127.0.0.1:18789 william@<VPS_IP>
```
客户端连接 `ws://127.0.0.1:18789`，与生产环境一致。

## 已知问题

- 新设备配对：`shouldSkipBackendSelfPairing` 对 gateway-client + backend 模式未生效，暂复用 OpenClaw 自身设备身份
- Backend 客户端同时收到 `agent` 和 `chat` 两种事件格式，需适配两种
