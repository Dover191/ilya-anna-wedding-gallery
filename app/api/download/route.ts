import { NextRequest, NextResponse } from "next/server";
import { createDownloadUrl, getS3Config } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = getS3Config();
  const key = request.nextUrl.searchParams.get("key") || "";

  if (!config) {
    return NextResponse.json(
      { message: "S3 storage is not configured yet." },
      { status: 500 },
    );
  }

  try {
    return NextResponse.redirect(createDownloadUrl(config, key));
  } catch {
    return NextResponse.json(
      { message: "Не удалось подготовить скачивание." },
      { status: 400 },
    );
  }
}
