import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './PageHeader.css';

export type BreadcrumbItem = string | { label: string; to: string };

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode[];
}

export function PageHeader({ title, subtitle, breadcrumb, actions }: PageHeaderProps) {
  return (
    <div className="rt-ph">
      <div className="rt-ph-l">
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="rt-ph-crumb">
            {breadcrumb.map((item, i) => {
              const isLast = i === breadcrumb.length - 1;
              if (typeof item === 'string') {
                return (
                  <span key={i} className={isLast ? 'rt-ph-crumb-current' : ''}>
                    {item}
                    {!isLast && <span className="rt-ph-crumb-sep"> / </span>}
                  </span>
                );
              }
              return (
                <span key={i}>
                  <Link to={item.to}>{item.label}</Link>
                  {!isLast && <span className="rt-ph-crumb-sep"> / </span>}
                </span>
              );
            })}
          </div>
        )}
        <h1 className="rt-ph-title">{title}</h1>
        {subtitle && <div className="rt-ph-sub">{subtitle}</div>}
      </div>
      {actions && actions.length > 0 && (
        <div className="rt-ph-r">{actions}</div>
      )}
    </div>
  );
}
