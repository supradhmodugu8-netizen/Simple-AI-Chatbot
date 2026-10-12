import { Router, type IRouter } from "express";
import geminiRouter from "./gemini";
import chatHistoryRouter from "./chat-history";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatHistoryRouter);
router.use(geminiRouter);

export default router;
