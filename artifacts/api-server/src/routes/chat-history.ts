import { GetChatHistoryResponse, StartNewChatResponse } from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  getOrCreateChatSessionId,
  startNewChatSession,
} from "../lib/chat-session";
import { getSupabaseAdminClient } from "../lib/supabase";

const router: IRouter = Router();

function sendStorageError(
  req: Request,
  res: Response,
  error: { code?: string },
): void {
  req.log.error(
    { code: error.code },
    "Supabase chat history request failed",
  );

  if (error.code === "42P01" || error.code === "PGRST205") {
    res.status(503).json({
      error:
        "Chat storage is not set up yet. Apply artifacts/simple-ai-chatbot/supabase/schema.sql in your Supabase SQL Editor.",
    });
    return;
  }

  res.status(503).json({
    error: "Chat history is unavailable. Check the Supabase connection and try again.",
  });
}

router.get("/chat/history", async (req, res): Promise<void> => {
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

  const { data, error } = await supabase
    .from("chat_sessions")
    .select("messages")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    sendStorageError(req, res, error);
    return;
  }

  const parsed = GetChatHistoryResponse.safeParse({
    messages: data?.messages ?? [],
  });
  if (!parsed.success) {
    req.log.error("Supabase returned invalid chat history");
    res.status(500).json({ error: "Saved chat history could not be read." });
    return;
  }

  res.json(parsed.data);
});

router.post("/chat/history/new", (req, res): void => {
  const sessionId = startNewChatSession(res);
  if (!sessionId) {
    res.status(503).json({ error: "Chat session signing is not configured." });
    return;
  }

  res.status(201).json(StartNewChatResponse.parse({ messages: [] }));
});

export default router;
