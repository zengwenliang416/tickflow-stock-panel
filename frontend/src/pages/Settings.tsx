/**
 * 统一设置工作台。
 *
 * URL query param ?tab=xxx 保留旧入口兼容，并映射到新的设置分组。
 */
import type { ComponentType, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  BellRing,
  Bot,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  Key,
  Radio,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { SettingsKeysPanel } from './settings/Keys'
import { SettingsAIPanel } from './settings/AI'
import { SettingsMonitoringPanel } from './settings/Monitoring'
import { SettingsExtPagesPanel } from './settings/ExtPages'
import { SettingsMenuSettingsPanel } from './settings/MenuSettings'
import { SettingsSystemPanel } from './settings/System'
import { SettingsCustomSignalsPanel } from './settings/CustomSignals'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { QK } from '@/lib/queryKeys'
import {
  useCapabilities,
  usePreferences,
  useQuoteStatus,
  useSettings,
  useVersion,
} from '@/lib/useSharedQueries'

type SettingsGroupKey =
  | 'connection'
  | 'data-refresh'
  | 'monitoring-signals'
  | 'intelligence'
  | 'workspace'
  | 'system'

interface SettingsGroup {
  key: SettingsGroupKey
  label: string
  meta: string
  count: number
  icon: ComponentType<{ className?: string }>
  search: string
}

const GROUPS: SettingsGroup[] = [
  {
    key: 'connection',
    label: '连接与凭据',
    meta: 'Longbridge · OKX · AI',
    count: 4,
    icon: Key,
    search: '数据源 api key longbridge okx ai 连接 凭据 行情',
  },
  {
    key: 'data-refresh',
    label: '数据与刷新',
    meta: '实时轮询 · SSE · 数据任务',
    count: 8,
    icon: Activity,
    search: '实时行情 轮询 sse 刷新 数据任务 日k 分钟k 指数 enriched',
  },
  {
    key: 'monitoring-signals',
    label: '监控与信号',
    meta: '规则 · 通知 · 涨停修正',
    count: 6,
    icon: BellRing,
    search: '监控中心 信号库 通知 声音 告警 涨停 修正',
  },
  {
    key: 'intelligence',
    label: '智能与策略',
    meta: '模型 · 预算 · 策略生成',
    count: 5,
    icon: Sparkles,
    search: 'ai 模型 openai deepseek qwen 策略生成 token 预算',
  },
  {
    key: 'workspace',
    label: '工作区与页面',
    meta: '菜单 · 扩展页 · 列配置',
    count: 7,
    icon: SlidersHorizontal,
    search: '菜单 排序 隐藏 扩展页面 分析页面 列配置 自选 策略结果',
  },
  {
    key: 'system',
    label: '系统',
    meta: '缓存 · 版本 · 诊断',
    count: 4,
    icon: Settings2,
    search: '系统 缓存 版本 诊断 通知 主题',
  },
]

const TAB_TO_GROUP: Record<string, SettingsGroupKey> = {
  account: 'connection',
  keys: 'connection',
  connection: 'connection',
  data: 'data-refresh',
  queries: 'data-refresh',
  monitoring: 'data-refresh',
  'data-refresh': 'data-refresh',
  monitor: 'monitoring-signals',
  signals: 'monitoring-signals',
  'monitoring-signals': 'monitoring-signals',
  ai: 'intelligence',
  strategy: 'intelligence',
  intelligence: 'intelligence',
  analysis: 'workspace',
  'ext-pages': 'workspace',
  menus: 'workspace',
  workspace: 'workspace',
  system: 'system',
}

function resolveGroup(tabParam: string | null): SettingsGroup {
  const groupKey = tabParam ? TAB_TO_GROUP[tabParam] : 'connection'
  return GROUPS.find((g) => g.key === groupKey) ?? GROUPS[0]
}

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const tabParam = searchParams.get('tab')
  const activeGroup = resolveGroup(tabParam)
  const highlight = searchParams.get('highlight') ?? ''

  const settings = useSettings()
  const capabilities = useCapabilities()
  const preferences = usePreferences()
  const quoteStatus = useQuoteStatus()
  const version = useVersion()
  const crypto = useQuery({
    queryKey: QK.cryptoTickers,
    queryFn: () => api.cryptoTickers(),
    staleTime: 30_000,
  })

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return GROUPS
    const matched = GROUPS.filter((g) =>
      `${g.label} ${g.meta} ${g.search}`.toLowerCase().includes(q),
    )
    return matched.length ? matched : GROUPS
  }, [search])

  const selectGroup = (key: SettingsGroupKey) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: QK.settings })
    queryClient.invalidateQueries({ queryKey: QK.capabilities })
    queryClient.invalidateQueries({ queryKey: QK.preferences })
    queryClient.invalidateQueries({ queryKey: QK.quoteStatus })
    queryClient.invalidateQueries({ queryKey: QK.cryptoTickers })
    queryClient.invalidateQueries({ queryKey: QK.version })
  }

  return (
    <>
      <PageHeader
        title="设置"
        subtitle="配置数据连接、刷新策略、监控信号、AI 与工作区行为。"
        right={
          <div className="flex min-w-0 items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索设置、数据源、刷新、AI、OKX"
              className="hidden h-8 w-[min(24rem,34vw)] rounded-btn border border-border bg-surface px-3 text-xs text-foreground placeholder:text-muted/70 focus:border-accent/60 focus:outline-none md:block"
            />
            <button
              onClick={refreshAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-accent/35 bg-accent/15 px-3 text-xs font-medium text-accent hover:bg-accent/25 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              全局检查
            </button>
          </div>
        }
      />

      <div className="px-5 py-4 lg:px-8 lg:py-5">
        <div className="space-y-4">
          <HealthStrip
            settings={settings.data}
            capabilitiesLabel={capabilities.data?.label}
            crypto={crypto.data}
            quoteStatus={quoteStatus.data}
            preferences={preferences.data}
          />

          <CategoryStrip
            groups={filteredGroups}
            activeKey={activeGroup.key}
            onSelect={selectGroup}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <motion.div
              key={activeGroup.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="min-w-0 space-y-4"
            >
              <GroupIntro group={activeGroup} />
              <ActiveGroupContent
                group={activeGroup.key}
                highlight={highlight}
                setGroup={selectGroup}
                preferences={preferences.data}
                settings={settings.data}
                crypto={crypto.data}
                capabilitiesLabel={capabilities.data?.label}
              />
            </motion.div>

            <SettingsInspector
              settings={settings.data}
              capabilities={capabilities.data}
              crypto={crypto.data}
              quoteStatus={quoteStatus.data}
              preferences={preferences.data}
              version={version.data?.version}
              setGroup={selectGroup}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function HealthStrip({
  settings,
  capabilitiesLabel,
  crypto,
  quoteStatus,
  preferences,
}: {
  settings: ReturnType<typeof useSettings>['data']
  capabilitiesLabel?: string
  crypto?: Awaited<ReturnType<typeof api.cryptoTickers>>
  quoteStatus?: Awaited<ReturnType<typeof api.quoteStatus>>
  preferences?: Awaited<ReturnType<typeof api.preferences>>
}) {
  const stockOk = settings?.mode === 'longbridge' || settings?.mode === 'api_key'
  const cryptoOk = (crypto?.count ?? 0) > 0
  const aiOk = settings?.has_ai_key
  const quoteEnabled = preferences?.realtime_quotes_enabled ?? false
  const quoteRunning = quoteStatus?.running ?? false
  const pipeline = preferences?.pipeline_schedule
  const instruments = preferences?.instruments_schedule

  return (
    <section className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
      <HealthCell
        label="股票数据"
        value={settings?.mode === 'longbridge' ? 'Longbridge 已连接' : stockOk ? '数据源已配置' : '基础模式'}
        meta={settings?.mode === 'longbridge' ? 'OAuth · quote/kline/watchlist' : capabilitiesLabel ?? settings?.tier_label ?? 'capability pending'}
        icon={Key}
        tone={stockOk ? 'ok' : 'warn'}
      />
      <HealthCell
        label="币圈行情"
        value={cryptoOk ? 'OKX Spot 可用' : 'OKX 待检测'}
        meta={cryptoOk ? crypto?.symbols.slice(0, 3).join(' · ') : 'public ticker'}
        icon={Radio}
        tone={cryptoOk ? 'ok' : 'warn'}
      />
      <HealthCell
        label="AI 策略"
        value={aiOk ? 'AI 已配置' : '需配置'}
        meta={`${settings?.ai_provider ?? 'openai_compat'} · ${settings?.ai_model ?? 'model pending'}`}
        icon={Bot}
        tone={aiOk ? 'ok' : 'warn'}
      />
      <HealthCell
        label="实时服务"
        value={quoteEnabled ? `${formatInterval(quoteStatus?.interval_s)} 轮询` : '已关闭'}
        meta={quoteRunning ? 'quote service running' : 'quote service idle'}
        icon={Activity}
        tone={quoteEnabled && quoteRunning ? 'ok' : quoteEnabled ? 'info' : 'muted'}
      />
      <HealthCell
        label="数据任务"
        value={pipeline || instruments ? '2 个计划' : '未配置'}
        meta={`日K ${formatSchedule(pipeline)} · 标的 ${formatSchedule(instruments)}`}
        icon={Database}
        tone={pipeline || instruments ? 'ok' : 'muted'}
      />
    </section>
  )
}

function HealthCell({
  label,
  value,
  meta,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  meta?: string
  icon: ComponentType<{ className?: string }>
  tone: 'ok' | 'warn' | 'info' | 'muted'
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3 text-xs text-secondary">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted" />
          {label}
        </span>
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            tone === 'ok' && 'bg-bear',
            tone === 'warn' && 'bg-warning',
            tone === 'info' && 'bg-accent',
            tone === 'muted' && 'bg-muted',
          )}
        />
      </div>
      <div
        className={cn(
          'mt-2 truncate text-base font-semibold',
          tone === 'ok' && 'text-bear',
          tone === 'warn' && 'text-warning',
          tone === 'info' && 'text-accent',
          tone === 'muted' && 'text-foreground',
        )}
      >
        {value}
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-muted">{meta ?? '—'}</div>
    </div>
  )
}

function CategoryStrip({
  groups,
  activeKey,
  onSelect,
}: {
  groups: SettingsGroup[]
  activeKey: SettingsGroupKey
  onSelect: (key: SettingsGroupKey) => void
}) {
  return (
    <nav className="grid grid-cols-1 gap-1 rounded-card border border-border bg-surface p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {groups.map((group) => {
        const Icon = group.icon
        const active = group.key === activeKey
        return (
          <button
            key={group.key}
            onClick={() => onSelect(group.key)}
            className={cn(
              'min-h-[62px] rounded-btn border px-3 py-2.5 text-left transition-colors',
              active
                ? 'border-accent/30 bg-accent/15 text-accent'
                : 'border-transparent text-secondary hover:border-border hover:bg-elevated/60 hover:text-foreground',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{group.label}</span>
              </span>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted">
                {group.count}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] text-muted">{group.meta}</div>
          </button>
        )
      })}
    </nav>
  )
}

