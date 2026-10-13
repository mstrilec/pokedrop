'use client';

import { ThemeSwitch } from '@/components/shell/theme-switch';
import { SettingsSection } from './settings-section';

export function AppearanceSettings() {
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="Applies to this device. System follows your operating system."
    >
      <ThemeSwitch size="labelled" />
    </SettingsSection>
  );
}
