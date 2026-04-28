import { NavItem } from './nav-item';
import {
  TodayIcon,
  DrillIcon,
  ReadIcon,
  ProgressIcon,
} from './nav-icons';

export function NavItems() {
  return (
    <ul className="flex flex-col gap-1 list-none p-0 m-0">
      <NavItem href="/" label="today" icon={<TodayIcon />} />
      <NavItem href="/drill" label="drill" icon={<DrillIcon />} />
      <NavItem href="/read" label="read" icon={<ReadIcon />} />
      <NavItem href="/progress" label="progress" icon={<ProgressIcon />} />
    </ul>
  );
}
