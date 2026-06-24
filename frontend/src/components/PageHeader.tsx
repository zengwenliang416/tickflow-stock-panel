import { cn } from '@/lib/cn'

interface Props {
  title: string
  subtitle?: string
  /** 标题右侧、subtitle 之前的额外节点(如状态徽标) */
  titleExtra?: React.ReactNode
  right?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, titleExtra, right, className }: Props) {
  return (
    <header
      className={cn(
        'px-5 pt-3 pb-2 border-b border-border flex items-center justify-between gap-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="shrink-0 whitespace-nowrap text-lg font-semibold tracking-tight">{title}</h1>
        {titleExtra}
        {subtitle && <span className="min-w-0 truncate text-xs text-muted">{subtitle}</span>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  )
}
