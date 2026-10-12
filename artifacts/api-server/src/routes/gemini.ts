import { ApiError, GoogleGenAI } from "@google/genai";
import { StreamGeminiChatBody } from "@workspace/api-zod";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

function extractProviderMessage(error: ApiError): string | undefined {
  const jsonStart = error.message.indexOf("{");
  if (jsonStart < 0) return undefined;

  try {
    const payload = JSON.parse(error.message.slice(jsonStart)) as {
      error?: { message?: unknown };
    };
    if (typeof payload.error?.message === "string") {
      return payload.error.message.slice(0, 300);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

router.post("/gemini/chat", async (req, res): Promise<void> => {
  const parsed = StreamGeminiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Gemini is not configured for this app." });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: parsed.data.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      config: { maxOutputTokens: 8192 },
    });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    for await (const chunk of stream) {
      const content = chunk.text;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && process.env.NODE_ENV === "development") {
      try {
        const availableGeminiModels: string[] = [];
        const modelPager = await ai.models.list({ config: { pageSize: 100 } });
        for await (const model of modelPager) {
          if (model.name?.includes("gemini")) {
            availableGeminiModels.push(model.name);
          }
          if (availableGeminiModels.length === 40) break;
        }
        req.log.warn(
          { availableGeminiModels },
          "Gemini model availability diagnostic",
        );
      } catch {
        req.log.warn("Could not retrieve Gemini model catalog");
      }
    }

    req.log.error(
      {
        errorType: error instanceof Error ? error.name : "unknown",
        status: error instanceof ApiError ? error.status : undefined,
        providerMessage: error instanceof ApiError ? extractProviderMessage(error) : undefined,
      },
      "Gemini chat request failed",
    );

    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({ error: "The response failed. Please try again." })}\n\n`,
      );
      res.end();
      return;
    }

    res.status(502).json({ error: "The response failed. Please try again." });
  }
});

export default router;
