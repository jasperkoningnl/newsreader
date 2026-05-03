import { ImageResponse } from 'next/og';
export const runtime = 'edge';
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';
export async function GET() { return new ImageResponse((<div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 430, height: 430, borderRadius: 96, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 260, fontWeight: 800 }}>F</div></div>), size); }
