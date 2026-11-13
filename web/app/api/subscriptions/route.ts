
import { NextRequest, NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import Razorpay from "razorpay";
import mongoose from "mongoose";

import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Subscription from "@/models/Subscription";
import { ApiResponse } from "@/types";

// ============================================================
// NEXT.JS / VERCEL CONFIGURATION
// ============================================================

// Use Node.js runtime for Razorpay, Privy and MongoDB.
export const runtime = "nodejs";

// Prevent static prerendering of this API route.
export const dynamic = "force-dynamic";

// ============================================================
// LAZY INITIALIZATION
// Prevents missing environment variables from crashing builds.
// ============================================================

function getPrivyClient(): PrivyClient {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      "Missing Privy environment variables: NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET"
    );
  }

  return new PrivyClient(appId, appSecret);
}

function getRazorpayClient(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      "Missing Razorpay environment variables: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET"
    );
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

// ============================================================
// AUTHENTICATION HELPER
// ============================================================

async function verifyUser(req: NextRequest) {
  const authorization = req.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const authToken = authorization.slice(7).trim();

  if (!authToken) {
    return null;
  }

  const privy = getPrivyClient();

  try {
    return await privy.verifyAuthToken(authToken);
  } catch (error) {
    console.error("[Subscription Auth]", error);
    return null;
  }
}

// ============================================================
// POST /api/subscriptions
// Fan initiates a subscription to a creator.
// Creates Razorpay order and pending MongoDB subscription.
// ============================================================

export async function POST(req: NextRequest) {
  try {
    // --------------------------------------------------------
    // 1. Verify authentication
    // --------------------------------------------------------

    const verifiedClaims = await verifyUser(req);

    if (!verifiedClaims) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 }
      );
    }

    // --------------------------------------------------------
    // 2. Parse and validate request body
    // --------------------------------------------------------

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Invalid JSON request body",
        },
        { status: 400 }
      );
    }

    const creatorId =
      body !== null &&
      typeof body === "object" &&
      "creatorId" in body
        ? body.creatorId
        : undefined;

    if (
      typeof creatorId !== "string" ||
      !creatorId.trim()
    ) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "creatorId is required",
        },
        { status: 400 }
      );
    }

    if (!mongoose.isValidObjectId(creatorId)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Invalid creatorId",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------------
    // 3. Connect to MongoDB
    // --------------------------------------------------------

    await connectDB();

    // --------------------------------------------------------
    // 4. Find authenticated fan
    // --------------------------------------------------------

    const fan = await User.findOne({
      privyId: verifiedClaims.userId,
    });

    if (!fan) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "User not found",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------------
    // 5. Find creator
    // --------------------------------------------------------

    const creator = await User.findOne({
      _id: creatorId,
      role: "creator",
      isBanned: false,
    });

    if (!creator) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Creator not found",
        },
        { status: 404 }
      );
    }

    // Prevent users from subscribing to themselves.
    if (String(fan._id) === String(creator._id)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Cannot subscribe to yourself",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------------
    // 6. Check existing active subscription
    // --------------------------------------------------------

    const existing = await Subscription.findOne({
      fan: fan._id,
      creator: creator._id,
      status: "active",
      validUntil: {
        $gt: new Date(),
      },
    });

    if (existing) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Already subscribed",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------------
    // 7. Remove stale pending subscriptions
    // --------------------------------------------------------

    const staleCutoff = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    );

    await Subscription.deleteMany({
      fan: fan._id,
      creator: creator._id,
      status: "pending",
      createdAt: {
        $lt: staleCutoff,
      },
    });

    // --------------------------------------------------------
    // 8. Determine subscription amount
    // --------------------------------------------------------

    // Amount is in Indian paise.
    // Default: 9900 paise = INR 99.00

    const amount =
      creator.subscriptionPrice == null
        ? 9900
        : Number(creator.subscriptionPrice);

    if (
      !Number.isSafeInteger(amount) ||
      amount < 100
    ) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Invalid creator subscription price",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------------
    // 9. Initialize Razorpay only when needed
    // --------------------------------------------------------

    const razorpay = getRazorpayClient();

    // --------------------------------------------------------
    // 10. Create Razorpay order
    // --------------------------------------------------------

    const receipt = `sub_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
    });

    // --------------------------------------------------------
    // 11. Save pending subscription
    // --------------------------------------------------------

    const subscription = await Subscription.create({
      fan: fan._id,
      creator: creator._id,

      fanName: fan.name || fan.email || "",
      creatorName: creator.name || "",

      status: "pending",
      planType: "monthly",

      razorpayOrderId: order.id,
      amount,

      validUntil: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ),
    });

    // --------------------------------------------------------
    // 12. Return checkout information
    // --------------------------------------------------------

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          orderId: order.id,
          amount,
          currency: "INR",
          subscriptionId: subscription._id,
          creatorName: creator.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/subscriptions]", error);

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: "Failed to create subscription",
      },
      { status: 500 }
    );
  }
}

// ============================================================
// GET /api/subscriptions?creatorId=xxx
// Check whether the authenticated fan has an active subscription.
// ============================================================

export async function GET(req: NextRequest) {
  try {
    // --------------------------------------------------------
    // 1. Verify authentication
    // --------------------------------------------------------

    const verifiedClaims = await verifyUser(req);

    if (!verifiedClaims) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 }
      );
    }

    // --------------------------------------------------------
    // 2. Validate creator ID
    // --------------------------------------------------------

    const { searchParams } = new URL(req.url);

    const creatorId = searchParams.get("creatorId");

    if (!creatorId) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "creatorId is required",
        },
        { status: 400 }
      );
    }

    if (!mongoose.isValidObjectId(creatorId)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Invalid creatorId",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------------
    // 3. Connect MongoDB
    // --------------------------------------------------------

    await connectDB();

    // --------------------------------------------------------
    // 4. Find authenticated fan
    // --------------------------------------------------------

    const fan = await User.findOne({
      privyId: verifiedClaims.userId,
    });

    if (!fan) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "User not found",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------------
    // 5. Find active subscription
    // --------------------------------------------------------

    const subscription = await Subscription.findOne({
      fan: fan._id,
      creator: creatorId,
      status: "active",
      validUntil: {
        $gt: new Date(),
      },
    });

    // --------------------------------------------------------
    // 6. Return subscription status
    // --------------------------------------------------------

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        subscribed: Boolean(subscription),
        validUntil: subscription?.validUntil || null,
      },
    });
  } catch (error) {
    console.error("[GET /api/subscriptions]", error);

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: "Failed to check subscription",
      },
      { status: 500 }
    );
  }
}
