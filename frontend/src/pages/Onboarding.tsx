import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Bot,
  Check,
  Database,
  LayoutDashboard,
  Loader2,
  Radio,
  type LucideIcon,
  LineChart,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { QK } from '@/lib/queryKeys'
import {
  useCapabilities,
  usePreferences,
  useQuoteStatus,
  useSettings,
} from '@/lib/useSharedQueries'

const BRAND = '#8B5CF6'

type Tone = 'ok' | 'warn' | 'info'

interface ReadyItem {
  icon: LucideIcon
  title: string
  desc: string
  status: string
  tone: Tone
  metrics: { label: string; value: string }[]
}

const STEPS = [
  { no: '01', label: '环境确认', meta: '读取本机配置与服务状态', badge: '当前', active: true },
  { no: '02', label: '数据连接', meta: 'Longbridge / OKX / AI', badge: '待确认', active: false },
  { no: '03', label: '工作区偏好', meta: '默认页面与实时行情', badge: '可选', active: false },
  { no: '04', label: '进入面板', meta: '写入 onboarding 标记', badge: '最后', active: false },
] as const

export function Onboarding() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const settings = useSettings()
  const capabilities = useCapabilities()
  const preferences = usePreferences()
  const quoteStatus = useQuoteStatus()
  const crypto = useQuery({
    queryKey: QK.cryptoTickers,
    queryFn: () => api.cryptoTickers(),
    staleTime: 30_000,
  })
  const [checking, setChecking] = useState(false)

  const complete = useMutation({
    mutationFn: api.completeOnboarding,
    onSuccess: (data) => {
      qc.setQueryData(QK.settings, (old: any) =>
        old ? { ...old, onboarding_completed: data.onboarding_completed } : old,
      )
      qc.invalidateQueries({ queryKey: QK.settings })
      navigate('/', { replace: true })
    },
    onError: () => {
      navigate('/', { replace: true })
    },
  })

  const refreshAll = async () => {
    if (checking || complete.isPending) return
    setChecking(true)
    try {
      await Promise.allSettled([
        settings.refetch(),
        capabilities.refetch(),
        preferences.refetch(),
        quoteStatus.refetch(),
        crypto.refetch(),
      ])
      complete.mutate()
    } finally {
      setChecking(false)
    }
  }

  const finish = () => {
    if (!complete.isPending) complete.mutate()
  }

  const stockOk = settings.data?.mode === 'longbridge' || settings.data?.mode === 'api_key'
  const cryptoOk = (crypto.data?.count ?? 0) > 0
  const aiOk = !!settings.data?.has_ai_key
  const quoteEnabled = preferences.data?.realtime_quotes_enabled ?? false
  const quoteRunning = quoteStatus.data?.running ?? false
  const pipeline = preferences.data?.pipeline_schedule
  const instruments = preferences.data?.instruments_schedule
  const scheduleCount = [pipeline, instruments].filter(Boolean).length
  const capCount = Object.keys(capabilities.data?.capabilities ?? {}).length
  const missingCaps = settings.data?.missing_caps?.length ?? 0
  const okxPrivateReady = !!(
    crypto.data?.auth.api_key_configured &&
    crypto.data?.auth.api_secret_configured &&
    crypto.data?.auth.passphrase_configured
  )
  const firstCrypto = crypto.data?.rows?.[0]

  const readiness = useMemo<ReadyItem[]>(
    () => [
      {
        icon: LineChart,
        title: 'Longbridge 股票行情',
        desc:
          settings.data?.mode === 'longbridge'
            ? '本机 OAuth 已读取，用于实时行情、日 K、自选池和标的池。'
            : settings.data?.mode === 'api_key'
              ? '当前为 API Key 模式，可继续使用已配置的数据能力。'
              : '当前为基础模式，后续可在设置页切换数据源。',
        status: settings.isLoading ? '读取中' : stockOk ? '已连接' : '基础模式',
        tone: stockOk ? 'ok' : 'warn',
        metrics: [
          { label: 'quote', value: settings.data?.mode === 'longbridge' ? '120/min' : 'basic' },
          { label: 'capability', value: capabilities.data?.label ?? settings.data?.tier_label ?? 'pending' },
          { label: 'missing', value: String(missingCaps) },
        ],
      },
      {
        icon: Radio,
        title: 'OKX 币圈行情',
        desc: 'Spot ticker 可直接读取；私有凭据仅影响账户和交易能力。',
        status: crypto.isLoading ? '读取中' : cryptoOk ? '公共行情可用' : '待检测',
        tone: cryptoOk ? 'ok' : 'warn',
        metrics: [
          { label: 'symbols', value: crypto.data?.count != null ? String(crypto.data.count) : '—' },
          { label: 'market', value: crypto.data?.market ?? 'SPOT' },
          { label: 'auth', value: okxPrivateReady ? 'enabled' : 'optional' },
        ],
      },
      {
        icon: Bot,
        title: 'AI 策略助手',
        desc: '策略生成和参数解释不阻塞面板，可在设置的智能与策略中开启。',
        status: aiOk ? '已配置' : '稍后配置',
        tone: aiOk ? 'ok' : 'warn',
        metrics: [
          { label: 'provider', value: settings.data?.ai_provider ?? 'openai_compat' },
          { label: 'model', value: settings.data?.ai_model ?? 'pending' },
          { label: 'budget', value: `${settings.data?.ai_daily_token_budget ?? 'daily'}` },
        ],
      },
      {
        icon: Database,
        title: '数据任务与实时服务',
        desc: '日 K、标的池、enriched 数据和盘中轮询都从设置页统一管理。',
        status: quoteEnabled && quoteRunning ? '运行中' : scheduleCount ? '计划已读取' : '待检测',
        tone: quoteEnabled && quoteRunning ? 'ok' : scheduleCount ? 'info' : 'warn',
        metrics: [
          { label: 'daily', value: formatSchedule(pipeline) },
          { label: 'instruments', value: formatSchedule(instruments) },
          { label: 'realtime', value: quoteEnabled ? formatInterval(quoteStatus.data?.interval_s) : 'off' },
        ],
      },
    ],
    [
      aiOk,
      capCount,
      capabilities.data?.label,
      crypto.data?.count,
      crypto.data?.market,
      crypto.isLoading,
      cryptoOk,
      missingCaps,
      okxPrivateReady,
      pipeline,
      quoteEnabled,
      quoteRunning,
      quoteStatus.data?.interval_s,
      scheduleCount,
      settings.data?.ai_daily_token_budget,
      settings.data?.ai_model,
      settings.data?.ai_provider,
      settings.data?.mode,
      settings.data?.tier_label,
      settings.isLoading,
      stockOk,
      instruments,
    ],
  )

  const statusText = settings.isLoading
    ? '读取配置'
    : settings.data
      ? '本机配置可读'
      : '等待配置'

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-base text-foreground"
      style={{
        backgroundImage:
          'linear-gradient(hsl(var(--fg-primary) / 0.025) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--fg-primary) / 0.02) 1px, transparent 1px), radial-gradient(circle at 100% 100%, hsl(var(--accent) / 0.08), transparent 36%)',
        backgroundSize: '48px 48px, 48px 48px, auto',
      }}
    >
      <header className="relative z-10 grid min-h-16 grid-cols-[minmax(210px,1fr)_auto_minmax(210px,1fr)] items-center border-b border-border bg-base/80 px-6 backdrop-blur md:px-6 max-md:grid-cols-[1fr_auto] max-md:gap-3 max-md:px-4 max-md:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo
            size={29}
            className="shrink-0"
            style={{ color: BRAND, filter: `drop-shadow(0 0 9px ${BRAND}59)` }}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-none">A-SHARE QUANT</div>
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted max-sm:hidden">
              LOCAL TERMINAL
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 max-md:hidden">
          <span className="h-1.5 w-20 rounded-full bg-accent" />
          <span className="h-1.5 w-8 rounded-full bg-border" />
          <span className="h-1.5 w-8 rounded-full bg-border" />
          <span className="h-1.5 w-8 rounded-full bg-border" />
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          <span className="hidden h-8 items-center gap-2 rounded-btn border border-border bg-surface/70 px-3 text-xs text-secondary sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-bear shadow-[0_0_0_4px_hsl(var(--bear)/0.12)]" />
            {statusText}
          </span>
          <span className="font-mono text-xs text-muted">1 / 4</span>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-[min(1280px,calc(100vw-48px))] flex-col gap-3 py-4 max-md:w-[min(100vw-28px,720px)] max-md:py-4">
        <SetupStrip scheduleCount={scheduleCount} />

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_314px]">
          <section className="grid min-w-0 gap-3">
            <section className="overflow-hidden rounded-card border border-border bg-surface/90">
              <div className="grid gap-5 border-b border-border p-4 md:grid-cols-[minmax(0,1fr)_276px] md:items-stretch">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">FIRST RUN CHECK</div>
                  <h1 className="mt-2 text-[clamp(24px,2.35vw,32px)] font-bold leading-tight tracking-normal">
                    检查数据链路，启动量化工作区。
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-secondary">
                    当前系统以 Longbridge 作为股票行情主链路，OKX 提供币圈公共行情，AI 和私有交易能力可在设置页按需开启。
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <InfoTag active label="Longbridge" value={settings.data?.mode === 'longbridge' ? 'active' : settings.data?.mode ?? 'mode'} />
                    <InfoTag label="OKX" value={cryptoOk ? 'public spot' : 'pending'} />
                    <InfoTag label="DATA" value={scheduleCount ? 'persisted' : 'pending'} />
                    <InfoTag label="AI" value={aiOk ? 'ready' : 'optional'} />
                  </div>
                </div>

                <MarketSnapshot
                  stockValue={settings.data?.mode === 'longbridge' ? 'Longbridge' : settings.data?.mode ?? '—'}
                  cryptoSymbol={firstCrypto?.symbol ?? 'OKX-SPOT'}
                  cryptoPct={firstCrypto?.change_pct}
                  quoteValue={quoteEnabled ? formatInterval(quoteStatus.data?.interval_s) : 'manual'}
                  timestamp={crypto.data?.updated_at ? formatTimestamp(crypto.data.updated_at) : '—'}
                />
              </div>

              <div className="grid md:grid-cols-2">
                {readiness.map((item, idx) => (
                  <ReadyCard key={item.title} item={item} lastRow={idx >= readiness.length - 2} />
                ))}
              </div>
            </section>

            <ActionBar
              checking={checking}
              pending={complete.isPending}
              onCheck={refreshAll}
              onSkip={finish}
            />

            <PreferencePanel />
          </section>

          <Inspector
            settingsMode={settings.data?.mode}
            capabilityLabel={capabilities.data?.label ?? settings.data?.tier_label}
            capCount={capCount}
            missingCaps={missingCaps}
            cryptoCount={crypto.data?.count}
            cryptoUpdatedAt={crypto.data?.updated_at}
            cryptoSymbols={crypto.data?.symbols ?? []}
            aiReady={aiOk}
            aiModel={settings.data?.ai_model}
            okxPrivateReady={okxPrivateReady}
            quoteEnabled={quoteEnabled}
            quoteRunning={quoteRunning}
            quoteInterval={quoteStatus.data?.interval_s}
            pipeline={pipeline}
            instruments={instruments}
          />
        </div>
      </main>
    </div>
  )
}

