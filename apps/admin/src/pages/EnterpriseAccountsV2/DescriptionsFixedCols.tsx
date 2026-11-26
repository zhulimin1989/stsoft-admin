import { useLayoutEffect, useRef, type ReactNode } from 'react';

const COL_WIDTHS = ['170px', 'calc(50% - 170px)', '170px', 'calc(50% - 170px)'] as const;
const COLGROUP_CLASS = 'ea-v2-desc-cols';

function ensureColgroup(table: HTMLTableElement): void {
  let colgroup = table.querySelector(`colgroup.${COLGROUP_CLASS}`);
  if (colgroup) return;
  colgroup = document.createElement('colgroup');
  colgroup.className = COLGROUP_CLASS;
  for (const width of COL_WIDTHS) {
    const col = document.createElement('col');
    col.style.width = width;
    colgroup.appendChild(col);
  }
  table.insertBefore(colgroup, table.firstChild);
}

/** 给 antd bordered Descriptions 注入 colgroup，钉死 标签/值/标签/值 四列宽。 */
export function DescriptionsFixedCols({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLTableElement>('.ant-descriptions-view > table').forEach(ensureColgroup);
  });

  return (
    <div ref={rootRef} className="ea-v2-desc-fixed-root">
      {children}
    </div>
  );
}
