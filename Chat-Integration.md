# Chat System Integration Guide

> This document describes the **complete backend architecture** of the chat system and provides a **step-by-step reference** for frontend developers to integrate every feature correctly.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication](#2-authentication)
3. [Socket.IO Connection](#3-socketio-connection)
4. [REST API Endpoints](#4-rest-api-endpoints)
5. [Socket Events Reference](#5-socket-events-reference)
6. [File Uploads](#6-file-uploads)
7. [Presence & Typing Indicators](#7-presence--typing-indicators)
8. [Message Lifecycle](#8-message-lifecycle)
9. [Pagination Strategy](#9-pagination-strategy)
10. [Rate Limiting & Security](#10-rate-limiting--security)
11. [RabbitMQ & Persistence](#11-rabbitmq--persistence)
12. [Frontend Integration Checklist](#12-frontend-integration-checklist)

---

## 1. Architecture Overview

```
Browser / Client
     │
     ├── REST HTTP (JWT in header)         → NestJS Controller → MongoDB
     │       POST /chat/conversations
     │       GET  /chat/conversations
     │       GET  /chat/messages
     │       POST /chat/upload
     │
     └── Socket.IO  /chat  (JWT in auth)   → NestJS Gateway
             sendMessage       ──► RabbitMQ ──► Consumer ──► MongoDB (batched)
             joinConversation               ──► Redis (room tracking)
             typingStarted/Stopped         ──► Redis (5-second TTL)
             markSeen                      ──► MongoDB (direct)
             unsendMessage                 ──► RabbitMQ
             deleteForMe                   ──► RabbitMQ
             removeAttachment              ──► RabbitMQ + S3
```

**Stack:** NestJS · Socket.IO · MongoDB (Mongoose) · Redis (ioredis) · RabbitMQ · AWS S3

---

## 2. Authentication

All HTTP endpoints require a **JWT Bearer token** in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

The Socket.IO connection also requires a JWT — passed in the **handshake auth object**:

```ts
const socket = io('http://your-backend/chat', {
  auth: { token: accessToken },
});
```

> If the token is missing or expired, the server immediately emits an `error` event and disconnects the socket.

---

## 3. Socket.IO Connection

### Namespace

Always connect to the `/chat` namespace, not the root namespace.

```ts
import { io } from 'socket.io-client';

const socket = io(`${BACKEND_URL}/chat`, {
  auth: { token: localStorage.getItem('accessToken') },
  transports: ['websocket'],        // websocket preferred
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});
```

### Connection Events to Handle

| Event | Direction | Description |
|---|---|---|
| `connect` | Server → Client | Socket connected successfully |
| `disconnect` | Server → Client | Socket disconnected |
| `error` | Server → Client | JWT invalid, rate-limited, or validation failure |

---

## 4. REST API Endpoints

> All endpoints require `Authorization: Bearer <token>` header.

### 4.1 Create or Get Conversation

```
POST /api/chat/conversations
```

**Request Body:**
```json
{
  "participantIds": ["<userId>"],
  "propertyId": "<propertyId>"   // optional
}
```

**Response:** The `Conversation` object.

- For 1-on-1 chats, if a conversation already exists between the two users it is **returned** (not duplicated).
- The authenticated user is **automatically added** as a participant.

---

### 4.2 List Conversations (Paginated)

```
GET /api/chat/conversations
GET /api/chat/conversations?cursor=<ISO>&limit=20
```

**Query Params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `cursor` | ISO-8601 string | — | Oldest `lastMessageAt` from previous page |
| `limit` | number | 20 | Max 50 |

**Response:**
```json
{
  "conversations": [ ... ],
  "nextCursor": "2024-01-15T10:30:00.000Z",
  "hasMore": true
}
```

**Conversation Object Shape:**
```ts
{
  _id: string;
  participants: [{ _id, name, email, profileImage, isOnline, lastActiveAt }];
  property: { _id, propertyName, address, price, ... } | null;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
}
```

**Frontend usage (infinite scroll):**
```ts
// First load — no cursor
GET /api/chat/conversations

// On user scroll to bottom — pass nextCursor
GET /api/chat/conversations?cursor=2024-01-15T10:30:00.000Z
```

---

### 4.3 Get Messages (Paginated)

```
GET /api/chat/messages?conversationId=<id>&limit=20
GET /api/chat/messages?conversationId=<id>&cursor=<ISO>&limit=20
```

**Query Params:**

| Param | Type | Required | Default |
|---|---|---|---|
| `conversationId` | MongoDB ObjectId | ✅ | — |
| `cursor` | ISO-8601 string | — | — |
| `limit` | number | — | 20 (max 50) |

**Response:**
```json
{
  "messages": [ ... ],
  "nextCursor": "2024-01-10T08:00:00.000Z",
  "count": 20
}
```

**Message Object Shape:**
```ts
{
  _id: string;
  conversationId: string;
  senderId: string;
  message: string;          // empty string if isUnsent = true
  attachments: ChatAttachment[];
  status: "sent" | "delivered" | "seen";
  isForwarded: boolean;
  originalMessageId: string | null;
  forwardedBy: string | null;
  isUnsent: boolean;
  createdAt: string;        // ISO-8601
}
```

**Pagination — scroll UP to load older messages:**
```ts
// First load (bottom of chat)
GET /api/chat/messages?conversationId=xxx

// User scrolls up — request older messages
GET /api/chat/messages?conversationId=xxx&cursor=<nextCursor from prev response>
```

---

## 5. Socket Events Reference

### Events: Client → Server (emit)

#### `joinConversation`
Must be emitted every time the user opens a conversation. Subscribes the socket to the conversation room.

```ts
socket.emit('joinConversation', { conversationId: string });
```

Server responds with: `joinedRoom`

---

#### `sendMessage`
Send a new chat message. Attachments must be uploaded first via `POST /api/chat/upload`.

```ts
socket.emit('sendMessage', {
  conversationId: string;
  message: string;               // can be empty if attachments provided
  attachments?: ChatAttachment[]; // obtained from /chat/upload
  // For forwarding:
  isForwarded?: boolean;
  originalMessageId?: string;
  forwardedBy?: string;
});
```

Server broadcasts: `messageReceived` to all room members.

---

#### `markSeen`
Mark all messages in a conversation as seen by the current user.

```ts
socket.emit('markSeen', { conversationId: string });
```

Server broadcasts: `markedSeen` to room.

---

#### `typingStarted`
Notify others the user has started typing.

```ts
socket.emit('typingStarted', { conversationId: string });
```

---

#### `typingStopped`
Notify others the user stopped typing.

```ts
socket.emit('typingStopped', { conversationId: string });
```

---

#### `unsendMessage`
Unsend a message for everyone (only the sender can do this).

```ts
socket.emit('unsendMessage', {
  conversationId: string;
  messageId: string;
});
```

Server broadcasts: `messageUnsent` to room.

---

#### `deleteForMe`
Delete a message from the current user's view only. Other participants still see it.

```ts
socket.emit('deleteForMe', {
  conversationId: string;
  messageId: string;
});
```

Server emits: `messageDeletedForMe` back to the requesting socket only.

---

#### `removeAttachment`
Remove a single attachment from a message (only sender can do this).

```ts
socket.emit('removeAttachment', {
  conversationId: string;
  messageId: string;
  attachmentKey: string;  // S3 key of the attachment
});
```

Server broadcasts: `attachmentRemoved` to room.

---

### Events: Server → Client (listen)

| Event | Payload | When |
|---|---|---|
| `joinedRoom` | `{ conversationId, room }` | After `joinConversation` succeeds |
| `messageReceived` | `MessagePayload` | New message sent by any participant |
| `messageUnsent` | `{ conversationId, messageId, userId }` | Message was unsent by sender |
| `messageDeletedForMe` | `{ conversationId, messageId }` | Delete for me confirmed (sent only to you) |
| `attachmentRemoved` | `{ conversationId, messageId, attachmentKey }` | Attachment removed from message |
| `markedSeen` | `{ conversationId, seenBy, seenAt }` | Another user marked messages as seen |
| `presenceUpdated` | `{ userId, isOnline, lastActiveAt }` | User went online or offline |
| `typingStarted` | `{ conversationId, userId }` | Someone started typing |
| `typingStopped` | `{ conversationId, userId }` | Someone stopped typing |
| `error` | `{ message: string }` | Rate limit hit, auth error, or validation fail |

---

## 6. File Uploads

Files must be uploaded **before** sending a message. The upload returns `ChatAttachment[]` objects which you then pass into `sendMessage`.

```
POST /api/chat/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

Body: files[] (up to 10 files, max 50 MB each)
```

**Allowed file types:**
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `image/bmp`
- Documents: `application/pdf`
- Word: `.doc`, `.docx`
- PowerPoint: `.ppt`, `.pptx`
- Excel: `.xls`, `.xlsx`

**Response:**
```json
{
  "urls": [
    {
      "key": "chat/uploads/filename.pdf",
      "url": "https://s3.amazonaws.com/bucket/chat/uploads/filename.pdf",
      "mimeType": "application/pdf",
      "size": 102400,
      "uploadedBy": "<userId>",
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

**Frontend flow:**
```ts
// Step 1: Upload files
const result = await uploadChatFiles(selectedFiles);
const attachments = result.data.urls;

// Step 2: Send message with attachments
socket.emit('sendMessage', {
  conversationId,
  message: 'See attached',
  attachments,
});
```

**Frontend validation (enforce before upload):**
- Max file size: **50 MB** per file
- Only allowed MIME types (same list as above)

---

## 7. Presence & Typing Indicators

### Online Presence

- When a user connects, the server broadcasts `presenceUpdated` with `isOnline: true`.
- When a user disconnects, **only if they have no more active sockets** (multiple tabs), the server broadcasts `presenceUpdated` with `isOnline: false` and a `lastActiveAt` timestamp.
- Presence state is stored in Redis with 24-hour TTL.

**Frontend — listen globally:**
```ts
socket.on('presenceUpdated', ({ userId, isOnline, lastActiveAt }) => {
  // Update the online indicator for that user in the conversation list
});
```

### Typing Indicators

- Frontend emits `typingStarted` on every keypress (debounced).
- Frontend emits `typingStopped` after 2 seconds of no typing (or on send).
- Server stores typing state in Redis with **5-second auto-expiry** (crash-safe).
- Server broadcasts `typingStarted` / `typingStopped` to room excluding the sender.

**Frontend pattern:**
```ts
let typingTimeout: ReturnType<typeof setTimeout> | null = null;

function handleKeyPress() {
  socket.emit('typingStarted', { conversationId });

  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typingStopped', { conversationId });
  }, 2000);
}

// On unmount — IMPORTANT to prevent memory leak
useEffect(() => {
  return () => {
    if (typingTimeout) clearTimeout(typingTimeout);
  };
}, []);
```

---

## 8. Message Lifecycle

```
User types → emit sendMessage
    │
    ├─ Backend rate limit check (Redis sliding window: 20 msg / 10s)
    ├─ XSS sanitization (HTML tags stripped)
    ├─ Participant validation
    ├─ Build MessagePayload with generated _id + timestamp
    ├─ Enqueue to RabbitMQ → returns immediately (non-blocking)
    └─ Broadcast messageReceived to room (optimistic — shown instantly)

RabbitMQ Consumer (async):
    ├─ Buffer messages in memory (up to 3000 or 30 seconds)
    └─ Bulk insertMany to MongoDB + update conversation.lastMessage
```

### Optimistic UI Pattern

Because messages are broadcast immediately before MongoDB confirmation, the frontend should:

1. Show the message instantly in the UI (optimistic).
2. Listen to `messageReceived` to receive the server's canonical version (with `_id`).
3. Replace the optimistic version using the `_id` field.

---

## 9. Pagination Strategy

### Conversation List — Cursor: `lastMessageAt`

```
First load:    GET /api/chat/conversations
Next page:     GET /api/chat/conversations?cursor=<nextCursor>&limit=20
```

- Conversations sorted by `lastMessageAt` descending (most recent first).
- `nextCursor` = `lastMessageAt` of the last conversation on the page.
- `hasMore: false` means no more pages.

### Message History — Cursor: `createdAt`

```
First load (bottom):   GET /api/chat/messages?conversationId=xxx
Scroll up (older):     GET /api/chat/messages?conversationId=xxx&cursor=<nextCursor>
```

- Messages sorted by `createdAt` descending (newest first in each page).
- After fetching, **reverse** the array before displaying to show oldest at top.
- `nextCursor` = `createdAt` of the oldest message on the page.
- `nextCursor: null` means you have reached the oldest message.

---

## 10. Rate Limiting & Security

### Rate Limiting

- **20 messages per 10 seconds** per user (sliding window via Redis).
- Applies to the `sendMessage` socket event only.
- If exceeded, the server emits an `error` event to the client.

```ts
socket.on('error', ({ message }) => {
  if (message.includes('too fast')) {
    showToast('You are sending messages too quickly!');
  }
});
```

### XSS Prevention

- All message text is sanitized server-side using `sanitize-html`.
- All HTML tags and attributes are **stripped** before storing or broadcasting.
- The frontend should **not** render message text as raw HTML — use plain text rendering only.

### CORS

- Socket.IO only accepts connections from `FRONTEND_BASE_URL` environment variable.
- REST API also enforces CORS via the same variable.

---

## 11. RabbitMQ & Persistence

The following events are queued to RabbitMQ for async processing:

| Event | Queue Pattern | Description |
|---|---|---|
| `sendMessage` | `chat_message` | New message to persist |
| `unsendMessage` | `message_unsent` | Unsend a message |
| `deleteForMe` | `message_deleted_for_me` | Delete message for one user |
| `removeAttachment` | `attachment_deleted` | Remove & possibly delete S3 file |

**Consumer behaviour:**
- Buffers up to **3,000 messages** in memory.
- Flushes to MongoDB every **30 seconds** or when buffer is full.
- Uses `insertMany` with `ordered: false` (partial success is acceptable).
- Failed messages are retried up to **3 times**, then permanently dropped (dead-lettered).
- On graceful shutdown (`SIGTERM`), remaining buffer is flushed before exit.

> **Important:** There is a ~30-second window where a message exists only in memory. If the server crashes before a flush, those messages are lost. For production, configure a **RabbitMQ Dead Letter Exchange** at the broker level for cross-pod safety.

---

## 12. Frontend Integration Checklist

### Setup

- [ ] Create socket instance targeting `<BACKEND_URL>/chat` namespace
- [ ] Pass `{ auth: { token } }` in socket options
- [ ] Handle `connect`, `disconnect`, `error` events
- [ ] Reconnect automatically (`reconnection: true`)

### Conversation List

- [ ] `GET /api/chat/conversations` on page load (first 20)
- [ ] Implement infinite scroll — load next page on sentinel element visibility
- [ ] Listen to `conversationUpdated` or refresh after `messageReceived` to update `lastMessage`

### Opening a Chat

- [ ] Emit `joinConversation` when user opens a conversation
- [ ] Emit `markSeen` when conversation is opened
- [ ] `GET /api/chat/messages?conversationId=xxx` for initial message history

### Sending Messages

- [ ] If files selected → `POST /api/chat/upload` → receive `attachments[]`
- [ ] Validate file size ≤ 50 MB and type before upload (client-side)
- [ ] Emit `sendMessage` with `{ conversationId, message, attachments? }`
- [ ] Show message optimistically; update with server's version on `messageReceived`

### Receiving Messages

- [ ] Listen to `messageReceived` — prepend to message list
- [ ] Update `lastMessage` preview in conversation list
- [ ] Scroll to bottom if user is already at bottom

### Typing Indicators

- [ ] Emit `typingStarted` on input keypress (debounced)
- [ ] Emit `typingStopped` after 2s idle or on send
- [ ] **Clear timeout on component unmount** (memory leak prevention)
- [ ] Listen to `typingStarted` / `typingStopped` — show "User is typing…"

### Message Actions

| Action | How |
|---|---|
| Unsend (for everyone) | `socket.emit('unsendMessage', { conversationId, messageId })` |
| Delete for me | `socket.emit('deleteForMe', { conversationId, messageId })` |
| Forward | `socket.emit('sendMessage', { ..., isForwarded: true, originalMessageId, forwardedBy })` |
| Remove attachment | `socket.emit('removeAttachment', { conversationId, messageId, attachmentKey })` |

### Presence

- [ ] Listen to `presenceUpdated` globally (not per-conversation)
- [ ] Update online dot indicator for that user everywhere in UI
- [ ] Show `lastActiveAt` timestamp when user is offline

### Error Handling

- [ ] Listen to `error` events from socket — show toast/alert
- [ ] Catch HTTP errors from REST API — show user-friendly message
- [ ] `sendMessage` HTTP fallback when socket is disconnected

---

## Data Types Reference

```ts
type ChatAttachment = {
  key: string;          // S3 object key
  url: string;          // CDN URL
  mimeType: string;
  size: number;         // bytes
  uploadedBy: string;   // userId
  createdAt: string;    // ISO-8601
};

type ChatMessage = {
  _id: string;
  conversationId: string;
  senderId: string;
  message: string;
  attachments: ChatAttachment[];
  status: 'sent' | 'delivered' | 'seen';
  isForwarded: boolean;
  originalMessageId: string | null;
  forwardedBy: string | null;
  isUnsent: boolean;
  createdAt: string;
};

type ChatConversation = {
  _id: string;
  participants: ChatParticipant[];
  property: ChatProperty | null;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
};

type ChatParticipant = {
  _id: string;
  name?: string;
  email?: string;
  profileImage?: string;
  isOnline?: boolean;
  lastActiveAt?: string | null;
};
```

---

*Last updated: March 2026 — Farrior Homes Chat System v2*
