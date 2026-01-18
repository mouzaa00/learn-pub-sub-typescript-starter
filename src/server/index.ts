import amqp from "amqplib";

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
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
