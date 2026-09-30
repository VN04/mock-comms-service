import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type Redis from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CallEvent,
  CallEventType,
  toCallEventResponse,
} from '../../common/call/call-event';
import { RedisChannels } from '../../common/constants/redis-keys';
import { WS_CALLS_PATH } from '../../common/constants/routes';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuthService } from '../auth/auth.service';
import { extractBearerToken } from '../auth/guards/auth.guard';
import { CallPresenter } from '../calls/call.presenter';
import { CallsService } from '../calls/calls.service';
import { CallUpdatesService } from './call-updates.service';

const PATH_PATTERN = new RegExp(
  `^${WS_CALLS_PATH}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
  'i',
);
const HEARTBEAT_MS = 30_000;

export class HandshakeError extends Error {
  constructor(
    readonly status: 401 | 404,
    message: string,
  ) {
    super(message);
  }
}

type LiveSocket = WebSocket & { isAlive?: boolean };

/**
 * WebSocket endpoint `ws(s)://host/ws/calls/:callId?token=<ws_token>`.
 *
 * Built on the plain `ws` library, attached to Nest's HTTP server, so any
 * standard WebSocket client works. Auth happens during the HTTP upgrade
 * handshake — unauthenticated sockets are never accepted. Accepts either the
 * per-call token from POST /calls or `Authorization: Bearer <API_KEY>`
 * (server-side clients).
 *
 * Messages: `{type:"snapshot", call}` on connect, then `{type:"event", event}`
 * for every lifecycle event. The socket closes once the recording is final.
 */
@Injectable()
export class CallUpdatesGateway
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CallUpdatesGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  /** callId → sockets watching it (the "rooms" of this instance). */
  private readonly rooms = new Map<string, Set<LiveSocket>>();
  private subscriber?: Redis;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly redis: RedisService,
    private readonly callUpdates: CallUpdatesService,
    private readonly auth: AuthService,
    private readonly calls: CallsService,
    private readonly presenter: CallPresenter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    server.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket, head);
    });

    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on('message', (_channel, message) =>
      this.dispatch(JSON.parse(message) as CallEvent),
    );
    await this.subscriber.subscribe(RedisChannels.callUpdates);

    this.heartbeat = setInterval(() => this.pingAll(), HEARTBEAT_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    for (const client of this.wss.clients)
      client.close(1001, 'Server shutting down');
    this.wss.close();
  }

  /** Validates the handshake and returns the call ID the client may watch. */
  async authorize(req: IncomingMessage): Promise<string> {
    const url = new URL(req.url ?? '/', 'http://placeholder');
    const callId = PATH_PATTERN.exec(url.pathname)?.[1];
    if (!callId) throw new HandshakeError(404, 'Not found');

    const token = url.searchParams.get('token');
    if (token) {
      const claims = await this.callUpdates.resolveToken(token);
      if (claims?.callId !== callId) {
        throw new HandshakeError(401, 'Invalid or expired token');
      }
      return callId;
    }

    const apiKeyRaw = extractBearerToken(req.headers.authorization);
    const apiKey = apiKeyRaw ? await this.auth.authenticate(apiKeyRaw) : null;
    if (!apiKey)
      throw new HandshakeError(401, 'Missing or invalid credentials');
    await this.calls.findAccessible(apiKey, callId).catch(() => {
      throw new HandshakeError(404, 'Call not found');
    });
    return callId;
  }

  private async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let callId: string;
    try {
      callId = await this.authorize(req);
    } catch (err) {
      const status = err instanceof HandshakeError ? err.status : 500;
      socket.end(
        `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\n\r\n`,
      );
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.onConnection(ws, callId);
    });
  }

  private async onConnection(ws: LiveSocket, callId: string): Promise<void> {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('close', () => this.leave(ws, callId));
    ws.on('error', () => this.leave(ws, callId));

    // Join BEFORE reading the snapshot so no event can fall in the gap;
    // clients use `sequence` / `last_event_sequence` to drop duplicates.
    this.join(ws, callId);
    const call = await this.calls.findById(callId); // access already checked
    if (!call) {
      ws.close(1008, 'Call not found');
      return;
    }
    this.send(ws, {
      type: 'snapshot',
      call: await this.presenter.present(call),
    });
  }

  /** Relays an event from Redis pub/sub to this instance's sockets for that call. */
  private dispatch(event: CallEvent): void {
    const sockets = this.rooms.get(event.callId);
    if (!sockets?.size) return;
    const message = { type: 'event', event: toCallEventResponse(event) };
    const isLast =
      event.type === CallEventType.RECORDING_UPLOAD_SUCCEEDED ||
      (event.type === CallEventType.RECORDING_UPLOAD_FAILED &&
        event.payload?.final === true);
    for (const ws of sockets) {
      this.send(ws, message);
      if (isLast) ws.close(1000, 'Call finished');
    }
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private join(ws: LiveSocket, callId: string): void {
    const room = this.rooms.get(callId) ?? new Set<LiveSocket>();
    room.add(ws);
    this.rooms.set(callId, room);
  }

  private leave(ws: LiveSocket, callId: string): void {
    const room = this.rooms.get(callId);
    room?.delete(ws);
    if (room && !room.size) this.rooms.delete(callId);
  }

  /** Drops connections that stopped answering pings (dead TCP peers). */
  private pingAll(): void {
    for (const client of this.wss.clients as Set<LiveSocket>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }
}
