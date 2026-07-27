import React, { useState, useEffect } from 'react';
import { cn } from '../../utils/cn';
import type { LucideIcon } from 'lucide-react';
import { Loader2, X } from 'lucide-react';

// ==========================================
// BUTTON
// ==========================================
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon: Icon, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={loading || props.disabled}
        className={cn(
          "inline-flex items-center justify-center font-heading font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 disabled:opacity-50 disabled:pointer-events-none rounded-btn",
          {
            // Pine Brand theme
            'bg-brand-primary text-white hover:bg-brand-primary-hover shadow-sm': variant === 'primary',
            'bg-bg-surface text-text-primary border border-border-default hover:bg-bg-canvas': variant === 'secondary',
            'bg-transparent hover:bg-bg-canvas text-text-secondary hover:text-text-primary': variant === 'ghost',
            'bg-status-danger text-white hover:bg-red-700 shadow-sm': variant === 'destructive',
            'bg-transparent border border-border-default hover:border-brand-primary text-text-secondary hover:text-text-primary': variant === 'outline',
          },
          {
            'px-2.5 py-1 text-xs': size === 'sm',
            'px-4 py-2 text-sm': size === 'md',
            'px-6 py-3 text-base': size === 'lg',
            'p-2 w-9 h-9': size === 'icon',
          },
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin text-current" />
        ) : Icon ? (
          <Icon className={cn("w-4 h-4 text-current", children ? "mr-2" : "")} />
        ) : null}
        {children}
      </button>
    );
  }
);

// ==========================================
// BADGE / PILL
// ==========================================
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'high' | 'medium' | 'low';
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', className, children, ...props }) => {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-badge text-xs font-medium font-heading tracking-wide",
        {
          'bg-status-success-bg text-status-success': variant === 'success',
          'bg-status-warning-bg text-status-warning': variant === 'warning',
          'bg-status-danger-bg text-status-danger': variant === 'danger',
          'bg-status-info-bg text-status-info': variant === 'info',
          'bg-bg-canvas text-text-secondary border border-border-subtle': variant === 'neutral',
          // Priority tags mapping from §2.2
          'bg-status-danger-bg text-status-danger border border-status-danger/25': variant === 'high',
          'bg-status-warning-bg text-status-warning border border-status-warning/25': variant === 'medium',
          'bg-bg-canvas text-text-secondary border border-border-default': variant === 'low',
        },
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

// ==========================================
// CARD
// ==========================================
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => {
  return (
    <div
      className={cn(
        "bg-bg-surface border border-border-subtle rounded-card shadow-sm hover:border-border-default transition-all duration-150",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

// ==========================================
// AVATAR
// ==========================================
interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

export const Avatar: React.FC<AvatarProps> = ({ src, name, size = 'md', className, ...props }) => {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const sizeClasses = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm',
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary font-heading font-medium overflow-hidden border border-border-subtle shrink-0",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {src ? (
        <img src={src} alt={name} className="object-cover w-full h-full" onError={(e) => { (e.target as any).style.display = 'none'; }} />
      ) : null}
      <span>{initials}</span>
    </div>
  );
};

// ==========================================
// DRAWER (Right Slide-over)
// ==========================================
interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, title, children, footer }) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEsc);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 pl-10 max-w-full flex">
        <div className="w-screen max-w-2xl bg-bg-surface-raised border-l border-border-default shadow-lg flex flex-col">
          {/* Header */}
          <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between">
            <h2 className="text-lg font-heading font-semibold text-text-primary">{title}</h2>
            <button 
              onClick={onClose} 
              className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-canvas transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {children}
          </div>
          {/* Footer */}
          {footer && (
            <div className="px-6 py-4 border-t border-border-subtle bg-bg-canvas/50 flex items-center justify-end space-x-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// MODAL / DIALOG
// ==========================================
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEsc);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
      />
      {/* Modal Dialog — height is capped to the viewport (minus the outer
          padding) and split into a fixed header/footer with a scrolling
          body in between, so content that runs long (e.g. a large results
          table) scrolls inside the dialog instead of pushing it taller
          than the screen. */}
      <div
        className={cn(
          "relative bg-bg-surface-raised border border-border-default shadow-lg rounded-modal overflow-hidden max-w-full max-h-[calc(100vh-2rem)] flex flex-col z-10 w-full animate-in fade-in zoom-in-95 duration-150",
          {
            'max-w-md': size === 'sm',
            'max-w-lg': size === 'md',
            'max-w-3xl': size === 'lg',
            'max-w-6xl': size === 'xl',
          }
        )}
      >
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between shrink-0">
          <h2 className="text-base font-heading font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-canvas transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-between shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// SKELETON
// ==========================================
export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => {
  return (
    <div 
      className={cn("bg-border-subtle animate-pulse rounded-btn", className)} 
      {...props} 
    />
  );
};

// ==========================================
// EMPTY STATE
// ==========================================
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, action }) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 border border-dashed border-border-default rounded-card bg-bg-surface/50 my-4 max-w-lg mx-auto">
      <div className="p-3 bg-brand-primary/5 rounded-full text-brand-primary mb-4">
        <Icon className="w-8 h-8" />
      </div>
      <h3 className="text-base font-heading font-medium text-text-primary mb-1">{title}</h3>
      <p className="text-sm text-text-secondary mb-6 max-w-sm">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
};