function SetupStrip({ scheduleCount }: { scheduleCount: number }) {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface/85 xl:grid xl:grid-cols-[240px_minmax(0,1fr)_270px]">
      <div className="border-b border-border p-3.5 xl:border-b-0 xl:border-r">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">SETUP FLOW</div>
        <div className="mt-2 text-lg font-bold leading-tight">启动工作区</div>
        <div className="mt-2 text-xs leading-relaxed text-secondary">
          确认数据链路、刷新任务和默认入口，然后进入面板。
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 p-3 max-sm:grid-cols-2">
        {STEPS.map((step) => (
          <div
            key={step.no}
            className={cn(
              'grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-card border p-2 text-secondary max-md:grid-cols-1',
              step.active
                ? 'border-accent/40 bg-accent/15 text-foreground'
                : 'border-transparent',
            )}
          >
            <span
              className={cn(
                'grid h-7 w-7 place-items-center rounded-btn border font-mono text-xs',
                step.active
                  ? 'border-accent bg-accent text-white'
                  : 'border-border bg-elevated text-muted',
              )}
            >
              {step.no}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{step.label}</div>
              <div className="mt-1 truncate text-[11px] text-muted max-sm:whitespace-normal">{step.meta}</div>
              <span
                className={cn(
                  'mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px]',
                  step.active
                    ? 'border-bear/30 bg-bear/10 text-bear'
                    : 'border-border text-muted',
                )}
              >
                {step.badge}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid content-center gap-2 border-t border-border p-2.5 xl:border-l xl:border-t-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">RUN PROFILE</div>
        <div className="grid grid-cols-4 gap-2 xl:grid-cols-2 max-sm:grid-cols-2">
          <ProfileMetric label="默认入口" value="看板" />
          <ProfileMetric label="写入项" value="1 flag" />
          <ProfileMetric label="凭据变更" value="none" />
          <ProfileMetric label="刷新计划" value={`${scheduleCount || 0} jobs`} />
        </div>
      </div>
    </section>
  )
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-btn border border-border/70 bg-base/35 p-2">
      <div className="truncate text-[10px] text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-xs font-bold text-foreground">{value}</div>
    </div>
  )
}

function InfoTag({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-btn border border-border bg-elevated/70 px-2.5 text-xs text-secondary">
      {active && <span className="h-1.5 w-1.5 rounded-full bg-bear" />}
      <span className="font-semibold text-foreground">{label}</span>
      <span>{value}</span>
    </span>
  )
}

function MarketSnapshot({
  stockValue,
  cryptoSymbol,
  cryptoPct,
  quoteValue,
  timestamp,
}: {
  stockValue: string
  cryptoSymbol: string
  cryptoPct?: number | null
  quoteValue: string
  timestamp: string
}) {
  return (
    <div className="grid min-w-0 gap-3 border-border md:border-l md:pl-5">
      <div className="flex justify-between gap-3 font-mono text-[11px] text-muted">
        <span>MARKET SNAPSHOT</span>
        <span>{timestamp}</span>
      </div>
      <svg
        className="h-[86px] w-full overflow-hidden rounded-card border border-border bg-base/45"
        viewBox="0 0 276 92"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="onboardingLineFill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#3b82f6" stopOpacity=".34" />
            <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 66 L20 62 L38 68 L55 58 L74 60 L92 47 L110 52 L129 38 L145 41 L164 31 L184 44 L206 28 L226 33 L247 21 L276 24 L276 92 L0 92 Z" fill="url(#onboardingLineFill)" />
        <path d="M0 66 L20 62 L38 68 L55 58 L74 60 L92 47 L110 52 L129 38 L145 41 L164 31 L184 44 L206 28 L226 33 L247 21 L276 24" fill="none" stroke="#3b82f6" strokeWidth="2.2" />
        <g opacity=".92">
          <rect x="30" y="38" width="5" height="22" fill="#f04438" /><line x1="32.5" y1="30" x2="32.5" y2="68" stroke="#f04438" />
          <rect x="62" y="44" width="5" height="18" fill="#12b76a" /><line x1="64.5" y1="34" x2="64.5" y2="69" stroke="#12b76a" />
          <rect x="96" y="31" width="5" height="23" fill="#f04438" /><line x1="98.5" y1="24" x2="98.5" y2="60" stroke="#f04438" />
          <rect x="132" y="28" width="5" height="17" fill="#12b76a" /><line x1="134.5" y1="20" x2="134.5" y2="51" stroke="#12b76a" />
          <rect x="202" y="22" width="5" height="19" fill="#f04438" /><line x1="204.5" y1="14" x2="204.5" y2="47" stroke="#f04438" />
        </g>
      </svg>
      <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
        <TickerCell label="STOCK" value={stockValue} />
        <TickerCell label={cryptoSymbol} value={formatPercent(cryptoPct)} tone={pctTone(cryptoPct)} />
        <TickerCell label="QUOTE" value={quoteValue} />
      </div>
    </div>
  )
}

function TickerCell({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'flat' }) {
  return (
    <div className="min-w-0 rounded-btn border border-border bg-base/35 p-2">
      <div className="truncate font-mono text-[10px] text-muted">{label}</div>
      <div
        className={cn(
          'mt-1 truncate font-mono text-[13px] font-bold',
          tone === 'up' && 'text-bull',
          tone === 'down' && 'text-bear',
          (!tone || tone === 'flat') && 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function ReadyCard({
  item,
  lastRow,
}: {
  item: ReadyItem
  lastRow: boolean
}) {
  const Icon = item.icon
  return (
    <article
      className={cn(
        'min-w-0 border-border p-3.5 text-foreground md:border-r md:border-b',
        'even:md:border-r-0',
        lastRow && 'md:border-b-0',
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-btn border border-border bg-elevated text-accent">
            <Icon className="h-4 w-4" />
          </span>
          <div className="truncate text-base font-bold text-foreground">{item.title}</div>
        </div>
        <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-secondary">{item.desc}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {item.metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 rounded-btn border border-border/70 bg-base/35 p-2.5">
            <div className="truncate text-[10px] text-muted">{metric.label}</div>
            <div className="mt-1 truncate font-mono text-xs font-bold text-foreground">{metric.value}</div>
          </div>
        ))}
      </div>
    </article>
  )
}

function StatusBadge({
  tone,
  children,
}: {
  tone: Tone
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-1 text-[11px]',
        tone === 'ok' && 'border-bear/35 bg-bear/10 text-bear',
        tone === 'warn' && 'border-warning/35 bg-warning/10 text-warning',
        tone === 'info' && 'border-accent/35 bg-accent/10 text-accent',
      )}
    >
      {children}
    </span>
  )
}

function ActionBar({
  checking,
  pending,
  onCheck,
  onSkip,
}: {
  checking: boolean
  pending: boolean
  onCheck: () => void
  onSkip: () => void
}) {
  const busy = checking || pending
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 rounded-card border border-border bg-surface/90 p-2.5 max-sm:flex-col max-sm:items-stretch">
      <div className="min-w-0 text-xs leading-relaxed text-muted">
        <span className="font-semibold text-secondary">本轮只写入 onboarding 完成标记。</span>
        {' '}连接凭据、AI Provider 和任务时间仍在设置页维护。
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch">
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="inline-flex h-9 items-center justify-center rounded-btn border border-border bg-elevated px-4 text-sm font-semibold text-secondary transition-colors hover:text-foreground disabled:opacity-60"
        >
          直接进入面板
        </button>
        <button
          type="button"
          onClick={onCheck}
          disabled={busy}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-btn border border-accent/70 bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-70"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {checking ? '检测中…' : pending ? '正在进入…' : '检测并继续'}
        </button>
      </div>
    </div>
  )
}

function PreferencePanel() {
  const prefs = [
    { title: '打开市场看板', meta: '指数 / 宽度 / 情绪雷达', icon: LayoutDashboard },
    { title: '显示币圈行情', meta: 'OKX Spot 行情条', icon: Radio },
    { title: '保留实时行情开关', meta: '进入后手动启停', icon: Activity },
  ]
  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface/90">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="text-base font-bold">进入后默认工作区</div>
        <span className="rounded-full border border-bear/30 bg-bear/10 px-2 py-0.5 text-[11px] text-bear">
          可同步到设置
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3 max-md:grid-cols-1">
        {prefs.map((pref) => (
          <div key={pref.title} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-border bg-base/30 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <pref.icon className="h-3.5 w-3.5 text-muted" />
                <div className="truncate text-sm font-semibold">{pref.title}</div>
              </div>
              <div className="mt-1 truncate text-[11px] text-muted">{pref.meta}</div>
            </div>
            <span className="relative h-5 w-8 rounded-full border border-accent/40 bg-accent/20">
              <span className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-accent" />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Inspector({
  settingsMode,
  capabilityLabel,
  capCount,
  missingCaps,
  cryptoCount,
  cryptoUpdatedAt,
  cryptoSymbols,
  aiReady,
  aiModel,
  okxPrivateReady,
  quoteEnabled,
  quoteRunning,
  quoteInterval,
  pipeline,
  instruments,
}: {
  settingsMode?: string
  capabilityLabel?: string
  capCount: number
  missingCaps: number
  cryptoCount?: number
  cryptoUpdatedAt?: number
  cryptoSymbols: string[]
  aiReady: boolean
  aiModel?: string
  okxPrivateReady: boolean
  quoteEnabled: boolean
  quoteRunning: boolean
  quoteInterval?: number | null
  pipeline?: { hour: number; minute: number }
  instruments?: { hour: number; minute: number }
}) {
  return (
    <aside className="overflow-hidden rounded-card border border-border bg-surface/90 xl:min-h-[620px]">
      <div className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
        <div className="text-sm font-bold">状态 Inspector</div>
        <StatusBadge tone={settingsMode ? 'ok' : 'warn'}>{settingsMode ? '可运行' : '待检测'}</StatusBadge>
      </div>

      <InspectorSection title="最近检查">
        <InspectorEvent
          tone={settingsMode === 'longbridge' || settingsMode === 'api_key' ? 'ok' : 'warn'}
          title={settingsMode === 'longbridge' ? 'Longbridge quote 探测成功' : settingsMode ? '数据源状态已读取' : '数据源待检测'}
          detail={capabilityLabel ?? 'capability pending'}
        />
        <InspectorEvent
          tone={(cryptoCount ?? 0) > 0 ? 'ok' : 'warn'}
          title={`OKX Spot ticker ${(cryptoCount ?? 0) > 0 ? `返回 ${cryptoCount} 个标的` : '待检测'}`}
          detail={cryptoSymbols.length ? cryptoSymbols.slice(0, 3).join(' · ') : 'public market api'}
        />
        <InspectorEvent
          tone={aiReady ? 'ok' : 'warn'}
          title={aiReady ? 'AI Key 已配置' : 'AI Key 未配置或未测试'}
          detail={aiModel ?? '等待手动确认'}
        />
      </InspectorSection>

      <InspectorSection title="需要确认">
        <InspectorEvent
          tone={missingCaps > 0 ? 'warn' : 'ok'}
          title={missingCaps > 0 ? `${missingCaps} 项能力未探测到` : '无关键能力缺失'}
          detail={`${capCount} 项能力可用`}
        />
        <InspectorEvent
          tone={okxPrivateReady ? 'ok' : 'warn'}
          title={okxPrivateReady ? 'OKX 私有凭据已启用' : 'OKX 私有凭据未启用'}
          detail="不影响公共币圈行情"
        />
        <InspectorEvent
          tone={quoteEnabled && quoteRunning ? 'ok' : 'warn'}
          title={quoteEnabled ? '实时行情已开启' : '实时行情默认关闭'}
          detail={quoteRunning ? 'quote service running' : '进入面板后可从左侧开关启用'}
        />
      </InspectorSection>

      <InspectorSection title="下一步动作">
        <div className="grid gap-2">
          <InspectorLink label="连接与凭据" action="设置 →" />
          <InspectorLink label="数据任务" action="检查 →" />
          <InspectorLink label="监控中心" action="打开 →" />
          <InspectorLink label="菜单设置" action="排序 →" />
        </div>
      </InspectorSection>

      <InspectorSection title="服务队列">
        <InspectorEvent
          tone="info"
          title="盘中 quote service"
          detail={`${quoteEnabled ? 'auto' : 'manual start'} · ${formatInterval(quoteInterval)}`}
        />
        <InspectorEvent
          tone="ok"
          title="收盘 enriched recompute"
          detail={`daily ${formatSchedule(pipeline)} · instruments ${formatSchedule(instruments)}`}
        />
        {cryptoUpdatedAt && (
          <InspectorEvent tone="ok" title="OKX ticker 更新时间" detail={formatTimestamp(cryptoUpdatedAt)} />
        )}
      </InspectorSection>
    </aside>
  )
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border p-4 last:border-b-0">
      <div className="mb-3 text-xs font-bold text-secondary">{title}</div>
      {children}
    </section>
  )
}

function InspectorEvent({
  tone,
  title,
  detail,
}: {
  tone: Tone
  title: string
  detail: string
}) {
  return (
    <div className="mt-3 grid grid-cols-[8px_minmax(0,1fr)] items-start gap-3 first:mt-0">
      <span
        className={cn(
          'mt-1.5 h-2 w-2 rounded-full',
          tone === 'ok' && 'bg-bear',
          tone === 'warn' && 'bg-warning',
          tone === 'info' && 'bg-accent',
        )}
      />
      <div className="min-w-0">
        <div className="text-xs leading-snug text-foreground">{title}</div>
        <div className="mt-1 overflow-hidden text-ellipsis break-words font-mono text-[11px] leading-snug text-muted">
          {detail}
        </div>
      </div>
    </div>
  )
}

function InspectorLink({ label, action }: { label: string; action: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 rounded-btn border border-border bg-elevated/70 px-2.5 text-xs text-secondary">
      <span>{label}</span>
      <span>{action}</span>
    </div>
  )
}

function formatSchedule(schedule?: { hour: number; minute: number }) {
  if (!schedule) return '—'
  return `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
}

function formatInterval(interval?: number | null) {
  if (!interval) return '—'
  return `${interval < 1 ? interval.toFixed(1) : interval.toFixed(0)}s`
}

function formatTimestamp(value: number) {
  const ms = value > 1_000_000_000_000 ? value : value * 1000
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatPercent(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function pctTone(value?: number | null): 'up' | 'down' | 'flat' {
  if (value == null || Number.isNaN(value) || value === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}
