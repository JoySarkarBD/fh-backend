# Real-Time Chat System — Implementation Plan (v2)

## Overview

Integrate a production-ready real-time chat system into the existing backend.
Uses **RabbitMQ** for message queuing (mirrors the existing mail module pattern)
and **Redis** only for Pub/Sub room broadcasts.

---

## Architecture Flow

```
Client
  │
  ▼  JWT auth on Socket.IO handshake
WebSocket Gateway
  │   Immediately emits messageReceived back to room (optimistic UI)
  ▼
RabbitMQ Queue: "chat_message_queue" (durable)
  │   ← ClientProxy.emit('chat_message', payload)
  ▼
Chat Message Consumer  (@EventPattern('chat_message'))
  │   Accumulates messages in memory buffer
  ▼
Flush Condition (either triggers flush):
  ├─ Buffer length ≥ 3000   ──┐
  └─ 30-second timer fires  ──┴──▶  MongoDB insertMany (batch write)
                                     + ACK each RabbitMQ message
```

### Why RabbitMQ (not Redis Streams)?
- Already configured in the app (`RABBITMQ_URL`, `RABBITMQ_MAIL_QUEUE`)
- RabbitMQ gives durable queues, per-message ACK, DLQ support, and retry semantics out of the box
- Consistent with the `mail` module pattern (zero new infrastructure)
- Redis is kept lean — only used for Pub/Sub broadcasting

---

## Revised Redis Role

| Responsibility | Tool |
|---|---|
| Message queuing / buffering | **RabbitMQ** |
| Real-time room broadcasting | **Redis Pub/Sub** |
| Temporary user presence (optional) | **Redis** |

Redis memory safety:
- No messages stored in Redis (only pub/sub signals)
- Pub/Sub channels are ephemeral — no persistence, no unbounded growth
- `ioredis` TTL used only if presence tracking is added later

---

## New Packages Needed

```bash
@nestjs/websockets @nestjs/platform-socket.io socket.io ioredis
```
(`@nestjs/microservices` + `amqplib` + `amqp-connection-manager` already exist)

---

## Proposed Changes

### Config

#### [MODIFY] [app.config.ts](file:///e:/Office/6.%20Farrior%20Homes/backend/src/config/app.config.ts)
- Add `REDIS_URL`, `RABBITMQ_CHAT_QUEUE` fields

#### [MODIFY] [.env.example](file:///e:/Office/6.%20Farrior%20Homes/backend/.env.example)
- Add `REDIS_URL=redis://localhost:6379`
- Add `RABBITMQ_CHAT_QUEUE=chat_message_queue`

---

### Redis Module

#### [NEW] `src/redis/redis.module.ts`
- Global module; registers `ioredis` client as `REDIS_CLIENT` & `REDIS_SUBSCRIBER_CLIENT` tokens

#### [NEW] `src/redis/redis.service.ts`
- Wraps `publish(channel, message)`, `subscribe(channel, handler)` for Pub/Sub

---

### MongoDB Schemas

#### [NEW] `src/schemas/conversation.schema.ts`
Fields: `participants: ObjectId[]`, `lastMessage: string`, `lastMessageAt: Date`
Index: `{ participants: 1 }`, `{ lastMessageAt: -1 }`

#### [NEW] `src/schemas/message.schema.ts`
Fields: `conversationId: ObjectId`, `senderId: ObjectId`, `message: string`,
`attachments: string[]`, `status: 'sent'|'delivered'|'seen'`, `createdAt: Date`
Index: `{ conversationId: 1, createdAt: -1 }` (compound — enables fast cursor pagination)

---

### Chat DTOs & Interfaces

#### [NEW] `src/chat/dto/send-message.dto.ts`
#### [NEW] `src/chat/dto/get-messages.dto.ts`
#### [NEW] `src/chat/dto/create-conversation.dto.ts`
#### [NEW] `src/chat/interfaces/chat.interfaces.ts`

---

### Chat Services

#### [NEW] `src/chat/chat.service.ts`
- `createConversation(dto, userId)`
- `getUserConversations(userId)`
- `getMessages(dto)` — cursor-paginated MongoDB query
- `bulkSaveMessages(msgs[])` — `Model.insertMany()` with `ordered: false`

#### [NEW] `src/chat/services/redis-pubsub.service.ts`
- `publishToRoom(conversationId, event, data)` — publish to `chat:room:<id>`
- `subscribeToRoom(conversationId, handler)` — subscribe
- Used by Gateway to fan out messages across potential future instances

---

### RabbitMQ Producer + Consumer