function GroupIntro({ group }: { group: SettingsGroup }) {
  const Icon = group.icon
  return (
    <section className="rounded-card border border-border bg-surface px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-accent" />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{group.label}</h2>
          </div>
          <p className="mt-1 text-sm text-secondary">{group.meta}</p>
        </div>
        <span className="rounded-full border border-border bg-elevated px-2.5 py-1 font-mono text-[11px] text-muted">
          {group.count} 项
        </span>
      </div>
    </section>
  )
}

function ActiveGroupContent({
  group,
  highlight,
  setGroup,
  preferences,
  settings,
  crypto,
  capabilitiesLabel,
}: {
  group: SettingsGroupKey
  highlight: string
  setGroup: (key: SettingsGroupKey) => void
  preferences?: Awaited<ReturnType<typeof api.preferences>>
  settings?: Awaited<ReturnType<typeof api.settings>>
  crypto?: Awaited<ReturnType<typeof api.cryptoTickers>>
  capabilitiesLabel?: string
}) {
  switch (group) {
    case 'connection':
      return (
        <>
          <ConnectionOverview
            settings={settings}
            crypto={crypto}
            capabilitiesLabel={capabilitiesLabel}
            onOpenIntelligence={() => setGroup('intelligence')}
          />
          <div id="stock-source-panel">
            <SettingsKeysPanel />
          </div>
        </>
      )
    case 'data-refresh':
      return (
        <>
          <DataJobsSummary preferences={preferences} />
          <SettingsMonitoringPanel highlight={highlight} />
        </>
      )
    case 'monitoring-signals':
      return (
        <>
          <RelatedActionPanel
            title="监控中心"
            desc="价格、策略、信号触发规则统一在监控中心编辑；设置页保留全局开关和信号库配置。"
            icon={BellRing}
            links={[
              { label: '打开监控中心', to: '/monitor' },
              { label: '数据与刷新', onClick: () => setGroup('data-refresh') },
            ]}
          />
          <SettingsCustomSignalsPanel />
        </>
      )
    case 'intelligence':
      return (
        <>
          <RelatedActionPanel
            title="AI 与策略工作流"
            desc="这里配置模型连接和预算。策略运行、回测和监控规则仍保留在各自业务页面。"
            icon={Sparkles}
            links={[
              { label: '打开策略页', to: '/screener' },
              { label: '打开回测', to: '/backtest' },
            ]}
          />
          <SettingsAIPanel />
        </>
      )
    case 'workspace':
      return (
        <>
          <SettingsExtPagesPanel />
          <SettingsMenuSettingsPanel />
        </>
      )
    case 'system':
      return <SettingsSystemPanel embedded />
    default:
      return null
  }
}

