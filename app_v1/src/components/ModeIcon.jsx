import { MODE_ICON_PATHS } from "../../shared/modeIcons.js";

// 乗り物のアイコン。形は shared/modeIcons.js にあり、経路申込書（EJS）と共用する
export default function ModeIcon({ mode, className = "mode-icon" }) {
  const d = MODE_ICON_PATHS[mode];
  if (!d) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
