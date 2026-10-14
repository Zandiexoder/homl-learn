import { Link } from "react-router-dom";
import { Icon, Logo } from "./Icon";

export function Header({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <Logo />
        <span>homl learn</span>
      </Link>
      {children}
      <div className="spacer" />
      {right}
      <Link to="/settings" className="icon-btn" aria-label="Settings" title="Settings">
        <Icon name="settings" size={20} />
      </Link>
    </header>
  );
}
