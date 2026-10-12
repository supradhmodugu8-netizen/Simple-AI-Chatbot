import { Router, type IRouter } from "express";
import geminiRouter from "./gemini";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(geminiRouter);

export default router;
