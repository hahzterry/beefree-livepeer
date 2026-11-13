
import { NextRequest, NextResponse } from "next/server";
import { ApiResponse } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/playback/[playbackId]
// Fetches playback information from Livepeer.
// Returns stream URLs and playback metadata.

export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ playbackId: string }>;
  }
) {
  try {
    // 1. Validate playback ID
    const { playbackId } = await params;

    if (!playbackId || !playbackId.trim()) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Playback ID is required",
        },
        { status: 400 }
      );
    }

    // 2. Validate Livepeer API configuration
    const apiKey = process.env.LIVEPEER_API_KEY;

    if (!apiKey) {
      console.error(
        "[GET /api/playback] LIVEPEER_API_KEY is missing"
      );

      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Livepeer service is not configured",
        },
        { status: 503 }
      );
    }

    // 3. Dynamically import Livepeer client.
    // Prevents initialization during build-time
    // route module evaluation.
    const { default: livepeer } = await import(
      "@/lib/livepeer"
    );

    // 4. Fetch playback information
    const client = livepeer();

  const info = await client.playback.get(
  playbackId.trim()
    );

    // 5. Validate Livepeer response
    if (!info?.playbackInfo) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Playback information not found",
        },
        { status: 404 }
      );
    }

    // 6. Return playback information
    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          playbackInfo: info.playbackInfo,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error: unknown) {
    console.error(
      "[GET /api/playback] Failed to fetch playback:",
      error
    );

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: "Failed to fetch playback info",
      },
      { status: 500 }
    );
  }
}
