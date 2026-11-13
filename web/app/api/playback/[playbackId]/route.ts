
import { NextRequest, NextResponse } from "next/server";
import livepeer from "@/lib/livepeer";
import type { ApiResponse } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/playback/[playbackId]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ playbackId: string }> }
) {
  try {
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

    // Initialize the Livepeer client at request time
    const client = livepeer();

    // Fetch playback information
    const info = await client.playback.get(
      playbackId.trim()
    );

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        playbackInfo: info.playbackInfo,
      },
    });
  } catch (error) {
    console.error("[GET /api/playback]", error);

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: "Failed to fetch playback information",
      },
      { status: 500 }
    );
  }
}
