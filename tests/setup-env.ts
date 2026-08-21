import { config } from "dotenv";

/** Integration tests read DATABASE_URL from the same .env the app uses. */
config({ path: ".env", quiet: true });
