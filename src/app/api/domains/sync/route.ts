import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';          // your existing DB connect helper
import { syncSpaceshipDomains } from '@/services/spaceship';

export async function POST() {
  await connectDB();
  const result = await syncSpaceshipDomains();
  return NextResponse.json(result);
}