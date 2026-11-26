import { ReactNode } from 'react';
import './Tag.css';

export type TagVariant = 'success' | 'warn' | 'error' | 'proc' | 'muted';

interface TagProps {
  variant?: TagVariant;
  children: ReactNode;
}

export function Tag({ variant = 'muted', children }: TagProps) {
  return <span className={`rt-tag rt-tag-${variant}`} data-variant={variant}>{children}</span>;
}