function ConnectionOverview({
  settings,
  crypto,
  capabilitiesLabel,
  onOpenIntelligence,
}: {
  settings?: Awaited<ReturnType<typeof api.settings>>
  crypto?: Awaited<ReturnType<typeof api.cryptoTickers>>
  capabilitiesLabel?: string
  onOpenIntelligence: () => void
}) {
  const okxPrivateEnabled = !!(
    crypto?.auth.api_key_configured &&
    crypto?.auth.api_secret_configured &&
    crypto?.auth.passphrase_configured
  )

  return (
    <section className="rounded-card border border-border bg-surface overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">连接与凭据总览</h3>
          <p className="mt-1 text-xs text-muted">
            公共行情、私有凭据和 AI Provider 分开展示，避免误以为 OKX 行情必须填写 Key。
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-btn border border-border bg-base">
          <span className="bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent">本机</span>
          <span className="border-l border-border px-3 py-1.5 text-xs text-muted">服务器</span>
          <span className="border-l border-border px-3 py-1.5 text-xs text-muted">只读</span>
        </div>
      </div>

      <div className="divide-y divide-border">
        <ConnectionRow
          title="Longbridge 股票行情"
          desc="本机 OAuth，不需要 TickFlow Key。用于实时行情、日 K、自选池和标的池。"
          status={settings?.mode === 'longbridge' ? '已连接' : settings?.mode === 'api_key' ? 'API Key 模式' : '基础模式'}
          tone={settings?.mode === 'longbridge' || settings?.mode === 'api_key' ? 'ok' : 'warn'}
          value={settings?.mode === 'longbridge' ? 'Longbridge · local OAuth · active' : capabilitiesLabel ?? settings?.tier_label ?? 'capability pending'}
          action={<ScrollButton targetId="stock-source-panel" label="管理数据源" />}
        />
        <ConnectionRow
          title="OKX 币圈行情"
          desc="公共 Spot ticker 不要求填写 Key；账户/交易凭据独立锁定。"
          status={(crypto?.count ?? 0) > 0 ? '公共行情可用' : '待检测'}
          tone={(crypto?.count ?? 0) > 0 ? 'ok' : 'warn'}
          value={(crypto?.symbols ?? []).length ? `${crypto?.symbols.slice(0, 6).join(', ')}${(crypto?.symbols.length ?? 0) > 6 ? '...' : ''}` : 'https://www.okx.com · public SPOT'}
          action={
            <span className="rounded-btn border border-border bg-elevated px-3 py-1.5 text-xs text-secondary">
              私有接口{okxPrivateEnabled ? '已启用' : '未启用'}
            </span>
          }
        />
        <ConnectionRow
          title="AI Provider"
          desc="策略生成、策略解释和参数辅助。实际配置入口放在“智能与策略”。"
          status={settings?.has_ai_key ? '已配置' : '需检测'}
          tone={settings?.has_ai_key ? 'ok' : 'warn'}
          value={`${settings?.ai_provider ?? 'openai_compat'} · ${settings?.ai_base_url ?? 'base url pending'} · ${settings?.ai_model ?? 'model pending'}`}
          action={
            <button
              onClick={onOpenIntelligence}
              className="rounded-btn border border-border bg-elevated px-3 py-1.5 text-xs text-secondary hover:border-accent/40 hover:text-accent transition-colors"
            >
              打开智能与策略
            </button>
          }
        />
      </div>
    </section>
  )
}

