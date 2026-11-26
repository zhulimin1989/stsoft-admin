import { ReactNode, useEffect, useRef, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import './FilterBar.css';

interface SearchProp {
  placeholder?: string;
  value?: string;
  onSearch: (value: string) => void;
  debounceMs?: number;
}

interface ChipProp {
  key: string;
  label: string;
  onRemove: () => void;
}

interface FilterBarProps {
  search?: SearchProp;
  filters?: ReactNode[];
  activeChips?: ChipProp[];
  rightActions?: ReactNode;
}

export function FilterBar({ search, filters, activeChips, rightActions }: FilterBarProps) {
  const [val, setVal] = useState(search?.value ?? '');
  const timer = useRef<number | null>(null);

  // 父组件主动更新 search.value(如点击 chip 删除清空筛选)时,本地输入框需要跟随。
  // 注意只在两者真不一致时才同步,避免用户输入时父组件回写覆盖光标。
  useEffect(() => {
    if (search?.value !== undefined && search.value !== val) {
      setVal(search.value);
    }
    // 故意只依赖 search?.value(父端推送),不监听 val 避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.value]);

  useEffect(() => {
    if (!search) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => search.onSearch(val), search.debounceMs ?? 300);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val]);

  return (
    <div className="rt-fb">
      {search && (
        <div className="rt-fb-search">
          <SearchOutlined className="rt-fb-search-icon" />
          <input
            className="rt-fb-input"
            placeholder={search.placeholder ?? '搜索...'}
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
        </div>
      )}
      {filters?.map((f, i) => (
        <div key={i} className="rt-fb-filter">
          {f}
        </div>
      ))}
      {activeChips?.map((c) => (
        <span key={c.key} className="rt-fb-chip">
          {c.label}
          <button
            type="button"
            className="rt-fb-chip-x"
            aria-label={`移除筛选: ${c.label}`}
            onClick={c.onRemove}
          >
            ✕
          </button>
        </span>
      ))}
      <div className="rt-fb-spacer" />
      {rightActions && <div className="rt-fb-right">{rightActions}</div>}
    </div>
  );
}
