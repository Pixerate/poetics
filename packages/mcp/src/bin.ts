#!/usr/bin/env node
import { createServer } from "./server.ts";

// Run from the repository root, as MCP clients do for project-scoped servers.
await createServer({ root: process.cwd() }).listen();
