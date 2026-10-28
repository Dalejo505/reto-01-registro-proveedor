import { z } from 'zod'

export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const sessionIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
export const chatSchema = z.object({ sessionId: sessionIdSchema, message: z.string().trim().min(1).max(4000) }).strict()
export const toolResponse = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() })])
export const confirmText = 'Confirmar simulación de envío'
export type PublicCall = { name: string; args: { caso: string }; ok: boolean; error?: string }
export type ChatReply = { reply: string; toolCalls: PublicCall[]; needsConfirmation: boolean; summary?: Record<string, unknown>; files?: string[] }
