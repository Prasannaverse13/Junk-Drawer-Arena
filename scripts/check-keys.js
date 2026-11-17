// Quick check that the keys in .env work.  npm run check
import "dotenv/config";
import { AholoClient } from "../server/aholo.js";

if (!process.env.AHOLO_API_KEY) {
  console.log("AHOLO_API_KEY is missing in .env");
} else {
  try {
    const b = await new AholoClient().balance();
    console.log(`Lux3D key works. Credits: ${b.credits}`);
  } catch (e) {
    console.log(`Lux3D key failed: ${e.message}`);
  }
}

if (process.env.OPENAI_API_KEY) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-6-luna", max_completion_tokens: 200, messages: [{ role: "user", content: "Say ok" }] }),
  });
  console.log(r.ok ? `OpenAI key works with ${process.env.OPENAI_MODEL || "gpt-6-luna"}.` : `OpenAI key failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
} else {
  console.log("OPENAI_API_KEY is missing. The rules builder will make fighter cards.");
}
