import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

const COOKIE_NAME = "goodquestion_session";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setSessionCookie(res: Response): string | null {
  if (!process.env.SESSION_SECRET) return null;

  const sessionId = randomUUID();
  res.cookie(COOKIE_NAME, sessionId, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  return sessionId;
}

export function getOrCreateChatSessionId(
  req: Request,
  res: Response,
): string | null {
  if (!process.env.SESSION_SECRET) return null;

  const existing = req.signedCookies?.[COOKIE_NAME];
  if (typeof existing === "string" && UUID_PATTERN.test(existing)) {
    return existing;
  }

  return setSessionCookie(res);
}

export function startNewChatSession(res: Response): string | null {
  return setSessionCookie(res);
}
