import { ReactNode, useState } from 'react';
import { Drawer } from 'antd';
import './DetailDrawer.css';

interface DrawerTab {
  key: string;
  label: string;
  content: ReactNode;
}

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  tabs: DrawerTab[];
  actions?: ReactNode;
  width?: number | string;
}

export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  status,
  tabs,
  actions,
  width = '40%',
}: DetailDrawerProps) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={width}
      closable={false}
      maskClosable
      destroyOnClose
      className="rt-drawer"
      title={
        <div className="rt-drawer-head">
          <div>
            <div className="rt-drawer-title">{title}</div>
            {subtitle && <div className="rt-drawer-sub">{subtitle}</div>}
          </div>
          <div className="rt-drawer-status">
            {status}
            <button
              type="button"
              className="rt-drawer-x"
              aria-label="关闭"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>
      }
      footer={actions ? <div className="rt-drawer-actions">{actions}</div> : null}
    >
      {tabs.length > 0 && (
        <div className="rt-drawer-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rt-drawer-tab ${t.key === active ? 'rt-drawer-tab-active' : ''}`}
              onClick={() => setActive(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="rt-drawer-body">{current?.content}</div>
    </Drawer>
  );
}
