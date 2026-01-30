import amqp, { type ConfirmChannel } from "amqplib";
import { publishJSON } from "../internal/pubsub/publish.js";
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  GameLogSlug,
  PauseKey,
} from "../internal/routing/routing.js";
import { getInput, printServerHelp } from "../internal/gamelogic/gamelogic.js";
import {
  SimpleQueueType,
  subscribeMsgPack,
} from "../internal/pubsub/consume.js";
import { handlerLog } from "./handlers.js";

async function main() {
  const rabbitConnURL = "amqp://guest:guest@localhost:5672/";
  const conn = await amqp.connect(rabbitConnURL);
  console.log("Peril game server connected to RabbitMQ!");

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

  const publishCh: ConfirmChannel = await conn.createConfirmChannel();
  await subscribeMsgPack(
    conn,
    ExchangePerilTopic,
    GameLogSlug,
    `${GameLogSlug}.*`,
    SimpleQueueType.Durable,
    handlerLog(),
  );

  // Used to run the server from a non-interactive source, like the multiserver.sh file
  if (!process.stdin.isTTY) {
    console.log("Non-interactive mode: skipping command input.");
    return;
  }
  printServerHelp();
  while (true) {
    const words = await getInput();
    if (words.length === 0) {
      continue;
    }

    const command = words[0];
    if (command === "pause") {
      console.log("Publishing paused game state");
      try {
        await publishJSON(publishCh, ExchangePerilDirect, PauseKey, {
          isPaused: true,
        });
      } catch (err) {
        console.error("Error publishing message:", err);
      }
    } else if (command === "resume") {
      console.log("Publishing resumed game state");
      try {
        await publishJSON(publishCh, ExchangePerilDirect, PauseKey, {
          isPaused: false,
        });
      } catch (err) {
        console.error("Error publishing message:", err);
      }
    } else if (command === "quit") {
      console.log("Exiting the program!");
      process.exit(0);
    } else {
      console.log("Unknown command run help");
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
