import { Hono } from "hono";
import { apiRouter } from "./api/router";

export const app = new Hono();

app.route("/api", apiRouter);
