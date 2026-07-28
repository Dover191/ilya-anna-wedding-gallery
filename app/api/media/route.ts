import { NextResponse } from "next/server";
import { getS3Config, listMedia } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getS3Config();

  if (!config) {
    return NextResponse.json({
      configured: false,
      items: [],
      message: "S3 storage is not configured yet.",
    });
  }

  try {
    const items = await listMedia(config);
    return NextResponse.json({ configured: true, items });
  } catch {
    return NextResponse.json(
      {
        configured: true,
        items: [],
        message: "Не удалось получить галерею из хранилища.",
      },
      { status: 502 },
    );
  }
}
