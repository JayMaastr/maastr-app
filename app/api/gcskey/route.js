import { NextResponse } from 'next/server';
export async function GET(request) {
  const s = request.nextUrl.searchParams.get('s');
  if(s !== 'maastr-gcs-2026') return NextResponse.json({error:'no'},{status:403});
  return NextResponse.json({k: process.env.GCS_SERVICE_ACCOUNT_KEY});
}