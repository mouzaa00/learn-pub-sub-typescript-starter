import amqp, { type ConfirmChannel } from "amqplib";
import {
  clientWelcome,
  commandSpam,
  commandStatus,
  getInput,
  printClientHelp,
  printQuit,
} from "../internal/gamelogic/gamelogic.js";
import {
  declareAndBind,
  SimpleQueueType,
  subscribeJSON,
} from "../internal/pubsub/consume.js";
import {
  ArmyMovesPrefix,
  ExchangePerilDirect,
  ExchangePerilTopic,
  GameLogSlug,
  PauseKey,
  WarRecognitionsPrefix,
} from "../internal/routing/routing.js";
import { GameState } from "../internal/gamelogic/gamestate.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import { commandMove } from "../internal/gamelogic/move.js";
import { handlerMove, handlerPause, handlerWar } from "./handlers.js";
import { publishJSON, publishMsgPack } from "../internal/pubsub/publish.js";
import type { GameLog } from "../internal/gamelogic/logs.js";

async function main() {
  const rabbitConnURL = "amqp://guest:guest@localhost:5672/";
  const conn = await amqp.connect(rabbitConnURL);
  console.log("Peril game client connected to RabbitMQ!");

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.on(signal, async () => {
      try {
        await conn.close();
        console.log("RabbitMQ connection closed.");
      } catch (err) {
        console.log("Error closing RabbitMQ connection:", err);
      } finally {
        process.exit(0);
      }
    });
  });

  const username = await clientWelcome();
  const publishCh = await conn.createConfirmChannel();

  await declareAndBind(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.Transient,
  );

  const gs = new GameState(username);
  await subscribeJSON(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.Transient,
    handlerPause(gs),
  );
  await subscribeJSON(
    conn,
    ExchangePerilTopic,
    `${ArmyMovesPrefix}.${username}`,
    `${ArmyMovesPrefix}.*`,
    SimpleQueueType.Transient,
    handlerMove(gs, publishCh),
  );
  await subscribeJSON(
    conn,
    ExchangePerilTopic,
    WarRecognitionsPrefix,
    `${WarRecognitionsPrefix}.*`,
    SimpleQueueType.Durable,
    handlerWar(gs, publishCh),
  );

  while (true) {
    const words = await getInput();

    if (words.length === 0) {
      continue;
    }

    const command = words[0];
    if (command === "spawn") {
      try {
        commandSpawn(gs, words);
      } catch (err) {
        console.log((err as Error).message);
      }
    } else if (command === "move") {
      try {
        const move = commandMove(gs, words);
        await publishJSON(
          publishCh,
          ExchangePerilTopic,
          `${ArmyMovesPrefix}.${username}`,
          move,
        );
      } catch (err) {
        console.log((err as Error).message);
      }
    } else if (command === "status") {
      commandStatus(gs);
    } else if (command === "help") {
      printClientHelp();
    } else if (command === "spam") {
      try {
        commandSpam(gs, words, publishCh);
      } catch (err) {
        console.log((err as Error).message);
      }
    } else if (command === "quit") {
      printQuit();
      process.exit(0);
    } else {
      console.log("unknown command run help");
    }
  }
}

export async function publishGameLog(
  ch: ConfirmChannel,
  username: string,
  message: string,
) {
  const gameLog: GameLog = {
    message: message,
    username: username,
    currentTime: new Date(),
  };
  const routingKey = `${GameLogSlug}.${username}`;
  await publishMsgPack(ch, ExchangePerilTopic, routingKey, gameLog);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
