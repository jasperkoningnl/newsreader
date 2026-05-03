import { ImageResponse } from 'next/og';
export const runtime = 'edge';
export const size = { width: 192, height: 192 };
export const contentType = 'image/png';
export async function GET() { return new ImageResponse((<div style={{ width: '100%', height: '100%', background: '#000', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 120, fontWeight: 800 }}>F</div>), size); }
