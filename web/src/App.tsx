import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Activity, ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronRight, CircleAlert, FileText, FolderOpen, LayoutPanelLeft, LoaderCircle, Menu, MessageSquareText, Plus, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { Toaster } from '@/components/ui/sonner'

type Case = { id: string; cliente: string; formato: string | null; pais: string | null }
type Call = { name: string; args: { caso: string }; ok: boolean; error?: string }
type Summary = { caso?: string; formato?: string | null; faltantes?: string[]; soportes?: { tipo: string; estado: string }[]; requiereFirma?: boolean; requiereCargaManual?: boolean; estado?: string; enviado?: boolean }
type Reply = { reply: string; toolCalls: Call[]; needsConfirmation: boolean; summary?: Summary; files?: string[] }
type Message = { role: 'user' | 'assistant'; content: string; detail?: Reply }
type Session = { sessionId: string; history: Message[]; selectedCase: string | null; needsConfirmation: boolean; last: Reply | null }
const confirmation = 'Confirmar simulación de envío'
const toolNames: Record<string, string> = { leer_solicitud: 'Solicitud leída', mapear_campos: 'Campos mapeados', generar_formulario: 'Formulario generado', armar_paquete: 'Paquete preparado', simular_envio: 'Envío simulado' }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    let message = 'No se pudo conectar con el servicio. Intenta nuevamente.'
    try { const body = await response.json() as { error?: string }; if (body.error) message = body.error } catch { }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

function FileLinks({ files }: { files?: string[] }) {
  if (!files?.length) return null
  return <div className="mt-4 flex flex-wrap gap-2">{files.filter(path => /^\/api\/download\/[a-z0-9-]+\/[a-z0-9.-]+$/.test(path)).map(path => <Button asChild key={path} variant="outline" size="sm" className="h-9 gap-2 border-border bg-background text-foreground hover:border-[var(--brand-action)]"><a href={path} download><ArrowDownToLine className="size-3.5 text-[var(--brand-action)]" />{decodeURIComponent(path.split('/').pop() ?? 'Archivo')}</a></Button>)}</div>
}

