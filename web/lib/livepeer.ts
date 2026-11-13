
import "server-only";
import { Livepeer } from "livepeer";

// Lazily initialize the Livepeer client.
// Prevents environment-variable errors during
// Next.js build-time module evaluation.

let livepeerClient: Livepeer | null = null;

export function getLivepeerClient(): Livepeer {
  const apiKey = process.env.LIVEPEER_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      "LIVEPEER_API_KEY is missing. Configure it in Vercel Environment Variables."
    );
  }

  if (!livepeerClient) {
    livepeerClient = new Livepeer({
      apiKey: apiKey.trim(),
    });
  }

  return livepeerClient;
}

export default getLivepeerClient;