function ConnectionRow({
  title,
  desc,
  status,
  tone,
  value,
  action,
}: {
  title: string
  desc: string
  status: string
  tone: 'ok' | 'warn'
  value: string
  action: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-4 lg:grid-cols-[minmax(150px,210px)_minmax(0,1fr)_auto] lg:items-center">
      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
              tone === 'ok'
                ? 'border-bear/35 bg-bear/10 text-bear'
                : 'border-warning/35 bg-warning/10 text-warning',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'ok' ? 'bg-bear' : 'bg-warning')} />
            {status}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{desc}</p>
      </div>
      <div className="min-w-0 rounded-input border border-border bg-base px-3 py-2 font-mono text-xs text-secondary truncate">
        {value}
      </div>
      <div className="flex justify-start lg:justify-end">{action}</div>
    </div>
  )
}

function DataJobsSummary({
  preferences,
}: {
  preferences?: Awaited<ReturnType<typeof api.preferences>>
}) {
  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <SummaryMetric
        icon={Clock3}
        label="日 K 管线"
        value={formatSchedule(preferences?.pipeline_schedule)}
        hint="收盘后更新基础历史数据"
      />
      <SummaryMetric
        icon={Database}
        label="标的同步"
        value={formatSchedule(preferences?.instruments_schedule)}
        hint="股票池和指数标的更新"
      />
      <SummaryMetric
        icon={BarChart3}
        label="批处理"
        value={`${preferences?.enriched_batch_size ?? '—'} / ${preferences?.index_daily_batch_size ?? '—'}`}
        hint="Enriched / 指数批量大小"
      />
    </section>
  )
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  hint: string
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs text-secondary">
          <Icon className="h-3.5 w-3.5 text-muted" />
          {label}
        </span>
      </div>
      <div className="mt-2 font-mono text-lg font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{hint}</div>
    </section>
  )
}

