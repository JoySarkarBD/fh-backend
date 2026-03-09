# Real-Time Chat System — Implementation (v3)

## Overview

The chat system is a highly scalable, real-time messaging architecture utilizing **NestJS**, **Socket.IO**, **RabbitMQ**, **Redis**, and **AWS S3**. 
It supports advanced features including persistent file attachments, message forwarding, optimistic UI updates, "unsend" functionality, user-specific message deletion, and ephemeral typing indicators.

---

## Architecture Flow

```text
Client
  │
  ▼  JWT auth on Socket.IO handshake
WebSocket Gateway
  │   Immediately emits `messageReceived`, `typingStart`, etc., back to room (optimistic UI)
  ▼
RabbitMQ Queues: (durable)
  │   ← ClientProxy.emit('chat_message', payload)
  │   ← ClientProxy.emit('message_unsent', payload)
  │   ← ...
  ▼
Chat Message Consumer  (@EventPattern('*'))
  │   Accumulates messages in memory buffer
  │   Resolves in-flight race conditions for mutations (unsend, delete)
  ▼
Flush Condition (either triggers flush):
  ├─ Buffer length ≥ 3000   ──┐
  └─ 30-second timer fires  ──┴──▶  MongoDB insertMany (batch write)
                                     + ACK each RabbitMQ message
```

### Infrastructure Roles

| Responsibility | Tool |
|---|---|
| High-throughput message ingestion & buffering | **RabbitMQ** |
| Real-time room broadcasting (Socket.IO adapter) | **Redis Pub/Sub** |
| Ephemeral typing indicators (5s TTL) | **Redis K/V** |
| Permanent File Storage | **AWS S3** |
| Primary Database (Conversations & Messages) | **MongoDB** |

---

## Supported Features & Socket Events

Clients must connect to the `/chat` namespace and provide a valid JWT token in the handshake payload (`auth: { token: '<JWT>' }`).

All rooms are strictly named `conversation:<conversationId>`. To receive messages, a client must first join the room.

### 1. Join Conversation
- **Event (Client → Server):** `joinConversation`
- **Payload:** `{ conversationId: string }`
- **Response (Server → Client):** `joinedRoom`

### 2. Send Message
- **Event (Client → Server):** `sendMessage`
- **Payload:**
  ```typescript
  {
    conversationId: string;
    message: string;
    attachments?: Array<{
      key: string;       // S3 Key
      url: string;       // S3 Public URL
      mimeType: string;
      size: number;
    }>;
  }
  ```
- **Response (Server → Room):** `messageReceived` (Includes the generated `_id` and full message payload)

### 3. Forward Message
Forwarding reuses the `sendMessage` event to prevent S3 duplication. The client passes the exact same attachment data along with forwarding metadata.
- **Event (Client → Server):** `sendMessage`
- **Payload:**
  ```typescript
  {
    conversationId: string;
    message: string;
    attachments?: AttachmentArray; // Reuse the identical attachments array
    isForwarded: true;
    originalMessageId: string;
    forwardedBy: string; // The user ID forwarding the message
  }
  ```
- **Response (Server → Room):** `messageReceived`

### 4. Unsend Message (Everyone)
Unsends a message for everyone in the room. The text is replaced, and any associated S3 attachments are permanently and safely deleted if they are not forwarded elsewhere.
- **Event (Client → Server):** `unsendMessage`
- **Payload:** `{ conversationId: string, messageId: string }`
- **Response (Server → Room):** `messageUnsent`

### 5. Delete Message (For Me)
Hides the message for the requesting user only. It remains visible to other participants.
- **Event (Client → Server):** `deleteForMe`
- **Payload:** `{ conversationId: string, messageId: string }`
- **Response (Server → Emitting Client Only):** `messageDeletedForMe`

### 6. Remove Attachment
Removes a specific attachment from a message. Like Unsend, it safely evaluates S3 keys and deletes the object from AWS if no other messages reference it.
- **Event (Client → Server):** `removeAttachment`
- **Payload:** `{ conversationId: string, messageId: string, attachmentKey: string }`
- **Response (Server → Room):** `attachmentRemoved`

### 7. Typing Indicators
Utilizes Redis with a 5-second TTL to ensure indicators do not get stuck if a client disconnects unexpectedly.
- **Event (Client → Server):** `typingStart` / `typingStop`
- **Payload:** `{ conversationId: string }`
- **Response (Server → Room):** `typingStart` / `typingStop` (Includes `userId`)

### 8. Mark Seen
Updates the read receipt status.
- **Event (Client → Server):** `markSeen`
- **Payload:** `{ conversationId: string }`
- **Response (Server → Room):** `markedSeen` (Includes `seenBy` and `seenAt`)

---

## Safe S3 Deletion Architecture

Because users can forward messages (which inherently reuses identical S3 files without duplicating them to save storage costs), we must be extremely careful when users "Unsend" or "Remove" an attachment.

All attachment-deletion workflows route through the `AttachmentService`:
1. The service searches the `Message` collection for any documents whose `attachments.key` matches the S3 file key.
2. If `count <= 1` (meaning only the current message being modified points to it), the file is safely deleted from AWS S3 using `@aws-sdk/client-s3`.
3. If `count > 1`, the file is left untouched in AWS, but the reference is successfully removed from the current message.

---

## Mutation Race Condition Handling

Because messages are bulk-inserted in increments up to 30 seconds via RabbitMQ, a user might send a message and quickly click "Unsend" before the message has even reached MongoDB.

To handle this cleanly:
1. All client mutations (`unsendMessage`, `deleteForMe`, `removeAttachment`) are pushed into RabbitMQ queues instead of updating the database directly.
2. The `ChatMessageConsumer` listens to these events.
3. Upon receiving a mutation request, the consumer first checks its **in-memory buffer**.
4. If the target message is still sitting in the buffer, it modifies the JavaScript object directly (e.g., setting `isUnsent = true`), preventing faulty data from ever hitting MongoDB.
5. If the target message is *not* in the buffer, it means it has already been flushed, and standard MongoDB `updateOne()` calls are executed via the `ChatService`.
