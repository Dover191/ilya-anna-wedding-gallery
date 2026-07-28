import { NextRequest, NextResponse } from "next/server";
import {
  createUploadSignatures,
  getS3Config,
  type UploadInput,
  validateUpload,
} from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES_PER_UPLOAD = 10;

export async function POST(request: NextRequest) {
  const config = getS3Config();

  if (!config) {
    return NextResponse.json(
      { message: "S3 storage is not configured yet." },
      { status: 500 },
    );
  }

  let body: { files?: UploadInput[] };
  try {
    body = (await request.json()) as { files?: UploadInput[] };
  } catch {
    return NextResponse.json(
      { message: "Некорректный запрос загрузки." },
      { status: 400 },
    );
  }

  const files = body.files || [];
  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json(
      { message: "Выберите хотя бы один файл." },
      { status: 400 },
    );
  }

  if (files.length > MAX_FILES_PER_UPLOAD) {
    return NextResponse.json(
      { message: `Можно загрузить до ${MAX_FILES_PER_UPLOAD} файлов за раз.` },
      { status: 400 },
    );
  }

  for (const file of files) {
    const error = validateUpload(file, config);
    if (error) {
      return NextResponse.json({ message: error }, { status: 400 });
    }
  }

  return NextResponse.json({
    files: createUploadSignatures(files, config),
  });
}
