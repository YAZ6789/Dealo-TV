import type { ReactNode } from 'react';

export function Empty({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="cluster" style={{ justifyContent: 'center' }}>{actions}</div>}
    </div>
  );
}