function RelatedActionPanel({
  title,
  desc,
  icon: Icon,
  links,
}: {
  title: string
  desc: string
  icon: ComponentType<{ className?: string }>
  links: Array<{ label: string; to?: string; onClick?: () => void }>
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-sm text-secondary">{desc}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {links.map((link) =>
            link.to ? (
              <Link
                key={link.label}
                to={link.to}
                className="inline-flex items-center gap-1 rounded-btn border border-border bg-elevated px-3 py-1.5 text-xs text-secondary hover:border-accent/40 hover:text-accent transition-colors"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <button
                key={link.label}
                onClick={link.onClick}
                className="inline-flex items-center gap-1 rounded-btn border border-border bg-elevated px-3 py-1.5 text-xs text-secondary hover:border-accent/40 hover:text-accent transition-colors"
              >
                {link.label}
                <ChevronRight className="h-3 w-3" />
              </button>
            ),
          )}
        </div>
      </div>
    </section>
  )
}

function SettingsInspector({
  settings,
  capabilities,
  crypto,
  quoteStatus,
  preferences,
  version,
  setGroup,
}: {
  settings?: Awaited<ReturnType<typeof api.settings>>
  capabilities?: Awaited<ReturnType<typeof api.capabilities>>
  crypto?: Awaited<ReturnType<typeof api.cryptoTickers>>
  quoteStatus?: Awaited<ReturnType<typeof api.quoteStatus>>
  preferences?: Awaited<ReturnType<typeof api.preferences>>
  version?: string
  setGroup: (key: SettingsGroupKey) => void
}) {
  const missingCaps = settings?.missing_caps?.length ?? 0
  const okxPrivateReady = !!(
    crypto?.auth.api_key_configured &&
    crypto?.auth.api_secret_configured &&
    crypto?.auth.passphrase_configured
  )
  const aiReady = !!settings?.has_ai_key

  return (
    <aside className="rounded-card border border-border bg-surface xl:sticky xl:top-20">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">状态 Inspector</h3>
        <StatusPill tone="ok">可运行</StatusPill>
      </div>

      <InspectorBlock title="最近检查">
        <InspectorEvent
          tone={settings?.mode === 'longbridge' || settings?.mode === 'api_key' ? 'ok' : 'warn'}
          title={settings?.mode === 'longbridge' ? 'Longbridge quote 探测成功' : '数据源状态已读取'}
          detail={capabilities?.label ?? settings?.tier_label ?? 'capability pending'}
        />
        <InspectorEvent
          tone={(crypto?.count ?? 0) > 0 ? 'ok' : 'warn'}
          title={`OKX Spot ticker ${crypto?.count ? `返回 ${crypto.count} 个标的` : '待检测'}`}
          detail={crypto?.updated_at ? formatTimestamp(crypto.updated_at) : 'public market api'}
        />
        <InspectorEvent
          tone={aiReady ? 'ok' : 'warn'}
          title={aiReady ? 'AI Key 已配置' : 'AI Key 未配置或未测试'}
          detail={settings?.ai_model ?? '等待手动确认'}
        />
      </InspectorBlock>

      <InspectorBlock title="需要确认">
        {missingCaps > 0 ? (
          <InspectorEvent tone="warn" title={`${missingCaps} 项能力未探测到`} detail="可能触发页面降级或隐藏入口" />
        ) : (
          <InspectorEvent tone="ok" title="无关键能力缺失" detail={`${Object.keys(capabilities?.capabilities ?? {}).length} 项能力可用`} />
        )}
        <InspectorEvent
          tone={okxPrivateReady ? 'ok' : 'warn'}
          title={okxPrivateReady ? 'OKX 私有凭据已启用' : 'OKX 私有凭据未启用'}
          detail="不影响公共币圈行情"
        />
        <InspectorEvent
          tone={preferences?.realtime_quotes_enabled && quoteStatus?.running ? 'ok' : 'warn'}
          title={preferences?.realtime_quotes_enabled ? '实时行情已开启' : '实时行情未开启'}
          detail={quoteStatus?.running ? 'quote service running' : 'quote service idle'}
        />
      </InspectorBlock>

      <InspectorBlock title="相关页面">
        <div className="grid gap-2">
          <InspectorLink to="/data" label="数据任务" />
          <InspectorLink to="/monitor" label="监控中心" />
          <InspectorButton label="信号库" onClick={() => setGroup('monitoring-signals')} />
          <InspectorButton label="菜单设置" onClick={() => setGroup('workspace')} />
        </div>
      </InspectorBlock>

      <div className="border-t border-border bg-elevated/30 px-4 py-3 text-[11px] leading-relaxed text-muted">
        工作区配置已按当前连接能力和运行状态汇总。版本 {version ?? '—'}。
      </div>
    </aside>
  )
}

