import type {
  ArmyMove,
  RecognitionOfWar,
} from "../internal/gamelogic/gamedata.js";
import type {
  GameState,
  PlayingState,
} from "../internal/gamelogic/gamestate.js";
import { handleMove, MoveOutcome } from "../internal/gamelogic/move.js";
import { handlePause } from "../internal/gamelogic/pause.js";
import { AckType } from "../internal/pubsub/consume.js";
import type { ConfirmChannel } from "amqplib";
import { publishJSON } from "../internal/pubsub/publish.js";
import {
  ExchangePerilTopic,
  WarRecognitionsPrefix,
} from "../internal/routing/routing.js";
import { handleWar, WarOutcome } from "../internal/gamelogic/war.js";
import { publishGameLog } from "./index.js";

export function handlerPause(gs: GameState): (ps: PlayingState) => AckType {
  return (ps) => {
    handlePause(gs, ps);
    process.stdout.write("> ");
    return AckType.Ack;
  };
}

export function handlerMove(
  gs: GameState,
  publishCh: ConfirmChannel,
): (move: ArmyMove) => Promise<AckType> {
  return async (move) => {
    try {
      const moveOutcome = handleMove(gs, move);
      if (moveOutcome === MoveOutcome.Safe) {
        return AckType.Ack;
      } else if (moveOutcome === MoveOutcome.MakeWar) {
        const warRecognition: RecognitionOfWar = {
          attacker: move.player,
          defender: gs.getPlayerSnap(),
        };

        const routingKey = `${WarRecognitionsPrefix}.${gs.getUsername()}`;
        try {
          publishJSON(
            publishCh,
            ExchangePerilTopic,
            routingKey,
            warRecognition,
          );
        } catch (err) {
          console.error("Failed to publish war recognition:", err);
          return AckType.NackRequeue;
        }
        return AckType.Ack;
      } else {
        return AckType.NackDiscard;
      }
    } finally {
      process.stdout.write("> ");
    }
  };
}

export function handlerWar(
  gs: GameState,
  publishCh: ConfirmChannel,
): (war: RecognitionOfWar) => Promise<AckType> {
  return async (war: RecognitionOfWar): Promise<AckType> => {
    try {
      const outcome = handleWar(gs, war);

      let message: string;
      switch (outcome.result) {
        case WarOutcome.NotInvolved:
          return AckType.NackRequeue;
        case WarOutcome.NoUnits:
          return AckType.NackDiscard;
        case WarOutcome.YouWon:
          try {
            publishGameLog(
              publishCh,
              gs.getUsername(),
              `${war.attacker.username}  won a war against ${war.defender.username}`,
            );
          } catch (err) {
            console.error("Error publishing game log:", err);
            return AckType.NackRequeue;
          }
          return AckType.Ack;
        case WarOutcome.OpponentWon:
          try {
            publishGameLog(
              publishCh,
              gs.getUsername(),
              `${war.defender.username}  won a war against ${war.attacker.username}`,
            );
          } catch (err) {
            console.error("Error publishing game log:", err);
            return AckType.NackRequeue;
          }
          return AckType.Ack;
        case WarOutcome.Draw:
          try {
            publishGameLog(
              publishCh,
              gs.getUsername(),
              `A war between ${war.attacker.username} and ${war.defender.username} resulted in a draw`,
            );
          } catch (err) {
            console.error("Error publishing game log:", err);
            return AckType.NackRequeue;
          }
          return AckType.Ack;
        default:
          const unreachable: never = outcome;
          console.log("Unexpected war resolution: ", unreachable);
          return AckType.NackDiscard;
      }
    } finally {
      process.stdout.write("> ");
    }
  };
}
