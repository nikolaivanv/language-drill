import { NavItem } from './nav-item';
import {
  TodayIcon,
  DrillIcon,
  ReadIcon,
  ProgressIcon,
} from './nav-icons';

export interface NavDestination {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// Single source of nav truth, shared by the desktop rail (`NavItems`) and the
// mobile tab-bar. The four primary destinations — no invented routes.
export const NAV_DESTINATIONS: NavDestination[] = [
  { href: '/', label: 'today', icon: <TodayIcon /> },
  { href: '/drill', label: 'drill', icon: <DrillIcon /> },
  { href: '/read', label: 'read', icon: <ReadIcon /> },
  { href: '/progress', label: 'progress', icon: <ProgressIcon /> },
];

export function NavItems() {
  return (
    <ul className="flex flex-col gap-1 list-none p-0 m-0">
      {NAV_DESTINATIONS.map((d) => (
        <NavItem key={d.href} href={d.href} label={d.label} icon={d.icon} />
      ))}
    </ul>
  );
}