function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="mb-2 text-xs font-semibold text-secondary">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function InspectorEvent({
  tone,
  title,
  detail,
}: {
  tone: 'ok' | 'warn'
  title: string
  detail: string
}) {
  return (
    <div className="grid grid-cols-[8px_1fr] gap-2 text-xs text-secondary">
      <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full', tone === 'ok' ? 'bg-bear' : 'bg-warning')} />
      <div className="min-w-0">
        <div className="truncate">{title}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{detail}</div>
      </div>
    </div>
  )
}

function InspectorLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex h-8 items-center justify-between rounded-btn bg-elevated px-3 text-xs text-secondary hover:text-accent transition-colors"
    >
      <span>{label}</span>
      <span>打开 →</span>
    </Link>
  )
}

function InspectorButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-8 items-center justify-between rounded-btn bg-elevated px-3 text-left text-xs text-secondary hover:text-accent transition-colors"
    >
      <span>{label}</span>
      <span>管理 →</span>
    </button>
  )
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
        tone === 'ok'
          ? 'border-bear/35 bg-bear/10 text-bear'
          : 'border-warning/35 bg-warning/10 text-warning',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'ok' ? 'bg-bear' : 'bg-warning')} />
      {children}
    </span>
  )
}

function ScrollButton({ targetId, label }: { targetId: string; label: string }) {
  return (
    <button
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      className="rounded-btn border border-border bg-elevated px-3 py-1.5 text-xs text-secondary hover:border-accent/40 hover:text-accent transition-colors"
    >
      {label}
    </button>
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
