import { ReactNode } from 'react';
import { InboxOutlined } from '@ant-design/icons';
import './EmptyPlaceholder.css';

interface EmptyPlaceholderProps {
  title: string;
  description: string;
  action?: ReactNode;
  todos?: string[];
  icon?: ReactNode;
}

export function EmptyPlaceholder({ title, description, action, todos, icon }: EmptyPlaceholderProps) {
  return (
    <div className="rt-empty-ph">
      <div className="rt-empty-ph-icon">{icon ?? <InboxOutlined style={{ fontSize: 48 }} />}</div>
      <div className="rt-empty-ph-title">{title}</div>
      <div className="rt-empty-ph-desc">{description}</div>
      {todos && todos.length > 0 && (
        <ul className="rt-empty-ph-todos">
          {todos.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
      {action && <div className="rt-empty-ph-action">{action}</div>}
    </div>
  );
}
