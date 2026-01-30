import amqp, { type Channel } from "amqplib";
import { DeadLetterExchange } from "../routing/routing.js";
import { decode } from "@msgpack/msgpack";

export enum AckType {
  Ack,
  NackDiscard,
  NackRequeue,
}

export enum SimpleQueueType {
  Durable,
  Transient,
}

export async function declareAndBind(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
): Promise<[Channel, amqp.Replies.AssertQueue]> {
  const ch = await conn.createChannel();

  const queue = await ch.assertQueue(queueName, {
    durable: queueType === SimpleQueueType.Durable,
    exclusive: queueType === SimpleQueueType.Transient,
    autoDelete: queueType === SimpleQueueType.Transient,
    arguments: {
      "x-dead-letter-exchange": DeadLetterExchange,
    },
  });

  await ch.bindQueue(queue.queue, exchange, key);
  return [ch, queue];
}

export async function subscribe<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  routingKey: string,
  simpleQueueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType,
  unmarshaller: (data: Buffer) => T,
): Promise<void> {
  const [ch, queue] = await declareAndBind(
    conn,
    exchange,
    queueName,
    routingKey,
    simpleQueueType,
  );
  await ch.prefetch(10);

  await ch.consume(
    queue.queue,
    async function (msg: amqp.ConsumeMessage | null) {
      if (!msg) return;

      let data: T;
      try {
        data = unmarshaller(msg.content);
      } catch (err) {
        console.error("Could not unmarshal message:", err);
        return;
      }

      try {
        const result = await handler(data);
        switch (result) {
          case AckType.Ack:
            ch.ack(msg);
            break;
          case AckType.NackDiscard:
            ch.nack(msg, false, false);
            break;
          case AckType.NackRequeue:
            ch.nack(msg, false, true);
            break;
          default:
            const unreachable: never = result;
            console.error("Unexpected ack type:", unreachable);
            return;
        }
      } catch (err) {
        console.error("Error handling message:", err);
        ch.nack(msg, false, false);
        return;
      }
    },
    { noAck: false },
  );
}

export async function subscribeJSON<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType,
): Promise<void> {
  subscribe(conn, exchange, queueName, key, queueType, handler, (data) =>
    JSON.parse(data.toString()),
  );
}

export async function subscribeMsgPack<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType,
): Promise<void> {
  subscribe(
    conn,
    exchange,
    queueName,
    key,
    queueType,
    handler,
    (data) => decode(data) as T,
  );
}
