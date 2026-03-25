# ClawTachie Plan

## Purpose

This plan tracks the next practical work items for ClawTachie based on two realities:

1. ClawTachie is no longer missing a basic desktop chat shell.
2. ClawTachie can only expose capabilities that OpenClaw Gateway actually provides over WebSocket.

The planning goal is to avoid designing UI around imaginary backend methods.

## Planning Constraints

These constraints should be treated as current operating assumptions until re-verified against the OpenClaw docs or protocol schema.

### Confirmed OpenClaw Gateway chat surface

- Documented chat methods used by official OpenClaw UIs: `chat.history`, `chat.send`, `chat.abort`, `chat.inject`
- Chat streams over `chat` and `agent` events
- Aborted partial assistant output can still be persisted into transcript history
- `chat.send` is non-blocking and returns immediately while output streams later

### Confirmed OpenClaw admin / operator surface

- Session controls: `sessions.list`, `sessions.patch`
- Debug and runtime inspection: `status`, `health`, `models.list`, `logs.tail`, `system-presence`
- Config management: `config.get`, `config.set`, `config.patch`, `config.apply`, `config.schema`
- Channel management: `channels.status`, `web.login.*`
- Tool approval management: `exec.approvals.*`
- Skills and automation: `skills.*`, `cron.*`, `node.list`, `update.run`

### Constraints that matter for ClawTachie UX

- There is no documented dedicated WebSocket method for deleting a single transcript message.
- There is no documented dedicated WebSocket method for “regenerate previous answer” as a first-class server action.
- “Edit and resend” can be implemented as a client workflow, but not as a true server-side transcript rewrite unless a supported method is found later.
- The current ClawTachie send path only sends plain text even though local types reserve `attachments`.
- ClawTachie settings are mostly local persisted settings today, not a mirrored OpenClaw config editor.

## Product Snapshot

ClawTachie currently provides:

- Main chat window plus optional pet window
- Session listing, switching, creation, rename, reset, delete
- Streaming output, stop generation, history loading
- Markdown and LaTeX rendering
- Session-level model editing
- Local TTS integration
- Pet visibility, sprite scaling, updater settings

This is enough for a usable desktop chatbot. The next stage should focus on:

1. Better conversation UX within the real Gateway surface
2. A real operator-grade settings and control UI for OpenClaw
3. Better local character and voice quality

## Strategy

ClawTachie should now advance along two primary tracks.

### Track A - Conversation Experience

This track improves the chat experience without pretending the backend supports transcript mutation that it does not expose.

#### A1. Message actions that fit current Gateway semantics

Priority: P0

- Add copy message
- Add readable timestamps
- Add failed-send feedback and retry
- Add “resend last user turn”
- Add “regenerate” as a client-side resend of the latest user prompt into a new run
- Add “edit previous user input and send as a new turn”

Important limitation:

- These are UX conveniences, not true server-side message deletion or in-place history editing.

#### A2. Attachment and image input

Priority: P0

- Phase 1: image-first MVP in main window
- Add picker-based image attach
- Add paste image support
- Add pre-send preview and remove
- Parse history image blocks back into UI cards
- Show image attachments in message bubbles for both optimistic send and restored history

Confirmed protocol note:

- OpenClaw upstream currently accepts `chat.send.attachments` for images as objects shaped like `type`, `mimeType`, `fileName`, `content`, where `content` is base64 payload.
- ClawTachie should align with that upstream shape instead of inventing a local attachment schema.

Important limitation:

- The first slice should stay image-only. PDF, Markdown, and audio should wait until the generic attachment rendering model and persistence behavior are proven stable.

Implementation follow-up after Phase 1:

- Phase 2: drag-and-drop and generic file cards
- Phase 3: audio card playback and richer document preview

#### A3. Conversation organization and recovery

Priority: P1

- Add session search
- Add session export to Markdown
- Add recent sessions / pinned sessions
- Add visible run state, error state, and recovery actions
- Add better tool / reasoning block readability

#### A4. Project-style workflow layer

Priority: P2

- Add a local “project” layer above sessions
- Store default model, prompt preset, voice preset, and character preset per project
- Group related sessions under one workspace

