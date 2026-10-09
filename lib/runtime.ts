import { env } from 'cloudflare:workers';

export function qlooKey(): string | undefined {
  const value = (env as unknown as Record<string, unknown>).QLOO_API_KEY;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function publicDemoEnabled(): boolean {
  return (env as unknown as Record<string, unknown>).PUBLIC_DEMO === 'true';
}
