import { createOpencodeClient } from "@rezrazi/opencode-sdk"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})

const session = await client.session.create()
if (!session.data) throw new Error("missing session data")
await client.session.prompt({
  path: { id: session.data.id },
  body: {
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    parts: [{ type: "text", text: "Hello from the SDK" }],
  },
})