Important note:

- This can start as a ClawTachie-local concept even if OpenClaw itself has no first-class project object.

### Track B - Operator Control UI

This track is where ClawTachie can differentiate itself most strongly from a generic chatbot shell.

#### B1. OpenClaw config editor

Priority: P0

- Add a dedicated OpenClaw admin tab in Settings
- Read current config via `config.get`
- Render safe forms from `config.schema`
- Support raw JSON fallback editor
- Save small changes with `config.patch`
- Reserve `config.apply` for full replace / restart-required flows
- Show base-hash conflict warnings to avoid overwriting concurrent edits

This is the most important admin-facing capability because OpenClaw already exposes it officially.

#### B2. Runtime admin dashboard

Priority: P0

- Show `status` / `health`
- Show model inventory from `models.list`
- Show instance presence from `system-presence`
- Show channel status and QR/login actions from `channels.status` and `web.login.*`
- Show logs via `logs.tail`
- Show update capability if `update.run` is enabled

This turns ClawTachie from a chat skin into a real control panel.

#### B3. Exec approval management

Priority: P1

- Surface pending approvals
- Show gateway/node policy state
- Allow operator resolution from the UI
- Expose allowlist / ask policy controls clearly

This is a high-value use of administrator scope.

#### B4. Session and model controls

Priority: P1

- Replace free-text model input with `models.list` when available
- Expose session-level thinking / verbose / reasoning controls from `sessions.patch`
- Show effective session/runtime metadata more clearly

#### B5. Skills / cron / nodes management

Priority: P2

- Show skills status and enable/disable/install actions
- Show cron jobs and run history
- Show nodes and caps

## Character And Voice Direction

Character and voice should be treated as a first-class local product area, not only as OpenClaw configuration.

### C1. Character quality

Priority: P1

- Improve emotion mapping beyond raw inline tags
- Add better fallback behavior when the model emits no valid emotion tag
- Add per-character expression mapping profiles
- Add preview tooling for sprite packs and emotion coverage

### C2. Voice quality

Priority: P1

- Add voice preset management
- Add quick preview for a sample line before saving
- Add per-session or per-project voice selection
- Improve TTS error visibility and recovery

### C3. Gateway-aware voice options

Priority: P2

- Investigate whether OpenClaw `audio` / `talk` config should be surfaced in admin settings
- Only add Gateway-side voice controls if the exposed config schema is stable enough

## What We Should Not Assume

Do not plan UI around these as if they already exist:

- True transcript message deletion
- True in-place transcript editing
- Server-side regenerate by previous run id
- Agent list editing unless a stable documented API is confirmed
- Attachment support without confirming the exact Gateway attachment schema

## Recommended Next Slice

If only one slice should be implemented next, do this:

1. Add an OpenClaw admin settings section backed by `config.get` + `config.schema` + `config.patch`

Why:

- It directly uses confirmed Gateway capabilities
- It fits your “maximize admin power” direction
- It unlocks future work on models, channels, approvals, audio, and behavior tuning without inventing local-only copies first

If a second slice is taken immediately after:

2. Add message actions that stay within current chat semantics: copy, timestamp, retry, resend, client-side regenerate

If a third slice is taken after that:

3. Add attachment/image input after confirming the actual Gateway attachment payload schema

## Validation Standard

A task is complete only when all applicable checks pass:

1. The UI behavior works in a running Tauri session when the change is UI-facing
2. `npm run typecheck` passes
3. `npm run ui:build` passes for UI changes
4. Tauri-side changes are verified with runtime checks or `npm run tauri:build` when relevant
5. Gateway reconnect, session switching, and cross-window sync still behave coherently

## Source Notes

Planning assumptions above were aligned with the following OpenClaw docs on 2026-03-25:

- Gateway protocol: https://docs.openclaw.ai/gateway/protocol
- Gateway configuration and config RPC: https://docs.openclaw.ai/gateway/configuration
- Control UI capability surface: https://docs.openclaw.ai/web/control-ui
- WebChat behavior: https://docs.openclaw.ai/web/webchat
- Configure / model allowlist notes: https://docs.openclaw.ai/cli/configure