// ==========================================
// TOOLTIP
// ==========================================
interface TooltipProps {
  content: string;
  children: React.ReactElement;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute z-50 px-2 py-1 text-xs text-white bg-text-primary border border-border-default rounded-badge shadow-sm whitespace-nowrap bottom-full left-1/2 -translate-x-1/2 -translate-y-1 mb-1.5 transition-all">
          {content}
        </div>
      )}
    </div>
  );
};

// ==========================================
// TAB ELEMENT
// ==========================================
interface TabsProps {
  tabs: { id: string; label: string; count?: number }[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className }) => {
  return (
    <div className={cn("border-b border-border-subtle flex items-center space-x-6", className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "py-3 border-b-2 font-heading font-medium text-sm transition-all relative flex items-center space-x-2 -mb-[2px]",
              isActive
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className={cn(
                "px-1.5 py-0.5 text-[10px] rounded-full tabular-nums font-sans",
                isActive 
                  ? "bg-brand-primary/10 text-brand-primary font-semibold" 
                  : "bg-bg-canvas text-text-tertiary"
              )}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

// ==========================================
// RADIAL SCORE GAUGE
// ==========================================
interface ScoreGaugeProps {
  score: number;
  size?: number;
  strokeWidth?: number;
}

export const ScoreGauge: React.FC<ScoreGaugeProps> = ({ score, size = 40, strokeWidth = 4 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  let color = 'stroke-neutral-300';
  if (score >= 85) color = 'stroke-status-danger'; // High
  else if (score >= 70) color = 'stroke-status-warning'; // Medium
  else color = 'stroke-text-tertiary'; // Low

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full">
        <circle
          className="stroke-border-subtle"
          fill="transparent"
          strokeWidth={strokeWidth}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className={cn("transition-all duration-300", color)}
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <span className="absolute text-[10px] font-heading font-bold text-text-primary tabular-nums">
        {score}
      </span>
    </div>
  );
};

// ==========================================
// KPI CARD
// ==========================================
interface KpiCardProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  loading?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({ title, value, change, trend, loading }) => {
  return (
    <Card className="p-5 flex flex-col justify-between">
      <div>
        <h4 className="text-xs font-heading font-medium text-text-tertiary uppercase tracking-wider mb-2">{title}</h4>
        {loading ? (
          <Skeleton className="h-8 w-24 mb-1" />
        ) : (
          <span className="text-2xl font-heading font-bold text-text-primary tracking-tight tabular-nums">{value}</span>
        )}
      </div>
      {change && (
        <div className="mt-2 flex items-center space-x-1.5 text-xs">
          <span className={cn(
            "font-heading font-medium",
            trend === 'up' && 'text-status-success',
            trend === 'down' && 'text-status-danger',
            trend === 'neutral' && 'text-text-secondary'
          )}>
            {change}
          </span>
          <span className="text-text-tertiary">vs prior period</span>
        </div>
      )}
    </Card>
  );
};

// ==========================================
// SPARKLINE PREVIEW (SVG-based)
// ==========================================
export const Sparkline: React.FC<{ data: number[] }> = ({ data }) => {
  const width = 60;
  const height = 16;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke="var(--brand-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};