function ToolCard({ calls }: { calls: Call[] }) {
  if (!calls.length) return null
  return <Accordion type="single" collapsible className="mt-4 max-w-xl rounded-lg border border-border bg-background px-4"><AccordionItem value="tools" className="border-0"><AccordionTrigger className="py-3 text-xs font-semibold text-muted-foreground hover:no-underline"><span className="flex items-center gap-2"><Activity className="size-4 text-[var(--brand-accent)]" />Actividad del agente <Badge variant="secondary" className="ml-1">{calls.length}</Badge></span></AccordionTrigger><AccordionContent><ol className="space-y-2 pb-1">{calls.map((call, index) => <li key={`${call.name}-${index}`} className="flex items-center gap-2 text-xs"><span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${call.ok ? 'bg-accent text-[var(--brand-accent)]' : 'bg-destructive/10 text-destructive'}`}>{call.ok ? <Check className="size-3" /> : <X className="size-3" />}</span><span>{toolNames[call.name] ?? call.name}</span>{!call.ok && <span className="text-destructive">{call.error ?? 'Error'}</span>}</li>)}</ol></AccordionContent></AccordionItem></Accordion>
}

function SummaryPanel({ summary, files }: { summary?: Summary; files?: string[] }) {
  if (!summary) return <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center"><FolderOpen className="mb-3 size-7 text-muted-foreground/60" /><p className="text-sm font-medium">Sin expediente todavía</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Selecciona un caso y prepara el paquete para ver el estado y los entregables.</p></div>
  const outstanding = summary.faltantes ?? []
  const supports = summary.soportes ?? []
  return <div className="space-y-5"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-muted-foreground">Expediente</p><p className="mt-1 break-all text-sm font-semibold">{summary.caso ?? 'Caso activo'}</p></div><Badge variant="secondary" className="uppercase">{summary.formato ?? summary.estado ?? 'En curso'}</Badge></div><Separator /><div className="grid grid-cols-2 gap-3"><div className="rounded-lg bg-secondary p-3"><p className="text-2xl font-semibold tracking-tight">{supports.length}</p><p className="text-xs text-muted-foreground">Soportes</p></div><div className="rounded-lg bg-secondary p-3"><p className="text-2xl font-semibold tracking-tight">{outstanding.length}</p><p className="text-xs text-muted-foreground">Campos pendientes</p></div></div>{outstanding.length > 0 && <div><p className="mb-2 text-xs font-semibold">Por completar</p><ul className="space-y-2">{outstanding.map(field => <li key={field} className="flex items-start gap-2 text-xs text-muted-foreground"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />{field}</li>)}</ul></div>}{supports.length > 0 && <div><p className="mb-2 text-xs font-semibold">Estado de soportes</p><ul className="space-y-2">{supports.map((support, index) => <li key={`${support.tipo}-${index}`} className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words text-muted-foreground">{support.tipo}</span><span className={`shrink-0 font-medium ${support.estado === 'vigente' ? 'text-[var(--brand-accent)]' : 'text-destructive'}`}>{support.estado}</span></li>)}</ul></div>}{(summary.requiereFirma || summary.requiereCargaManual) && <Alert className="bg-secondary"><ShieldCheck className="size-4" /><AlertTitle>Revisión humana requerida</AlertTitle><AlertDescription>{[summary.requiereFirma && 'Firma pendiente', summary.requiereCargaManual && 'Carga manual en portal'].filter(Boolean).join(' · ')}</AlertDescription></Alert>}{summary.estado === 'simulado' && <Badge variant="outline" className="gap-1"><CheckCircle2 className="size-3" />Solo simulación, sin envío real</Badge>}{files?.length ? <div><Separator className="mb-4" /><p className="text-xs font-semibold">Archivos disponibles</p><FileLinks files={files} /></div> : null}</div>
}

export default function App() {
  const [cases, setCases] = useState<Case[]>([])
  const [casesLoading, setCasesLoading] = useState(true)
  const [casesError, setCasesError] = useState('')
  const [sessionId, setSessionId] = useState(() => { const candidate = new URLSearchParams(window.location.search).get('session'); return candidate && /^[A-Za-z0-9_-]{1,100}$/.test(candidate) ? candidate : crypto.randomUUID() })
  const [selectedCase, setSelectedCase] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [last, setLast] = useState<Reply | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    let active = true
    request<{ cases: Case[] }>('/api/cases').then(data => { if (active) setCases(data.cases) }).catch((reason: Error) => { if (active) setCasesError(reason.message) }).finally(() => { if (active) setCasesLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    request<Session>(`/api/sessions/${sessionId}`).then(data => {
      if (!active) return
      setMessages(data.history.map((message, index) => ({ ...message, detail: index === data.history.length - 1 && message.role === 'assistant' ? data.last ?? undefined : undefined })))
      setLast(data.last)
      setSelectedCase(data.selectedCase)
    }).catch((reason: Error) => { if (active && !reason.message.includes('no encontrada')) setError(reason.message) })
    return () => { active = false; activeRequest.current?.abort() }
  }, [sessionId])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  function newSession() {
    activeRequest.current?.abort()
    setBusy(false)
    const id = crypto.randomUUID()
    setSessionId(id)
    setSelectedCase(null)
    setMessages([])
    setLast(null)
    setDraft('')
    setError('')
    setMobileMenuOpen(false)
    window.history.replaceState(null, '', window.location.pathname)
    inputRef.current?.focus()
  }

  async function send(message: string) {
    const content = message.trim()
    if (!content || busy || content.length > 4000) return
    const controller = new AbortController()
    activeRequest.current = controller
    setBusy(true)
    setError('')
    setDraft('')
    setMessages(current => [...current, { role: 'user', content }])
    try {
      const response = await request<Reply>('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message: content }), signal: controller.signal })
      if (controller.signal.aborted) return
      setMessages(current => [...current, { role: 'assistant', content: response.reply, detail: response }])
      setLast(response)
      if (typeof response.summary?.caso === 'string') setSelectedCase(response.summary.caso)
      if (response.toolCalls.some(call => !call.ok)) toast.error('Una herramienta no pudo completar la operación')
    } catch (reason) {
      if (controller.signal.aborted) return
      setDraft(content)
      setError(reason instanceof Error ? reason.message : 'Error inesperado')
    } finally { if (activeRequest.current === controller) { activeRequest.current = null; setBusy(false); inputRef.current?.focus() } }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(draft) }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.trim()) void send(draft) } }
  function chooseCase(id: string) { setSelectedCase(id); setMobileMenuOpen(false); setDraft(`Prepara el formulario y el paquete para ${id}`); inputRef.current?.focus() }
  function caseList() { return <div className="space-y-1">{casesLoading ? Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14 bg-white/10" />) : casesError ? <div className="space-y-2 rounded-lg border border-white/20 p-3 text-xs text-white/80"><p>No se pudieron cargar los casos.</p><Button variant="secondary" size="sm" onClick={() => { setCasesError(''); setCasesLoading(true); request<{ cases: Case[] }>('/api/cases').then(data => setCases(data.cases)).catch((reason: Error) => setCasesError(reason.message)).finally(() => setCasesLoading(false)) }}>Reintentar</Button></div> : cases.length === 0 ? <p className="p-3 text-xs text-white/70">No hay casos disponibles.</p> : cases.map(c => <button key={c.id} type="button" onClick={() => chooseCase(c.id)} aria-current={selectedCase === c.id ? 'true' : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/10 focus-visible:outline-white ${selectedCase === c.id ? 'bg-white/15' : ''}`}><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/10 text-[var(--brand-accent)]"><FileText className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{c.cliente}</span><span className="mt-0.5 block truncate text-[11px] text-white/60">{[c.pais, c.formato?.toUpperCase()].filter(Boolean).join(' · ') || c.id}</span></span><ChevronRight className="size-3.5 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5" /></button>)}</div> }
  const sidebar = <div className="flex h-full flex-col bg-[var(--brand-primary)] text-white"><div className="flex items-center gap-3 px-6 pb-7 pt-8"><div className="flex size-10 items-center justify-center rounded-xl border border-white/20 bg-white/10"><LayoutPanelLeft className="size-5 text-[var(--brand-accent)]" /></div><div><div className="text-base font-bold tracking-tight">PERIFERIA</div><div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/55">Espacio de trabajo</div></div></div><div className="px-4"><Button onClick={newSession} className="h-11 w-full justify-start border border-white/20 bg-white/10 text-white hover:bg-white/20"><Plus className="size-4" />Nueva sesión</Button></div><Separator className="my-6 bg-white/15" /><div className="min-h-0 flex-1 px-4"><div className="mb-3 flex items-center justify-between px-3"><span className="text-[10px] font-bold uppercase tracking-[0.19em] text-white/50">Casos disponibles</span><span className="text-xs text-white/50">{cases.length.toString().padStart(2, '0')}</span></div><ScrollArea className="h-full max-h-[calc(100vh-310px)]">{caseList()}</ScrollArea></div><div className="mt-auto p-4"><div className="rounded-xl border border-white/15 bg-white/5 p-4"><div className="flex items-center gap-2 text-xs font-medium"><span className="size-1.5 rounded-full bg-[var(--brand-accent)]" />Entorno de trabajo</div><p className="mt-2 text-[11px] leading-relaxed text-white/60">Los envíos se simulan. Revisa cada expediente antes de confirmar.</p></div></div></div>

  return <TooltipProvider><Toaster position="top-right" /><div className="flex h-dvh min-h-[540px] overflow-hidden bg-[var(--brand-surface)]"><aside className="hidden w-[270px] shrink-0 lg:block xl:w-[290px]">{sidebar}</aside><div className="flex min-w-0 flex-1 flex-col"><header className="flex h-[72px] shrink-0 items-center justify-between gap-3 border-b bg-background px-4 sm:px-7"><div className="flex min-w-0 items-center gap-3"><Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir casos"><Menu className="size-5" /></Button></SheetTrigger><SheetContent side="left" className="w-[min(85vw,320px)] border-0 p-0" showCloseButton={false}><SheetHeader className="sr-only"><SheetTitle>Casos disponibles</SheetTitle><SheetDescription>Elige un caso o crea una nueva sesión</SheetDescription></SheetHeader>{sidebar}</SheetContent></Sheet><div className="min-w-0"><div className="flex items-center gap-2"><span className="hidden text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground sm:inline">Asistente /</span><span className="truncate text-sm font-semibold sm:text-base">Registro de proveedores</span></div><p className="truncate text-[11px] text-muted-foreground">{selectedCase ? `Caso activo · ${selectedCase}` : 'Selecciona un caso para comenzar'}</p></div></div><div className="flex items-center gap-2"><Badge variant="secondary" className="hidden gap-1.5 text-[11px] font-medium sm:inline-flex"><span className="size-1.5 rounded-full bg-[var(--brand-accent)]" />Sesión activa</Badge><Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={newSession} aria-label="Nueva sesión"><Plus className="size-4" /></Button></TooltipTrigger><TooltipContent>Nueva sesión</TooltipContent></Tooltip></div></header><div className="flex min-h-0 flex-1"><main className="flex min-w-0 flex-1 flex-col"><div className="flex-1 overflow-y-auto overscroll-contain"><div className="mx-auto w-full max-w-[840px] px-4 py-6 sm:px-8 sm:py-9"><div className="mb-7 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground"><MessageSquareText className="size-3.5" />Conversación <ChevronRight className="size-3" /> {selectedCase ?? 'Nueva sesión'}</div><Sheet><SheetTrigger asChild><Button variant="outline" size="sm" className="gap-2 xl:hidden"><LayoutPanelLeft className="size-4" />Resumen</Button></SheetTrigger><SheetContent className="w-[min(90vw,400px)] overflow-y-auto"><SheetHeader><SheetTitle>Resumen del expediente</SheetTitle><SheetDescription>Estado y entregables del caso actual</SheetDescription></SheetHeader><div className="px-5 pb-6"><SummaryPanel summary={last?.summary} files={last?.files} /></div></SheetContent></Sheet></div>{messages.length === 0 && <div className="relative overflow-hidden rounded-2xl border border-border bg-background p-6 shadow-sm sm:p-10"><div className="absolute right-0 top-0 h-1 w-28 bg-[var(--brand-accent)]" /><div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-accent text-[var(--brand-primary)]"><Sparkles className="size-6" /></div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--brand-action)]">Asistente de registro</p><h1 className="mt-3 max-w-md text-2xl font-semibold leading-tight tracking-tight sm:text-[32px]">Prepara cada expediente con claridad.</h1><p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">Elige un caso en el panel lateral o escribe su identificador. Revisaré la solicitud, mapearé los campos y prepararé el formulario junto con sus soportes.</p><div className="mt-7 flex flex-wrap gap-2">{cases.slice(0, 2).map(c => <Button key={c.id} variant="outline" size="sm" onClick={() => chooseCase(c.id)} className="max-w-full gap-2"><span className="truncate">{c.cliente}</span><ArrowRight className="size-3.5 shrink-0" /></Button>)}</div></div>}<div className="space-y-7" role="log" aria-label="Conversación" aria-live="polite">{messages.map((message, index) => <div key={index} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>{message.role === 'assistant' && <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white"><Sparkles className="size-4" /></div>}<div className={`min-w-0 max-w-[min(100%,680px)] ${message.role === 'user' ? 'rounded-2xl rounded-tr-sm bg-[var(--brand-primary)] px-4 py-3 text-white' : 'w-full rounded-2xl rounded-tl-sm border border-border bg-background p-4 shadow-sm sm:p-5'}`}><div className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</div>{message.detail && <><ToolCard calls={message.detail.toolCalls} /><FileLinks files={message.detail.files} /></>}</div></div>)}{busy && <div className="flex gap-3" role="status"><div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white"><Sparkles className="size-4" /></div><div className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin text-[var(--brand-action)]" />Preparando respuesta…</div></div>}</div>{last?.needsConfirmation && !busy && <Card className="mt-6 border-[var(--brand-accent)]/40 bg-background shadow-sm"><CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-[var(--brand-accent)]" />Confirmación requerida</CardTitle></CardHeader><CardContent><p className="mb-4 text-xs leading-5 text-muted-foreground">Solo se simulará el envío. No se enviará ningún correo real.</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setConfirmOpen(true)}><Check className="size-4" />Confirmar simulación</Button><Button size="sm" variant="outline" onClick={() => void send('No confirmar. Continuar sin simular el envío.')}><X className="size-4" />No confirmar</Button></div></CardContent></Card>}{error && <Alert variant="destructive" role="alert" className="mt-5 bg-background"><CircleAlert className="size-4" /><AlertTitle>No se completó la solicitud</AlertTitle><AlertDescription>{error} Tu mensaje sigue en el campo para reintentarlo.</AlertDescription></Alert>}<div ref={endRef} /></div></div><div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-8 sm:py-5"><form onSubmit={submit} className="mx-auto max-w-[840px]"><div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 shadow-sm transition-colors focus-within:border-[var(--brand-action)] focus-within:ring-2 focus-within:ring-ring/15"><label htmlFor="chat-message" className="sr-only">Escribe un mensaje</label><Textarea id="chat-message" ref={inputRef} value={draft} maxLength={4000} disabled={busy} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} rows={2} placeholder="Escribe un caso o pregunta por su registro…" className="max-h-36 min-h-12 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:ring-0" /><Button type="submit" size="icon" className="mb-1 size-9 shrink-0 bg-[var(--brand-action)] hover:bg-[var(--brand-primary)]" disabled={busy || !draft.trim()} aria-label="Enviar mensaje"><Send className="size-4" /></Button></div><p className="mt-2 text-center text-[10px] text-muted-foreground">Enter para enviar · Shift + Enter para una nueva línea · Sin envíos reales</p></form></div></main><aside className="hidden w-[318px] shrink-0 overflow-y-auto border-l bg-background p-6 xl:block"><Tabs defaultValue="summary"><TabsList className="mb-6 w-full"><TabsTrigger value="summary">Resumen</TabsTrigger><TabsTrigger value="guide">Guía</TabsTrigger></TabsList><TabsContent value="summary"><div className="mb-5"><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[var(--brand-action)]">Vista de caso</p><h2 className="mt-1 text-lg font-semibold tracking-tight">Estado del expediente</h2></div><SummaryPanel summary={last?.summary} files={last?.files} /></TabsContent><TabsContent value="guide"><h2 className="text-lg font-semibold">Cómo funciona</h2><ol className="mt-5 space-y-5">{['Selecciona un caso del listado.', 'Prepara el formulario y revisa los soportes.', 'Descarga los archivos y confirma solo si quieres simular el envío.'].map((step, index) => <li key={step} className="flex gap-3 text-sm leading-5 text-muted-foreground"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-[var(--brand-primary)]">{index + 1}</span>{step}</li>)}</ol></TabsContent></Tabs></aside></div></div><AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Simular el envío?</AlertDialogTitle><AlertDialogDescription>Se registrará una simulación para {last?.summary?.caso ?? selectedCase ?? 'este caso'}. No se enviará ningún correo ni se completará una carga real en el portal.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Volver sin confirmar</AlertDialogCancel><AlertDialogAction onClick={() => void send(confirmation)}>Sí, simular envío</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></TooltipProvider>
}