**Pattern mirrors [MailService](file:///e:/Office/6.%20Farrior%20Homes/backend/src/mail/mail.service.ts#6-85) + [MailConsumer](file:///e:/Office/6.%20Farrior%20Homes/backend/src/mail/mail.consumer.ts#5-56) exactly.**

#### [NEW] `src/chat/services/chat-queue.service.ts`
- Injects `CHAT_SERVICE` (`ClientProxy`)
- `enqueueMessage(payload: MessagePayload)` — `this.client.emit('chat_message', payload)`

#### [NEW] `src/chat/consumers/chat-message.consumer.ts`
- `@Controller()` — consumed by the global RabbitMQ microservice in [main.ts](file:///e:/Office/6.%20Farrior%20Homes/backend/src/main.ts)
- `@EventPattern('chat_message')` handler:
  - Pushes message into in-memory buffer array
  - `channel.ack(originalMsg)` after push
  - Flushes buffer to MongoDB when `buffer.length >= 3000` OR `30s timer` fires
  - On `OnModuleInit`: starts the 30s interval timer
  - On `OnModuleDestroy`: flush remaining buffer, clearInterval

---

### WebSocket Gateway

#### [NEW] `src/chat/chat.gateway.ts`
- `@WebSocketGateway({ namespace: 'chat', cors: { origin: '*' } })`
- `handleConnection`: validates JWT from `socket.handshake.auth.token` using `JwtService.verify()`; disconnects if invalid
- `handleDisconnect`: cleanup logs
- `@SubscribeMessage('joinConversation')`: socket joins room `conversation:<conversationId>`
- `@SubscribeMessage('sendMessage')`:
  1. Validate payload
  2. `chatQueueService.enqueueMessage(payload)` → RabbitMQ
  3. `server.to('conversation:<id>').emit('messageReceived', {...payload, status:'sent'})` — optimistic broadcast
- `@SubscribeMessage('markSeen')`: emits status update to room

---

### REST Controller

#### [NEW] `src/chat/chat.controller.ts`
- `POST /api/chat/conversations` — create or find conversation
- `GET /api/chat/conversations` — list user's conversations (sorted by lastMessageAt)
- `GET /api/chat/messages?conversationId=xxx&cursor=ISO&limit=20`
  - Returns ≤ 20 messages older than `cursor`; includes `nextCursor` in response

---

### Chat Module

#### [NEW] `src/chat/chat.module.ts`
```
imports:
  MongooseModule (Conversation + Message schemas)
  ClientsModule (CHAT_SERVICE → RMQ chat_message_queue, durable: true)
  RedisModule
  JwtModule (for Gateway auth)

providers:
  ChatService, ChatQueueService, RedisPubSubService, ChatGateway

controllers:
  ChatController, ChatMessageConsumer
```

---

### App Integration

#### [MODIFY] [src/app.module.ts](file:///e:/Office/6.%20Farrior%20Homes/backend/src/app.module.ts)
- Add `ChatModule` to imports

#### [MODIFY] [src/main.ts](file:///e:/Office/6.%20Farrior%20Homes/backend/src/main.ts)
- Add `IoAdapter` (Socket.IO adapter): `app.useWebSocketAdapter(new IoAdapter(app))`
- Add second `connectMicroservice` for the chat RabbitMQ queue (`RABBITMQ_CHAT_QUEUE`, `durable: true`)

---

## Batch Flush Logic Detail

```
In-memory buffer: MessagePayload[]
Timer: runs every 30 seconds

On each new message from RabbitMQ:
  buffer.push(message)
  ack(originalMsg)   ← immediate ACK, safe because buffer is in-process

  if buffer.length >= 3000:
    await flushBuffer()

On timer tick:
  if buffer.length > 0:
    await flushBuffer()

flushBuffer():
  const batch = buffer.splice(0)  ← atomic swap
  await MessageModel.insertMany(batch, { ordered: false })
  logger.log(`Flushed ${batch.length} messages to MongoDB`)
```

> [!IMPORTANT]
> ACK happens before MongoDB write (after buffer push). If the process crashes between ACK and flush, messages in the buffer are lost. This is acceptable for a chat system. For zero message loss, move ACK to after MongoDB write — but this risks re-processing duplicates. For this design we optimize for throughput.

---

## Verification Plan

### Build Check
```bash
npx tsc --noEmit
```

### Functional Test
1. Start server: `npm run dev`
2. Connect a Socket.IO client with `auth: { token: '<JWT>' }`  
   to `ws://localhost:5000/chat`
3. Emit `joinConversation` → `{ conversationId: "<id>" }`
4. Emit `sendMessage` → `{ conversationId: "<id>", message: "Hello!" }`
5. Verify `messageReceived` event received in room
6. After ≤30s, verify message appears in MongoDB
7. Call `GET /api/chat/messages?conversationId=<id>&limit=20` and verify cursor pagination
