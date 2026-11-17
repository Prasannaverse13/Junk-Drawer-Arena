// Make a few fighters from text so the arena has a roster before players arrive.
// Usage: npm run seed            (default list)
//        npm run seed -- "rubber duck" "cast iron pan"
// The server must be running.
import "dotenv/config";

const PORT = Number(process.env.PORT) || 8787;
const items = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["ceramic coffee mug", "rubber duck", "red sneaker", "cast iron frying pan"];

for (const label of items) {
  const fd = new FormData();
  fd.append("label", label);
  fd.append("player", "House");
  const r = await fetch(`http://localhost:${PORT}/api/fighters`, { method: "POST", body: fd });
  const j = await r.json();
  console.log(r.ok ? `queued ${label} -> ${j.id}` : `failed ${label}: ${j.error}`);
}
console.log("Watch progress on the arena screen.");
