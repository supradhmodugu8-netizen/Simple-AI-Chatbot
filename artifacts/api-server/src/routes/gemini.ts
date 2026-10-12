import { ApiError, GoogleGenAI } from "@google/genai";
import { GetChatHistoryResponse, StreamGeminiChatBody } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { getOrCreateChatSessionId } from "../lib/chat-session";
import { getSupabaseAdminClient } from "../lib/supabase";

const router: IRouter = Router();

router.post("/gemini/chat", async (req, res): Promise<void> => {
  const parsed = StreamGeminiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const sessionId = getOrCreateChatSessionId(req, res);
  if (!sessionId) {
    res.status(503).json({ error: "Chat session signing is not configured." });
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    res.status(503).json({ error: "Supabase is not configured for this app." });
    return;
  }

  const { error: storageCheckError } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();
  if (storageCheckError) {
    req.log.error(
      { code: storageCheckError.code },
      "Supabase chat storage is unavailable",
    );
    if (
      storageCheckError.code === "42P01" ||
      storageCheckError.code === "PGRST205"
    ) {
      res.status(503).json({
        error:
          "Chat storage is not set up yet. Apply artifacts/simple-ai-chatbot/supabase/schema.sql in your Supabase SQL Editor.",
      });
      return;
    }
    res.status(503).json({
      error: "Chat history is unavailable. Check the Supabase connection and try again.",
    });
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

    let assistantText = "";
    for await (const chunk of stream) {
      const content = chunk.text;
      if (content) {
        assistantText += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    if (!assistantText.trim()) {
      res.write(
        `data: ${JSON.stringify({ error: "The assistant did not return a reply. Please try again." })}\n\n`,
      );
      res.end();
      return;
    }

    const savedMessages = [
      ...parsed.data.messages,
      { role: "assistant" as const, content: assistantText },
    ].slice(-30);
    if (savedMessages[0]?.role === "assistant") savedMessages.shift();
    const history = GetChatHistoryResponse.parse({ messages: savedMessages });
    const { error: saveError } = await supabase.from("chat_sessions").upsert(
      {
        id: sessionId,
        messages: history.messages,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (saveError) {
      req.log.error(
        { code: saveError.code },
        "Supabase could not save the completed chat",
      );
      res.write(
        `data: ${JSON.stringify({ error: "The reply was generated but could not be saved. Please try again." })}\n\n`,
      );
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    req.log.error(
      {
        errorType: error instanceof Error ? error.name : "unknown",
        status: error instanceof ApiError ? error.status : undefined,
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
