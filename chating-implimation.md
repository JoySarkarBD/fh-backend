# Farrior Homes — End-to-End Chat Integration Guide (Frontend)

This document provides a complete, step-by-step guide for frontend developers to integrate the real-time chat system for Farrior Homes. The system supports text messaging, persistent S3 attachments, forwarding, message redaction (unsend/delete), typing indicators, and read receipts.

---

## 1. Authentication & Connection Setup

The chat system requires a valid JWT token. 

### REST API Authentication
All HTTP requests to `/api/chat/*` must include the `Authorization: Bearer <token>` header.

### WebSocket Connection
Connect to the Socket.IO server under the `/chat` namespace. You **must** pass the JWT token in the connection handshake, otherwise the server will immediately drop the connection.

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:5000/chat", {
  auth: {
    token: "YOUR_JWT_TOKEN_HERE" // Required!
  },
  transports: ["websocket"] 
});

socket.on("connect", () => {
  console.log("Connected to chat server!");
});

socket.on("error", (err) => {
  console.error("Socket error:", err.message);
});
```

---

## 2. Managing Conversations

Before you can chat, you need to load the user's conversations or start a new one.

### Get All Conversations
Fetch the list of conversations the current user is a part of. This is usually displayed in the left sidebar.

- **Endpoint:** `GET /api/chat/conversations`
- **Response:**
  ```json
  [
    {
      "_id": "conversation-id-1",
      "participants": ["user-id-1", "user-id-2"],
      "lastMessage": "Sounds good!",
      "lastMessageAt": "2026-03-09T10:00:00.000Z",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
  ```

### Start a New Conversation
To start a chat with someone (or multiple people), send a request with their User IDs. If a 1-on-1 conversation already exists, the backend will simply return the existing one.

- **Endpoint:** `POST /api/chat/conversations`
- **Payload:**
  ```json
  {
    "participantIds": ["target-user-id-here"]
  }
  ```

---

## 3. Loading Message History (Cursor Pagination)

When a user clicks on a conversation, fetch the historical messages. The system uses **cursor-based pagination** for high performance.

- **Endpoint:** `GET /api/chat/messages?conversationId=<CONVERSATION_ID>&limit=20`

### Pagination Logic:
1. **First Load:** Call the endpoint without a `cursor`. You will get the most recent 20 messages.
2. **Scrolling Up:** Look at the `nextCursor` value returned by the server. To load older messages, pass it in your next request: 
   `GET /api/chat/messages?conversationId=<ID>&limit=20&cursor=<NEXT_CURSOR>`
3. **End of History:** Stop fetching when `nextCursor` is `null`.

**Response Format:**
```json
{
  "messages": [
    {
      "_id": "message-id",
      "conversationId": "conversation-id",
      "senderId": "user-id",
      "message": "Hello!",
      "attachments": [],
      "status": "sent",
      "isForwarded": false,
      "isUnsent": false,
      "deletedForUsers": [],
      "createdAt": "2026-03-09T10:05:00.000Z"
    }
  ],
  "nextCursor": "2026-03-09T10:04:00.000Z",
  "count": 20
}
```

> **UI Note:** Filter out any messages where your own `userId` exists inside the `deletedForUsers` array (these are messages you chose to "Delete for me").

---

## 4. Real-Time Socket Events

Once a conversation is opened, join the specific room to receive real-time streams.

### Join a Room
**Must be called every time the user opens a chat window.**
```javascript
socket.emit("joinConversation", { conversationId: "YOUR_CONVERSATION_ID" });

// Listen for confirmation
socket.on("joinedRoom", (data) => { ... });
```

### Sending a Message
Messages are immediately broadcasted to everyone in the room.

```javascript
socket.emit("sendMessage", {
  conversationId: "YOUR_CONVERSATION_ID",
  message: "Hey, check out these files!",
  attachments: [ // Optional
    {
      key: "s3/folder/file123.jpg",
      url: "https://your-s3-bucket.../file123.jpg",
      mimeType: "image/jpeg",
      size: 102450
    }
  ]
});
```

### Receiving a Message
Listen for incoming messages (this includes messages YOU just sent, enabling optimistic UI updates instantly).

```javascript
socket.on("messageReceived", (message) => {
  // Append to your local message state array
  console.log("New message:", message);
});
```

---

## 5. Advanced Message Actions

### Forwarding a Message
Forwarding reuses the `sendMessage` event. Pass the exact same attachments from the original message, plus forwarding metadata. This prevents duplicating files in S3.

```javascript
socket.emit("sendMessage", {
  conversationId: "TARGET_CONVERSATION_ID",
  message: "Original message text",
  attachments: [ /* exact same attachment objects as original */ ],
  isForwarded: true,
  originalMessageId: "ORIGINAL_MSG_ID",
  forwardedBy: "YOUR_USER_ID"
});
```

### Unsend Message (Delete for Everyone)
Replaces the text with "This message was unsent" and permanently deletes associated attachments from S3 (if not forwarded elsewhere).
```javascript
socket.emit("unsendMessage", { 
  conversationId: "CONVERSATION_ID", 
  messageId: "MESSAGE_ID" 
});

// Listener:
socket.on("messageUnsent", (data) => {
  // Update UI: Find message by data.messageId, clear text, remove attachments, set isUnsent = true
});
```

### Delete Message (For Me Only)
Hides the message from the current user's screen but leaves it for others.
```javascript
socket.emit("deleteForMe", { 
  conversationId: "CONVERSATION_ID", 
  messageId: "MESSAGE_ID" 
});

// Listener:
socket.on("messageDeletedForMe", (data) => {
  // Update UI: Remove message by data.messageId from local state completely
});
```

### Remove Single Attachment
Deletes an attachment from a specific message without deleting the whole message text.
```javascript
socket.emit("removeAttachment", { 
  conversationId: "CONVERSATION_ID", 
  messageId: "MESSAGE_ID",
  attachmentKey: "s3/folder/file123.jpg"
});

// Listener:
socket.on("attachmentRemoved", (data) => {
  // Update UI: Find message, remove attachment matching data.attachmentKey
});
```

---

## 6. Typing Indicators & Read Receipts

### Typing
Typing indicators use Redis and automatically expire after 5 seconds to prevent ghost typing.

```javascript
// User starts typing
socket.emit("typingStart", { conversationId: "CONVERSATION_ID" });

// User stops typing (or blur input)
socket.emit("typingStop", { conversationId: "CONVERSATION_ID" });

// Listeners:
socket.on("typingStart", (data) => {
  // Show "User [data.userId] is typing..."
});

socket.on("typingStop", (data) => {
  // Hide typing indicator for [data.userId]
});
```

### Mark as Seen
Inform the room that the user has read the messages.

```javascript
socket.emit("markSeen", { conversationId: "CONVERSATION_ID" });

// Listener:
socket.on("markedSeen", (data) => {
  // data contains { conversationId, seenBy, seenAt }
  // Update message status checkmarks in UI
});
```

---

## 7. Typical Frontend Component Flow

1. **Mount App:** Initialize Socket.IO with JWT.
2. **Side Panel:** Fetch `GET /api/chat/conversations`. Render list.
3. **Select Chat:**
   - Call `GET /api/chat/messages?conversationId=...`
   - Render messages (scroll to bottom).
   - Emit `joinConversation` via Socket.
4. **Chatting:** 
   - User types -> emits `typingStart`.
   - User stops -> emits `typingStop`.
   - User hits Send -> optionally uploads files to S3 first, then emits `sendMessage` with S3 URLs.
   - Listen to `messageReceived` -> append to list -> scroll to bottom.
5. **Scroll Up:** Fetch older messages using `nextCursor` until `null`.
6. **Actions:** Implement context menus for Forward, Unsend, Delete, utilizing the specific Socket endpoints.
