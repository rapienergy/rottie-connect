import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Initialize the database with proper schema
export const db = drizzle({
  connection: process.env.DATABASE_URL,
  schema,
  ws: ws,
});

// Export schema for use in other files
export { schema };